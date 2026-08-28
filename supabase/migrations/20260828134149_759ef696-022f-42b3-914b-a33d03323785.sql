CREATE OR REPLACE VIEW public.monitoring_coverage_v
WITH (security_invoker = on) AS
WITH base AS (
  SELECT w.id, w.radicado, w.workflow_type, w.organization_id, w.owner_id,
         w.monitoring_enabled, w.status, w.lifecycle_state,
         public.provider_chain_for_workflow(w.workflow_type::text) AS expected_providers
    FROM public.work_items w
   WHERE w.status = 'ACTIVE'::public.item_status
     AND w.lifecycle_state = 'ACTIVE'::public.work_item_lifecycle_state
     AND w.deleted_at IS NULL
), last_row AS (
  SELECT u.work_item_id, max(u.created_at) AS last_ingest
    FROM (
      SELECT a.work_item_id, a.created_at FROM public.work_item_acts a WHERE a.is_archived IS NOT TRUE
      UNION ALL
      SELECT p.work_item_id, p.created_at FROM public.work_item_publicaciones p WHERE p.is_archived IS NOT TRUE
    ) u
   GROUP BY u.work_item_id
), row_counts AS (
  SELECT b.id AS work_item_id,
         (SELECT count(*) FROM public.work_item_acts a WHERE a.work_item_id = b.id AND a.is_archived IS NOT TRUE) AS act_count,
         (SELECT count(*) FROM public.work_item_publicaciones p WHERE p.work_item_id = b.id AND p.is_archived IS NOT TRUE) AS publication_count
    FROM base b
), last_run AS (
  SELECT r.work_item_id,
         max(r.created_at) FILTER (WHERE r.status IN ('SUCCESS','PARTIAL')) AS last_ok_run,
         max(r.created_at) AS last_run
    FROM public.external_sync_runs r
   GROUP BY r.work_item_id
), attempts AS (
  SELECT x.work_item_id, array_agg(DISTINCT lower(x.attempt->>'provider')) AS providers
    FROM (
      SELECT r.work_item_id,
             jsonb_array_elements(CASE WHEN jsonb_typeof(r.provider_attempts) = 'array' THEN r.provider_attempts ELSE '[]'::jsonb END) AS attempt
        FROM public.external_sync_runs r
       WHERE r.created_at > now() - interval '30 days'
    ) x
   WHERE x.attempt->>'provider' IS NOT NULL
   GROUP BY x.work_item_id
)
SELECT b.id AS work_item_id, b.radicado, b.workflow_type::text AS workflow_type,
       b.organization_id, b.owner_id, b.monitoring_enabled, b.expected_providers,
       COALESCE(at.providers, ARRAY[]::text[]) AS enrolled_providers,
       ARRAY(SELECT unnest(b.expected_providers) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))) AS missing_providers,
       lr.last_ingest, ru.last_ok_run, ru.last_run,
       CASE
         WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D', '', 'g')) < 21 THEN 'SIN_RADICADO_VALIDO'
         WHEN COALESCE(array_length(at.providers, 1), 0) = 0 THEN 'SIN_ENROLAMIENTO'
         WHEN array_length(ARRAY(SELECT unnest(b.expected_providers) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))), 1) > 0 THEN 'ENROLAMIENTO_PARCIAL'
         WHEN rc.act_count = 0 AND rc.publication_count = 0 AND ru.last_ok_run IS NOT NULL THEN 'NUNCA_INGERIDO'
         ELSE 'OK'
       END AS coverage_status,
       now()::date - lr.last_ingest::date AS days_since_ingest,
       rc.act_count, rc.publication_count
  FROM base b
  LEFT JOIN last_row lr ON lr.work_item_id = b.id
  LEFT JOIN row_counts rc ON rc.work_item_id = b.id
  LEFT JOIN last_run ru ON ru.work_item_id = b.id
  LEFT JOIN attempts at ON at.work_item_id = b.id;

CREATE OR REPLACE VIEW public.retroactive_actuaciones_v
WITH (security_invoker = on) AS
SELECT a.id, a.work_item_id, a.organization_id, w.radicado, w.title AS work_item_title,
       'ACTUACION'::text AS kind, a.act_date AS legal_date,
       (a.detected_at AT TIME ZONE 'America/Bogota')::date AS detected_on,
       a.retro_gap_days AS gap_days, a.description AS title, a.source,
       public.is_term_opening_text(COALESCE(a.description,'') || ' ' || COALESCE(a.act_type,'')) AS opens_term
FROM public.work_item_acts a
JOIN public.work_items w ON w.id = a.work_item_id AND w.deleted_at IS NULL
WHERE a.is_archived IS NOT TRUE AND a.discovery_type = 'ACTUACION_RETROACTIVA'
UNION ALL
SELECT p.id, p.work_item_id, p.organization_id, w.radicado, w.title, 'ESTADO'::text,
       COALESCE(p.fecha_fijacion, p.fecha_desfijacion, p.published_at::date),
       (p.detected_at AT TIME ZONE 'America/Bogota')::date,
       p.retro_gap_days, p.title, p.source,
       public.is_term_opening_text(COALESCE(p.title,'') || ' ' || COALESCE(p.tipo_publicacion,''))
FROM public.work_item_publicaciones p
JOIN public.work_items w ON w.id = p.work_item_id AND w.deleted_at IS NULL
WHERE p.is_archived IS NOT TRUE AND p.discovery_type = 'ACTUACION_RETROACTIVA';

CREATE OR REPLACE VIEW public.v_deadline_attribution
WITH (security_invoker = on) AS
SELECT d.id AS deadline_id, d.work_item_id, d.owner_id, d.organization_id,
       d.status, d.deadline_type, d.label, d.trigger_date, d.deadline_date,
       d.bound_party_role, d.bound_party_source, d.is_judge_side,
       d.calculation_meta,
       w.client_party_role, w.client_party_role_source, w.client_party_represents,
       public.deadline_attribution(d.bound_party_role, d.bound_party_source, d.is_judge_side,
         w.client_party_role, w.client_party_role_source, w.client_party_represents) AS attribution
FROM public.work_item_deadlines d
JOIN public.work_items w ON w.id = d.work_item_id AND w.deleted_at IS NULL;