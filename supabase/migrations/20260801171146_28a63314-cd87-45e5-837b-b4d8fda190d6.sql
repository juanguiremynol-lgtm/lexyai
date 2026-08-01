
CREATE OR REPLACE VIEW public.monitoring_coverage_v AS
WITH base AS (
  SELECT
    w.id, w.radicado, w.workflow_type, w.organization_id, w.owner_id,
    w.monitoring_enabled, w.status, w.lifecycle_state,
    CASE w.workflow_type::text
      WHEN 'CPACA' THEN ARRAY['samai']
      WHEN 'TUTELA' THEN ARRAY['cpnu','publicaciones','tutelas']
      ELSE ARRAY['cpnu','publicaciones']
    END AS expected_providers
  FROM public.work_items w
  WHERE w.status = 'ACTIVE' AND w.lifecycle_state = 'ACTIVE'
),
last_row AS (
  SELECT work_item_id, max(created_at) AS last_ingest FROM (
    SELECT work_item_id, created_at FROM public.work_item_acts WHERE is_archived IS NOT TRUE
    UNION ALL
    SELECT work_item_id, created_at FROM public.work_item_publicaciones WHERE is_archived IS NOT TRUE
  ) u GROUP BY work_item_id
),
last_run AS (
  SELECT work_item_id,
         max(created_at) FILTER (WHERE status IN ('SUCCESS','PARTIAL')) AS last_ok_run,
         max(created_at) AS last_run
  FROM public.external_sync_runs GROUP BY work_item_id
),
attempts AS (
  SELECT work_item_id,
         array_agg(DISTINCT lower(replace(a->>'provider', '_estados',''))) AS providers
  FROM (
    SELECT work_item_id,
           jsonb_array_elements(CASE WHEN jsonb_typeof(provider_attempts)='array' THEN provider_attempts ELSE '[]'::jsonb END) AS a
    FROM public.external_sync_runs
    WHERE created_at > now() - interval '30 days'
  ) x
  WHERE a->>'provider' IS NOT NULL
  GROUP BY work_item_id
)
SELECT
  b.id AS work_item_id,
  b.radicado,
  b.workflow_type::text AS workflow_type,
  b.organization_id,
  b.owner_id,
  b.monitoring_enabled,
  b.expected_providers,
  COALESCE(at.providers, ARRAY[]::text[]) AS enrolled_providers,
  ARRAY(SELECT unnest(b.expected_providers) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))) AS missing_providers,
  lr.last_ingest,
  ru.last_ok_run,
  ru.last_run,
  CASE
    WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D', '', 'g')) < 21 THEN 'SIN_RADICADO_VALIDO'
    WHEN COALESCE(array_length(at.providers, 1), 0) = 0 THEN 'SIN_ENROLAMIENTO'
    WHEN array_length(ARRAY(SELECT unnest(b.expected_providers) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))), 1) > 0 THEN 'ENROLAMIENTO_PARCIAL'
    ELSE 'OK'
  END AS coverage_status,
  ((now()::date) - (lr.last_ingest)::date) AS days_since_ingest
FROM base b
LEFT JOIN last_row lr ON lr.work_item_id = b.id
LEFT JOIN last_run ru ON ru.work_item_id = b.id
LEFT JOIN attempts at ON at.work_item_id = b.id;

ALTER VIEW public.monitoring_coverage_v SET (security_invoker = on);
GRANT SELECT ON public.monitoring_coverage_v TO authenticated, service_role;
