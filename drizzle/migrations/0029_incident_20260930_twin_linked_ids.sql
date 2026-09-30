-- A hold may carry already-resolved act/publication links (audit_hold.linked_source_ids).
CREATE OR REPLACE FUNCTION public.deadline_source_ids(m jsonb)
 RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(DISTINCT v) FILTER (WHERE v IS NOT NULL AND v <> ''), ARRAY[]::text[]) FROM (
    SELECT m->>'act_id' v UNION ALL SELECT m->>'auto_act_id' UNION ALL SELECT m->>'pub_id'
    UNION ALL SELECT c->'meta'->>k FROM jsonb_array_elements(coalesce(m->'corroborations','[]'::jsonb)) c,
                     unnest(ARRAY['act_id','auto_act_id','pub_id']) k
    UNION ALL SELECT jsonb_array_elements_text(coalesce(m->'audit_hold'->'linked_source_ids','[]'::jsonb))
  ) s
$$;