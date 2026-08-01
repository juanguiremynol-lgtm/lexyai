-- ── Iteration 8.1 / 8.2: alert hygiene ────────────────────────────────

ALTER TABLE public.alert_instances ADD COLUMN IF NOT EXISTS source_event_key text;
CREATE INDEX IF NOT EXISTS idx_alert_instances_source_event_key
  ON public.alert_instances(source_event_key);

-- Family classifier: groups twin emitters onto one logical event family
CREATE OR REPLACE FUNCTION public.alert_family(p_alert_type text, p_title text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(p_alert_type,'') IN ('ESTADO_NUEVO','ESTADO_MODIFIED') THEN 'ESTADO'
    WHEN COALESCE(p_alert_type,'') = 'ACTUACION_NUEVA' THEN 'ACTUACION'
    WHEN COALESCE(p_alert_type,'') = 'LEXY_DAILY' THEN 'DIGEST'
    WHEN COALESCE(p_title,'') ILIKE 'Nuevo estado%' THEN 'ESTADO'
    WHEN COALESCE(p_title,'') ILIKE 'Nueva actuación%' THEN 'ACTUACION'
    WHEN COALESCE(p_title,'') ILIKE '%Resumen Diario%'
      OR COALESCE(p_title,'') ILIKE '%Resumen diario%' THEN 'DIGEST'
    ELSE COALESCE(NULLIF(p_alert_type,''), 'OTHER')
  END
$$;

CREATE OR REPLACE FUNCTION public.alert_title_is_generic(p_title text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p_title,'') = ''
      OR p_title ILIKE 'Nuevo estado (pendiente de fijación)%'
      OR p_title ILIKE 'Nuevo estado detectado%'
      OR p_title ILIKE 'Nuevo Estado: Publicación%'
      OR p_title ILIKE 'Nueva actuación en %'
      OR p_title = 'Nueva actuación'
      OR p_title = 'Estado modificado'
$$;

-- Event key: entity + family + source row id (or message hash) + Bogotá date
CREATE OR REPLACE FUNCTION public.alert_source_event_key(
  p_entity_id uuid, p_alert_type text, p_title text, p_message text,
  p_payload jsonb, p_fired_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p_entity_id::text,'-') || ':'
      || public.alert_family(p_alert_type, p_title) || ':'
      || COALESCE(
           p_payload->>'pub_id', p_payload->>'act_id', p_payload->>'source_event_id',
           md5(lower(left(COALESCE(NULLIF(p_message,''), p_title, ''), 200)))
         ) || ':'
      || to_char((COALESCE(p_fired_at, now()) AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD')
$$;

-- BEFORE INSERT guard: one event = one alert; keeps the more specific title
CREATE OR REPLACE FUNCTION public.alert_instances_dedupe_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_family text;
  v_key text;
  v_existing public.alert_instances%ROWTYPE;
BEGIN
  NEW.fired_at := COALESCE(NEW.fired_at, now());
  v_family := public.alert_family(NEW.alert_type, NEW.title);
  v_key := public.alert_source_event_key(
    NEW.entity_id, NEW.alert_type, NEW.title, NEW.message, NEW.payload, NEW.fired_at);
  NEW.source_event_key := v_key;

  -- Digest auto-expiry: only the latest digest stays pending
  IF v_family = 'DIGEST' THEN
    UPDATE public.alert_instances
       SET status = 'DISMISSED',
           dismissed_at = now(),
           read_at = COALESCE(read_at, now()),
           seen_at = COALESCE(seen_at, now()),
           dismissal_reason = 'DIGEST_SUPERSEDED'
     WHERE owner_id = NEW.owner_id
       AND public.alert_family(alert_type, title) = 'DIGEST'
       AND status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND (fired_at AT TIME ZONE 'America/Bogota')::date
           < (NEW.fired_at AT TIME ZONE 'America/Bogota')::date;
  END IF;

  SELECT * INTO v_existing
    FROM public.alert_instances
   WHERE source_event_key = v_key
     AND status NOT IN ('DISMISSED','RESOLVED','CANCELLED')
   ORDER BY created_at ASC
   LIMIT 1;

  IF FOUND THEN
    IF public.alert_title_is_generic(v_existing.title)
       AND NOT public.alert_title_is_generic(NEW.title) THEN
      UPDATE public.alert_instances
         SET title = NEW.title,
             payload = COALESCE(v_existing.payload,'{}'::jsonb) || COALESCE(NEW.payload,'{}'::jsonb),
             alert_type = COALESCE(v_existing.alert_type, NEW.alert_type),
             alert_source = COALESCE(v_existing.alert_source, NEW.alert_source)
       WHERE id = v_existing.id;
    END IF;
    RETURN NULL; -- suppress the twin
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_alert_instances_dedupe_guard ON public.alert_instances;
CREATE TRIGGER trg_alert_instances_dedupe_guard
  BEFORE INSERT ON public.alert_instances
  FOR EACH ROW EXECUTE FUNCTION public.alert_instances_dedupe_guard();

-- ── Retroactive cleanup ───────────────────────────────────────────────

UPDATE public.alert_instances
   SET source_event_key = public.alert_source_event_key(
         entity_id, alert_type, title, message, payload, fired_at)
 WHERE source_event_key IS NULL;

-- Report table for counts
CREATE TABLE IF NOT EXISTS public._alert_hygiene_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  affected integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public._alert_hygiene_report TO authenticated;
GRANT ALL ON public._alert_hygiene_report TO service_role;
ALTER TABLE public._alert_hygiene_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform admins read alert hygiene report" ON public._alert_hygiene_report;
CREATE POLICY "platform admins read alert hygiene report"
  ON public._alert_hygiene_report FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

-- 1) Collapse duplicate pairs: keep the richer row, dismiss the twin
WITH ranked AS (
  SELECT id, source_event_key,
         ROW_NUMBER() OVER (
           PARTITION BY source_event_key
           ORDER BY public.alert_title_is_generic(title) ASC,
                    length(COALESCE(message,'')) DESC,
                    length(COALESCE(payload::text,'')) DESC,
                    created_at ASC
         ) AS rn
    FROM public.alert_instances
   WHERE status IN ('PENDING','SENT','ACKNOWLEDGED')
     AND source_event_key IS NOT NULL
), dupes AS (
  UPDATE public.alert_instances a
     SET status = 'DISMISSED', dismissed_at = now(),
         read_at = COALESCE(a.read_at, now()), seen_at = COALESCE(a.seen_at, now()),
         dismissal_reason = 'DUPLICADO_ALERTA'
    FROM ranked r
   WHERE a.id = r.id AND r.rn > 1
  RETURNING a.id
)
INSERT INTO public._alert_hygiene_report (kind, affected)
SELECT 'DUPLICADO_ALERTA', count(*) FROM dupes;

-- 1b) Promote the most specific title onto each surviving row
UPDATE public.alert_instances a
   SET title = best.title
  FROM (
    SELECT DISTINCT ON (source_event_key) source_event_key, title
      FROM public.alert_instances
     WHERE source_event_key IS NOT NULL
       AND NOT public.alert_title_is_generic(title)
     ORDER BY source_event_key, created_at ASC
  ) best
 WHERE a.source_event_key = best.source_event_key
   AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
   AND public.alert_title_is_generic(a.title);

-- 2) Digest auto-expiry, retroactive: keep only the latest per owner
WITH digests AS (
  SELECT id, owner_id, fired_at,
         ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY fired_at DESC) AS rn
    FROM public.alert_instances
   WHERE status IN ('PENDING','SENT','ACKNOWLEDGED')
     AND public.alert_family(alert_type, title) = 'DIGEST'
), expired AS (
  UPDATE public.alert_instances a
     SET status = 'DISMISSED', dismissed_at = now(),
         read_at = COALESCE(a.read_at, now()), seen_at = COALESCE(a.seen_at, now()),
         dismissal_reason = 'DIGEST_SUPERSEDED'
    FROM digests d
   WHERE a.id = d.id AND d.rn > 1
  RETURNING a.id
)
INSERT INTO public._alert_hygiene_report (kind, affected)
SELECT 'DIGEST_SUPERSEDED', count(*) FROM expired;