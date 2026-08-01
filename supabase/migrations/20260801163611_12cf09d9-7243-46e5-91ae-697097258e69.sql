-- Iteration 8.1b: twin emitters don't share a source row id — key ESTADO/ACTUACION
-- events by (entity, family, event text, Bogotá date) so both routes collapse.
CREATE OR REPLACE FUNCTION public.alert_source_event_key(
  p_entity_id uuid, p_alert_type text, p_title text, p_message text,
  p_payload jsonb, p_fired_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p_entity_id::text,'-') || ':'
      || public.alert_family(p_alert_type, p_title) || ':'
      || CASE
           WHEN public.alert_family(p_alert_type, p_title) IN ('ESTADO','ACTUACION')
             THEN md5(lower(left(COALESCE(NULLIF(p_message,''), p_title, ''), 200)))
           ELSE COALESCE(
             p_payload->>'pub_id', p_payload->>'act_id', p_payload->>'source_event_id',
             md5(lower(left(COALESCE(NULLIF(p_message,''), p_title, ''), 200))))
         END || ':'
      || to_char((COALESCE(p_fired_at, now()) AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD')
$$;

UPDATE public.alert_instances
   SET source_event_key = public.alert_source_event_key(
         entity_id, alert_type, title, message, payload, fired_at);

WITH ranked AS (
  SELECT id, source_event_key,
         ROW_NUMBER() OVER (
           PARTITION BY source_event_key
           ORDER BY public.alert_title_is_generic(title) ASC,
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
SELECT 'DUPLICADO_ALERTA_PASS2', count(*) FROM dupes;

-- Promote the most specific title onto each surviving row
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