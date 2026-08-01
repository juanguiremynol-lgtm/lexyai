-- =========================================================
-- Iteration 7 — provider hearing-date extraction (Parts A/B)
-- =========================================================

-- 1) New sibling status of SUGGESTED_BY_EMAIL
ALTER TABLE public.work_item_deadlines DROP CONSTRAINT IF EXISTS work_item_deadlines_status_check;
ALTER TABLE public.work_item_deadlines ADD CONSTRAINT work_item_deadlines_status_check
  CHECK (status = ANY (ARRAY['PENDING','MET','MISSED','CANCELLED','REQUIERE_REVISION_MANUAL',
    'HISTORICAL_BACKFILL','PENDING_REVIEW','INVALID_NO_TERM','FULFILLED','VENCIDO_SIN_SUBSANAR',
    'FULFILLED_BY_EMAIL_EVIDENCE','SUGGESTED_BY_EMAIL','SUGGESTED_BY_PROVIDER','DISMISSED']));

-- 2) SQL mirror of _shared/hearingDateExtractor.ts
CREATE OR REPLACE FUNCTION public.extract_provider_hearing(
  p_title text, p_annotation text, p_today date DEFAULT (now() AT TIME ZONE 'America/Bogota')::date
) RETURNS TABLE (hearing_date date, hora text, fuente_texto text)
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  t text; m text[]; tm text[]; v_d int; v_m int; v_y int; v_date date;
  v_pos int; v_hh int; v_mm int; v_mer text; v_hora text; v_snip text;
  v_months constant text[] := ARRAY['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO',
                                    'AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  v_mi int;
BEGIN
  t := upper(translate(coalesce(p_title,'') || ' ' || coalesce(p_annotation,''),
                       'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'));
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  IF t = '' OR t !~ '(AUDIENCIA|DILIGENCIA|EV[- ]?INICIAL)' THEN RETURN; END IF;

  -- Pattern 1: PARA EL [DIA] D DE MES DE YYYY
  m := regexp_match(t, 'PARA EL (?:DIA )?([0-9]{1,2}) DE ([A-Z]+) DE ([0-9]{4})');
  IF m IS NOT NULL THEN
    v_mi := array_position(v_months, CASE WHEN m[2] = 'SETIEMBRE' THEN 'SEPTIEMBRE' ELSE m[2] END);
    IF v_mi IS NOT NULL THEN
      BEGIN v_date := make_date(m[3]::int, v_mi, m[1]::int); EXCEPTION WHEN others THEN v_date := NULL; END;
    END IF;
  END IF;

  -- Pattern 2: AUDIENCIA ... EL [DIA] D DE MES [DE YYYY]
  IF v_date IS NULL THEN
    m := regexp_match(t, 'AUDIENCIA[^.]{0,80}EL (?:DIA )?([0-9]{1,2}) DE ([A-Z]+)(?: DE ([0-9]{4}))?');
    IF m IS NOT NULL THEN
      v_mi := array_position(v_months, CASE WHEN m[2] = 'SETIEMBRE' THEN 'SEPTIEMBRE' ELSE m[2] END);
      IF v_mi IS NOT NULL THEN
        v_y := COALESCE(m[3]::int, extract(year from p_today)::int);
        BEGIN v_date := make_date(v_y, v_mi, m[1]::int); EXCEPTION WHEN others THEN v_date := NULL; END;
        IF m[3] IS NULL AND v_date IS NOT NULL AND v_date < p_today THEN
          BEGIN v_date := make_date(v_y + 1, v_mi, m[1]::int); EXCEPTION WHEN others THEN v_date := NULL; END;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Pattern 3: DD/MM/YYYY (hearing gate already applied)
  IF v_date IS NULL THEN
    m := regexp_match(t, '([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})');
    IF m IS NOT NULL THEN
      BEGIN v_date := make_date(m[3]::int, m[2]::int, m[1]::int); EXCEPTION WHEN others THEN v_date := NULL; END;
    END IF;
  END IF;

  IF v_date IS NULL OR v_date < p_today THEN RETURN; END IF;

  -- Time (optional)
  tm := regexp_match(t, '([0-9]{1,2})[:.]([0-9]{2}) ?(A\.? ?M\.?|P\.? ?M\.?)?');
  IF tm IS NOT NULL THEN
    v_hh := tm[1]::int; v_mm := tm[2]::int;
    v_mer := replace(replace(coalesce(tm[3],''), '.', ''), ' ', '');
    IF v_mer = 'PM' AND v_hh < 12 THEN v_hh := v_hh + 12; END IF;
    IF v_mer = 'AM' AND v_hh = 12 THEN v_hh := 0; END IF;
    IF v_hh <= 23 AND v_mm <= 59 THEN
      v_hora := lpad(v_hh::text, 2, '0') || ':' || lpad(v_mm::text, 2, '0');
    END IF;
  END IF;

  v_pos := greatest(1, coalesce(position(m[1] in t), 1) - 30);
  v_snip := btrim(substr(t, v_pos, 160));

  RETURN QUERY SELECT v_date, v_hora, v_snip;
END;
$$;

-- 3) Effect writer: hearing -> SUGGESTED_BY_PROVIDER deadline, ±1 day cross-source corroboration
CREATE OR REPLACE FUNCTION public.suggest_provider_hearing(
  p_work_item_id uuid, p_trigger_date date, p_source_kind text, p_source_ref_id uuid,
  p_source text, p_title text, p_annotation text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h record; wi record; v_existing record; v_id uuid; v_today date;
BEGIN
  IF p_work_item_id IS NULL THEN RETURN NULL; END IF;
  v_today := (now() AT TIME ZONE 'America/Bogota')::date;

  SELECT * INTO h FROM public.extract_provider_hearing(p_title, p_annotation, v_today);
  IF h.hearing_date IS NULL THEN RETURN NULL; END IF;

  SELECT id, owner_id, organization_id INTO wi FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Cross-source fingerprint: same WI + AUDIENCIA + hearing date ±1 calendar day
  SELECT * INTO v_existing FROM public.work_item_deadlines d
   WHERE d.work_item_id = p_work_item_id
     AND d.deadline_type = 'AUDIENCIA'
     AND d.status NOT IN ('DISMISSED','CANCELLED')
     AND d.deadline_date IS NOT NULL
     AND abs(d.deadline_date - h.hearing_date) <= 1
   ORDER BY d.created_at LIMIT 1;

  IF FOUND THEN
    UPDATE public.work_item_deadlines
       SET calculation_meta = coalesce(calculation_meta, '{}'::jsonb) ||
             jsonb_build_object('corroborations',
               coalesce(calculation_meta -> 'corroborations', '[]'::jsonb) ||
               jsonb_build_array(jsonb_build_object(
                 'at', now(), 'window', '1_calendar_day', 'origin', 'PROVIDER',
                 'source', p_source, 'source_kind', p_source_kind,
                 'source_ref_id', p_source_ref_id, 'hearing_date', h.hearing_date,
                 'hora', h.hora, 'fuente_texto', h.fuente_texto))),
           updated_at = now()
     WHERE id = v_existing.id;
    RETURN v_existing.id;
  END IF;

  INSERT INTO public.work_item_deadlines
    (owner_id, organization_id, work_item_id, deadline_type, label, description,
     trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta)
  VALUES (wi.owner_id, wi.organization_id, p_work_item_id, 'AUDIENCIA',
          'Audiencia detectada (' || coalesce(p_source, p_source_kind) || ')',
          left(coalesce(p_title, p_annotation, 'Audiencia'), 300),
          'PROVIDER_' || p_source_kind, coalesce(p_trigger_date, v_today), h.hearing_date, NULL,
          'SUGGESTED_BY_PROVIDER',
          jsonb_build_object(
            'anchor_source', 'PROVIDER_HEARING_TEXT',
            'origin', 'PROVIDER',
            'source', p_source,
            'source_kind', p_source_kind,
            'source_ref_id', p_source_ref_id,
            'hora', h.hora,
            'fuente_texto', h.fuente_texto))
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 4) The generic ±3-business-day corroboration must NOT collapse distinct hearings:
--    AUDIENCIA rows are fingerprinted on the hearing date instead.
CREATE OR REPLACE FUNCTION public.corroborate_duplicate_deadline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF NEW.status IN ('DISMISSED', 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  IF NEW.deadline_type = 'AUDIENCIA' THEN
    -- Hearing-date fingerprint (±1 calendar day), cross-source.
    SELECT d.id INTO existing_id
      FROM public.work_item_deadlines d
     WHERE d.work_item_id = NEW.work_item_id
       AND d.deadline_type = 'AUDIENCIA'
       AND d.status NOT IN ('DISMISSED','CANCELLED')
       AND d.deadline_date IS NOT NULL AND NEW.deadline_date IS NOT NULL
       AND abs(d.deadline_date - NEW.deadline_date) <= 1
     ORDER BY d.created_at LIMIT 1;
  ELSE
    SELECT d.id INTO existing_id
      FROM public.work_item_deadlines d
     WHERE d.work_item_id = NEW.work_item_id
       AND d.deadline_type = NEW.deadline_type
       AND d.status NOT IN ('DISMISSED', 'CANCELLED')
       AND abs(d.trigger_date - NEW.trigger_date) <= 5
       AND public.business_days_between_sql(d.trigger_date, NEW.trigger_date) <= 3
     ORDER BY (d.deadline_date IS NULL), d.created_at
     LIMIT 1;
  END IF;

  IF existing_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.work_item_deadlines
     SET calculation_meta = coalesce(calculation_meta, '{}'::jsonb) ||
           jsonb_build_object('corroborations',
             coalesce(calculation_meta -> 'corroborations', '[]'::jsonb) ||
             jsonb_build_array(jsonb_build_object(
               'at', now(),
               'status', NEW.status,
               'trigger_date', NEW.trigger_date,
               'deadline_date', NEW.deadline_date,
               'window', CASE WHEN NEW.deadline_type = 'AUDIENCIA'
                              THEN '1_calendar_day' ELSE '3_business_days' END,
               'meta', NEW.calculation_meta))),
         deadline_date = COALESCE(deadline_date, NEW.deadline_date),
         business_days_count = COALESCE(business_days_count, NEW.business_days_count),
         updated_at = now()
   WHERE id = existing_id;

  RETURN NULL;
END;
$$;

-- 5) Write-time hooks
CREATE OR REPLACE FUNCTION public.trg_act_hearing_suggestion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.is_archived, false) THEN RETURN NEW; END IF;
  PERFORM public.suggest_provider_hearing(
    NEW.work_item_id, NEW.act_date, 'ACTUACION', NEW.id, NEW.source,
    NEW.act_type, NEW.description);
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_pub_hearing_suggestion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.is_archived, false) THEN RETURN NEW; END IF;
  PERFORM public.suggest_provider_hearing(
    NEW.work_item_id,
    COALESCE(NEW.fecha_fijacion, NEW.published_at, NEW.created_at)::date,
    'ESTADO', NEW.id, NEW.source, NEW.title, NEW.annotation);
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_item_acts_hearing ON public.work_item_acts;
CREATE TRIGGER trg_work_item_acts_hearing
AFTER INSERT ON public.work_item_acts
FOR EACH ROW EXECUTE FUNCTION public.trg_act_hearing_suggestion();

