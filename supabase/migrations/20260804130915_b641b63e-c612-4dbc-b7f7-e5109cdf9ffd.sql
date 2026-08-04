-- ============ ITERATION 19 · PART B: stage suggestion regression guard ============

ALTER TABLE public.work_item_stage_suggestions
  ADD COLUMN IF NOT EXISTS event_date date,
  ADD COLUMN IF NOT EXISTS event_text text,
  ADD COLUMN IF NOT EXISTS dismiss_reason text,
  ADD COLUMN IF NOT EXISTS is_regression boolean NOT NULL DEFAULT false;

-- ---- B1: canonical stage order (extended with unranked production stages) ----
CREATE OR REPLACE FUNCTION public.stage_rank(p_stage text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE upper(COALESCE(p_stage,''))
    WHEN 'DRAFTED' THEN 0
    WHEN 'PENDIENTE_CLASIFICACION' THEN 0
    WHEN 'PRECONTENCIOSO' THEN 2
    WHEN 'DEMANDA_POR_RADICAR' THEN 5
    WHEN 'ACTA_RECEIVED' THEN 8
    WHEN 'RADICACION' THEN 10
    WHEN 'RADICADO' THEN 10
    WHEN 'RADICADO_PENDING' THEN 10
    WHEN 'DEMANDA_RADICADA' THEN 10
    WHEN 'TUTELA_RADICADA' THEN 10
    WHEN 'PETICION_RADICADA' THEN 10
    WHEN 'INDAGACION' THEN 10
    WHEN 'NOTICIA_CRIMINAL_INDAGACION' THEN 10
    WHEN 'ADMISION_PENDIENTE' THEN 12
    WHEN 'PENDING_AUTO_ADMISORIO' THEN 12
    WHEN 'SUBSANACION' THEN 15
    WHEN 'RADICADO_CONFIRMED' THEN 15
    WHEN 'ADMISION' THEN 20
    WHEN 'AUTO_ADMISORIO' THEN 20
    WHEN 'TUTELA_ADMITIDA' THEN 20
    WHEN 'MANDAMIENTO_PAGO' THEN 20
    WHEN 'MANDAMIENTO_DE_PAGO' THEN 20
    WHEN 'IMPUTACION' THEN 20
    WHEN 'IMPUTACION_INVESTIGACION' THEN 20
    WHEN 'MEDIDA_ASEGURAMIENTO' THEN 25
    WHEN 'NOTIFICACION' THEN 30
    WHEN 'NOTIFICACION_PERSONAL' THEN 30
    WHEN 'NOTIFICACION_AVISO' THEN 30
    WHEN 'NOTIFICACION_TRASLADOS' THEN 30
    WHEN 'CONSTANCIA_RADICACION' THEN 30
    WHEN 'ESCRITO_ACUSACION' THEN 30
    WHEN 'CONTESTACION' THEN 40
    WHEN 'TRASLADO_DEMANDA' THEN 40
    WHEN 'ACUSACION' THEN 40
    WHEN 'AUDIENCIA_ACUSACION' THEN 40
    WHEN 'REFORMA_DEMANDA' THEN 41
    WHEN 'PRORROGA' THEN 41
    WHEN 'TRASLADO_EXCEPCIONES' THEN 42
    WHEN 'EXCEPCIONES_PREVIAS' THEN 42
    WHEN 'REQUERIMIENTOS_TRASLADOS' THEN 44
    WHEN 'SANEAMIENTO' THEN 50
    WHEN 'CUADERNO' THEN 50
    WHEN 'PREPARATORIA' THEN 55
    WHEN 'AUDIENCIA_PREPARATORIA' THEN 55
    WHEN 'AUDIENCIA_INICIAL' THEN 60
    WHEN 'AUDIENCIA_PRUEBAS' THEN 62
    WHEN 'AUDIENCIA_INSTRUCCION' THEN 62
    WHEN 'AUDIENCIA_INSTRUCCION_JUZGAMIENTO' THEN 62
    WHEN 'JUICIO_ORAL' THEN 62
    WHEN 'ALEGATOS_SENTENCIA' THEN 70
    WHEN 'SENTENCIA' THEN 72
    WHEN 'SENTENCIA_TRAMITE' THEN 72
    WHEN 'FALLO_PRIMERA_INSTANCIA' THEN 72
    WHEN 'RESPUESTA' THEN 72
    WHEN 'FINALIZADO_ABSUELTO' THEN 74
    WHEN 'FINALIZADO_CONDENADO' THEN 74
    WHEN 'RECURSOS' THEN 80
    WHEN 'APELACION' THEN 80
    WHEN 'IMPUGNACION' THEN 80
    WHEN 'SEGUNDA_INSTANCIA' THEN 82
    WHEN 'FALLO_SEGUNDA_INSTANCIA' THEN 82
    WHEN 'EJECUTORIA' THEN 88
    WHEN 'EJECUCION_CUMPLIMIENTO' THEN 90
    WHEN 'CUMPLIMIENTO' THEN 90
    WHEN 'PRECLUSION' THEN 90
    WHEN 'PRECLUSION_TRAMITE' THEN 90
    WHEN 'PRECLUIDO_ARCHIVADO' THEN 95
    WHEN 'ARCHIVADO' THEN 95
    ELSE -1
  END
$function$;

-- ---- B1 exception: explicit procedural-regression vocabulary ----
CREATE OR REPLACE FUNCTION public.event_text_indicates_regresion(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(p_text,'') <> '' AND (
    lower(public.f_unaccent(p_text)) ~
    '(declara la nulidad|nulidad procesal|decreta la nulidad|se declara nulo|\mnulidad\M|revoca|deja sin efecto|dejar sin efecto|repone y revoca|retrotrae|retrotraer)'
  )
$$;

-- ---- B4 helper: does an event text bear a procedural stage? ----
CREATE OR REPLACE FUNCTION public.act_is_stage_bearing(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(p_text,'') <> '' AND (
    lower(public.f_unaccent(p_text)) ~
    '(admite|admisorio|inadmite|subsana|rechaza|mandamiento|notific|emplaza|traslado|contesta|excepcion|saneamiento|audiencia|alegato|sentencia|fallo|recurso|apelacion|reposicion|impugnacion|imputacion|acusacion|preclusion|nulidad|revoca|ejecutoria|cumplimiento|archiva)'
  )
$$;

-- ---- B1 + B2: BEFORE INSERT guard ----
CREATE OR REPLACE FUNCTION public.tg_stage_suggestion_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current text; v_cr int; v_sr int; v_regresion boolean;
BEGIN
  IF NEW.status <> 'PENDING' THEN RETURN NEW; END IF;

  -- invalid payload: nothing to suggest
  IF NULLIF(btrim(COALESCE(NEW.suggested_stage,'')),'') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT stage INTO v_current FROM public.work_items WHERE id = NEW.work_item_id;

  -- B2: no-op guard
  IF upper(COALESCE(v_current,'')) = upper(NEW.suggested_stage) THEN
    RETURN NULL;
  END IF;

  v_cr := public.stage_rank(v_current);
  v_sr := public.stage_rank(NEW.suggested_stage);

  -- B1: monotonic guard
  IF v_cr >= 0 AND v_sr >= 0 AND v_sr < v_cr THEN
    v_regresion := public.event_text_indicates_regresion(
                     COALESCE(NEW.event_text,'') || ' ' || COALESCE(NEW.reason,''));
    IF NOT v_regresion OR NULLIF(btrim(COALESCE(NEW.event_text,'')),'') IS NULL THEN
      RETURN NULL;  -- regressive suggestion suppressed
    END IF;
    NEW.is_regression := true;
    NEW.reason := '[REGRESION_PROCESAL] ' || COALESCE(NEW.reason,'')
                  || ' — texto del evento: "' || left(NEW.event_text, 400) || '"';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stage_suggestion_guard ON public.work_item_stage_suggestions;
CREATE TRIGGER trg_stage_suggestion_guard
  BEFORE INSERT ON public.work_item_stage_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.tg_stage_suggestion_guard();

-- ---- B3: latest event wins — one standing suggestion per work item ----
CREATE OR REPLACE FUNCTION public.tg_stage_suggestion_standing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status <> 'PENDING' THEN RETURN NEW; END IF;
  UPDATE public.work_item_stage_suggestions
     SET status = 'DISMISSED',
         dismiss_reason = 'REEMPLAZADA_POR_EVENTO_POSTERIOR',
         updated_at = now()
   WHERE work_item_id = NEW.work_item_id
     AND id <> NEW.id
     AND status = 'PENDING';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stage_suggestion_standing ON public.work_item_stage_suggestions;
CREATE TRIGGER trg_stage_suggestion_standing
  AFTER INSERT ON public.work_item_stage_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.tg_stage_suggestion_standing();

-- ---- canonical writer used by all provider paths ----
CREATE OR REPLACE FUNCTION public.upsert_standing_stage_suggestion(
  p_work_item_id uuid,
  p_suggested_stage text,
  p_confidence numeric,
  p_reason text,
  p_source_type text,
  p_event_fingerprint text,
  p_event_date date DEFAULT NULL,
  p_event_text text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE wi record; v_id uuid; v_existing record;
BEGIN
  SELECT id, owner_id, organization_id, stage INTO wi FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- already standing for this very event
  SELECT * INTO v_existing FROM public.work_item_stage_suggestions
    WHERE work_item_id = p_work_item_id AND event_fingerprint = p_event_fingerprint LIMIT 1;
  IF FOUND THEN RETURN v_existing.id; END IF;

  -- B4: do not resurrect an older event than the standing one
  IF EXISTS (
    SELECT 1 FROM public.work_item_stage_suggestions
     WHERE work_item_id = p_work_item_id AND status = 'PENDING'
       AND COALESCE(event_date, created_at::date) > COALESCE(p_event_date, CURRENT_DATE)
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.work_item_stage_suggestions
    (work_item_id, organization_id, owner_id, source_type, event_fingerprint,
     suggested_stage, confidence, reason, status, event_date, event_text)
  VALUES (p_work_item_id, wi.organization_id, wi.owner_id, p_source_type, p_event_fingerprint,
          p_suggested_stage, p_confidence, p_reason, 'PENDING', p_event_date, p_event_text)
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL when the guard suppressed the row
END;
$$;

-- ---- B4: staleness sweep ----
CREATE OR REPLACE FUNCTION public.dismiss_superseded_stage_suggestions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count int := 0;
BEGIN
  WITH stale AS (
    SELECT s.id
      FROM public.work_item_stage_suggestions s
     WHERE s.status = 'PENDING'
       AND EXISTS (
         SELECT 1 FROM public.work_item_acts a
          WHERE a.work_item_id = s.work_item_id
            AND COALESCE(a.is_archived,false) = false
            AND COALESCE(a.act_date, a.event_date) > COALESCE(s.event_date, s.created_at::date)
            AND public.act_is_stage_bearing(COALESCE(a.act_type,'') || ' ' || COALESCE(a.description,''))
       )
  )
  UPDATE public.work_item_stage_suggestions t
     SET status = 'DISMISSED',
         dismiss_reason = 'SUPERADA_POR_EVENTO_POSTERIOR',
         updated_at = now()
    FROM stale WHERE t.id = stale.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============ B5: retroactive re-evaluation + report ============
CREATE TABLE IF NOT EXISTS public._iter19_stage_suggestion_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radicado text,
  current_stage text,
  old_suggestion text,
  source_type text,
  created_at_original timestamptz,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public._iter19_stage_suggestion_report TO authenticated;
GRANT ALL ON public._iter19_stage_suggestion_report TO service_role;
ALTER TABLE public._iter19_stage_suggestion_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform admins read iter19 report" ON public._iter19_stage_suggestion_report;
CREATE POLICY "platform admins read iter19 report"
  ON public._iter19_stage_suggestion_report FOR SELECT TO authenticated
  USING (public.is_platform_admin());

WITH pend AS (
  SELECT s.id, w.radicado, w.stage AS current_stage, s.suggested_stage, s.source_type, s.created_at,
         public.stage_rank(w.stage) AS cr, public.stage_rank(s.suggested_stage) AS sr,
         EXISTS (
           SELECT 1 FROM public.work_item_acts a
            WHERE a.work_item_id = s.work_item_id
              AND COALESCE(a.is_archived,false) = false
              AND COALESCE(a.act_date, a.event_date) > s.created_at::date
              AND public.act_is_stage_bearing(COALESCE(a.act_type,'') || ' ' || COALESCE(a.description,''))
         ) AS superseded
    FROM public.work_item_stage_suggestions s
    JOIN public.work_items w ON w.id = s.work_item_id
   WHERE s.status = 'PENDING'
), classified AS (
  SELECT p.*,
    CASE
      WHEN NULLIF(btrim(COALESCE(p.suggested_stage,'')),'') IS NULL THEN 'dismissed-invalid'
      WHEN upper(COALESCE(p.current_stage,'')) = upper(p.suggested_stage) THEN 'dismissed-noop'
      WHEN p.cr >= 0 AND p.sr >= 0 AND p.sr < p.cr THEN 'dismissed-regressive'
      WHEN p.superseded THEN 'dismissed-superseded'
      ELSE 'kept'
    END AS outcome
  FROM pend p
)
INSERT INTO public._iter19_stage_suggestion_report
  (radicado, current_stage, old_suggestion, source_type, created_at_original, outcome)
SELECT radicado, current_stage, suggested_stage, source_type, created_at, outcome FROM classified;

UPDATE public.work_item_stage_suggestions s
   SET status = 'DISMISSED',
       dismiss_reason = CASE r.outcome
         WHEN 'dismissed-noop' THEN 'NOOP_ITER19'
         WHEN 'dismissed-regressive' THEN 'REGRESIVA_ITER19'
         WHEN 'dismissed-superseded' THEN 'SUPERADA_POR_EVENTO_POSTERIOR'
         ELSE 'INVALIDA_ITER19' END,
       updated_at = now()
  FROM (
    SELECT w.radicado, s2.id, s2.suggested_stage,
      CASE
        WHEN NULLIF(btrim(COALESCE(s2.suggested_stage,'')),'') IS NULL THEN 'dismissed-invalid'
        WHEN upper(COALESCE(w.stage,'')) = upper(s2.suggested_stage) THEN 'dismissed-noop'
        WHEN public.stage_rank(w.stage) >= 0 AND public.stage_rank(s2.suggested_stage) >= 0
             AND public.stage_rank(s2.suggested_stage) < public.stage_rank(w.stage) THEN 'dismissed-regressive'
        WHEN EXISTS (
          SELECT 1 FROM public.work_item_acts a
           WHERE a.work_item_id = s2.work_item_id
             AND COALESCE(a.is_archived,false) = false
             AND COALESCE(a.act_date, a.event_date) > s2.created_at::date
             AND public.act_is_stage_bearing(COALESCE(a.act_type,'') || ' ' || COALESCE(a.description,''))
        ) THEN 'dismissed-superseded'
        ELSE 'kept' END AS outcome
      FROM public.work_item_stage_suggestions s2
      JOIN public.work_items w ON w.id = s2.work_item_id
     WHERE s2.status = 'PENDING'
  ) r
 WHERE s.id = r.id AND r.outcome <> 'kept';

-- B3 retroactive: collapse any remaining multi-pending matters to the newest one
UPDATE public.work_item_stage_suggestions s
   SET status = 'DISMISSED',
       dismiss_reason = 'REEMPLAZADA_POR_EVENTO_POSTERIOR',
       updated_at = now()
 WHERE s.status = 'PENDING'
   AND EXISTS (
     SELECT 1 FROM public.work_item_stage_suggestions n
      WHERE n.work_item_id = s.work_item_id AND n.status = 'PENDING'
        AND (n.created_at, n.id) > (s.created_at, s.id)
   );

-- daily hygiene cron
DO $$
BEGIN
  PERFORM cron.unschedule('stage-suggestion-hygiene-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('stage-suggestion-hygiene-daily', '35 6 * * *',
  $$SELECT public.dismiss_superseded_stage_suggestions();$$);