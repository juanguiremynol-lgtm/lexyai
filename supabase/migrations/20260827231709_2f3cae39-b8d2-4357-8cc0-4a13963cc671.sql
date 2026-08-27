WITH last_real AS (
  SELECT DISTINCT ON (r.work_item_id)
    r.work_item_id, r.started_at,
    UPPER(COALESCE(NULLIF(a->>'result_code',''), a->>'outcome', a->>'status')) AS oc
  FROM public.external_sync_runs r,
       LATERAL jsonb_array_elements(r.provider_attempts) a
  WHERE a->>'provider' = 'publicaciones'
    AND UPPER(COALESCE(a->>'result_code','')) NOT LIKE 'ROUTING_SKIP%'
    AND UPPER(COALESCE(a->>'result_code','')) NOT LIKE 'SKIP%'
  ORDER BY r.work_item_id, r.started_at DESC
)
UPDATE public.work_items w
SET pp_estado = CASE
      WHEN lr.work_item_id IS NULL THEN 'no_aplica'
      WHEN lr.oc LIKE '%WITH_DATA%' OR lr.oc = 'SUCCESS' OR lr.oc LIKE '%EMPTY%' THEN 'ok'
      WHEN lr.oc LIKE 'PENDING%' OR lr.oc IN ('NO_DATA','SCRAPING_INITIATED') THEN 'pending'
      WHEN lr.oc LIKE '%PRIVADO%' THEN 'privado'
      ELSE 'error'
    END,
    pp_ultima_sync = lr.started_at
FROM (SELECT id FROM public.work_items) src
LEFT JOIN last_real lr ON lr.work_item_id = src.id
WHERE w.id = src.id
  AND w.deleted_at IS NULL
  AND w.pp_estado = 'error';