DROP TRIGGER IF EXISTS trg_work_item_publicaciones_hearing ON public.work_item_publicaciones;
CREATE TRIGGER trg_work_item_publicaciones_hearing
AFTER INSERT ON public.work_item_publicaciones
FOR EACH ROW EXECUTE FUNCTION public.trg_pub_hearing_suggestion();

-- 6) Backfill (Part C) — bounded, idempotent, future-dated hearings only
CREATE OR REPLACE FUNCTION public.backfill_provider_hearings(p_limit int DEFAULT 5000)
RETURNS TABLE (work_item_id uuid, radicado text, source_kind text, source text,
               hearing_date date, hora text, fuente_texto text, deadline_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; v_id uuid; h record;
BEGIN
  FOR r IN
    SELECT a.work_item_id, a.id AS ref_id, 'ACTUACION'::text AS kind, a.source,
           a.act_date::date AS tdate, a.act_type AS ttl, a.description AS ann
      FROM public.work_item_acts a
     WHERE COALESCE(a.is_archived,false) = false
       AND (coalesce(a.act_type,'') || ' ' || coalesce(a.description,'')) ~* '(AUDIENCIA|DILIGENCIA|EV[- ]?INICIAL)'
    UNION ALL
    SELECT p.work_item_id, p.id, 'ESTADO', p.source,
           COALESCE(p.fecha_fijacion, p.published_at, p.created_at)::date, p.title, p.annotation
      FROM public.work_item_publicaciones p
     WHERE COALESCE(p.is_archived,false) = false
       AND (coalesce(p.title,'') || ' ' || coalesce(p.annotation,'')) ~* '(AUDIENCIA|DILIGENCIA|EV[- ]?INICIAL)'
    LIMIT p_limit
  LOOP
    SELECT * INTO h FROM public.extract_provider_hearing(r.ttl, r.ann);
    IF h.hearing_date IS NULL THEN CONTINUE; END IF;
    v_id := public.suggest_provider_hearing(r.work_item_id, r.tdate, r.kind, r.ref_id, r.source, r.ttl, r.ann);
    RETURN QUERY SELECT r.work_item_id,
                        (SELECT w.radicado FROM public.work_items w WHERE w.id = r.work_item_id),
                        r.kind, r.source, h.hearing_date, h.hora, h.fuente_texto, v_id;
  END LOOP;
END;
$$;