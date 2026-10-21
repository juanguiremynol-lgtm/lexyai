-- Deadline identity hardening: the same source event must be idempotent under
-- retries and concurrency; distinct acts, rules or bound parties never merge.
ALTER TABLE public.work_item_deadlines ADD COLUMN source_event_id uuid;
COMMENT ON COLUMN public.work_item_deadlines.source_event_id IS 'Source event that produced the deadline: work_item_acts.id or work_item_publicaciones.id. Part of the deadline unique identity.';

-- Backfill only rows whose anchor guard still passes; rows tied to a
-- publication whose date was later nulled stay untouched (source_event_id NULL).
UPDATE public.work_item_deadlines d
SET source_event_id = CASE
  WHEN d.calculation_meta->>'act_id' ~ '^[0-9a-fA-F-]{36}$' THEN (d.calculation_meta->>'act_id')::uuid
  WHEN d.calculation_meta->>'pub_id' ~ '^[0-9a-fA-F-]{36}$' THEN (d.calculation_meta->>'pub_id')::uuid
END
WHERE d.source_event_id IS NULL
  AND (d.calculation_meta->>'act_id' ~ '^[0-9a-fA-F-]{36}$' OR d.calculation_meta->>'pub_id' ~ '^[0-9a-fA-F-]{36}$')
  AND NOT EXISTS (
    SELECT 1 FROM public.work_item_publicaciones p
    WHERE d.calculation_meta->>'pub_id' ~ '^[0-9a-fA-F-]{36}$'
      AND p.id = (d.calculation_meta->>'pub_id')::uuid AND p.fecha_fijacion IS NULL);

DROP INDEX IF EXISTS public.uq_work_item_deadlines_ident;
CREATE UNIQUE INDEX uq_work_item_deadlines_ident ON public.work_item_deadlines
  (work_item_id, deadline_type, trigger_date, trigger_event, bound_party_role, source_event_id) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.deadline_event_key(p_work_item_id uuid, p_deadline_type text, p_trigger_event text, p_bound_party_role text, p_trigger_date date, p_source_event_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $k$
  SELECT p_work_item_id::text || '|' || COALESCE(p_deadline_type,'') || '|' || COALESCE(p_trigger_event,'') || '|' || COALESCE(p_bound_party_role,'') || '|' || COALESCE(p_trigger_date::text,'') || '|' || COALESCE(p_source_event_id::text,'')
$k$;
COMMENT ON FUNCTION public.deadline_event_key(uuid,text,text,text,date,uuid) IS 'Semantic event identity for per-user review state. Excludes row id and technical timestamps; a material change (date, rule, party or source event) yields a new key and re-notifies.';

ALTER TABLE public.deadline_review_user_state ADD COLUMN event_key text;
UPDATE public.deadline_review_user_state s
SET event_key = public.deadline_event_key(d.work_item_id, d.deadline_type, d.trigger_event, d.bound_party_role, d.trigger_date, d.source_event_id)
FROM public.work_item_deadlines d WHERE d.id = s.deadline_id;
CREATE INDEX idx_deadline_review_event_key ON public.deadline_review_user_state (user_id, event_key);

CREATE OR REPLACE FUNCTION public.acknowledge_deadline_reviews(_ids uuid[], _action text, _until timestamptz DEFAULT NULL)
RETURNS SETOF public.deadline_review_user_state LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF _action NOT IN ('acknowledge','snooze') OR cardinality(_ids) > 500 THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  IF _action = 'snooze' AND (_until IS NULL OR _until <= now()) THEN RAISE EXCEPTION 'Fecha inválida'; END IF;
  IF (SELECT count(*) FROM public.work_item_deadlines WHERE id = ANY(_ids)) <> cardinality(_ids) THEN
    RAISE EXCEPTION 'Término no accesible';
  END IF;
  RETURN QUERY INSERT INTO public.deadline_review_user_state AS s (deadline_id, user_id, acknowledged_at, snoozed_until, event_key)
  SELECT d.id, auth.uid(), CASE WHEN _action='acknowledge' THEN now() END, CASE WHEN _action='snooze' THEN _until END,
         public.deadline_event_key(d.work_item_id, d.deadline_type, d.trigger_event, d.bound_party_role, d.trigger_date, d.source_event_id)
  FROM public.work_item_deadlines d WHERE d.id = ANY(_ids)
  ON CONFLICT (deadline_id, user_id) DO UPDATE SET
    acknowledged_at = coalesce(s.acknowledged_at, excluded.acknowledged_at),
    snoozed_until = CASE WHEN _action='snooze' AND s.acknowledged_at IS NULL THEN excluded.snoozed_until ELSE s.snoozed_until END,
    event_key = excluded.event_key
  RETURNING s.*;
END $$;
REVOKE ALL ON FUNCTION public.acknowledge_deadline_reviews(uuid[], text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_deadline_reviews(uuid[], text, timestamptz) TO authenticated;