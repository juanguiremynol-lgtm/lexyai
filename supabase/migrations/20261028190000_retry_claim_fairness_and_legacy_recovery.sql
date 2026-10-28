-- 1) Fair claim: interleave action types so aged provider-pending PUB retries
--    (Cloud Run LECTURA_PARCIAL / SAMAI session 403) cannot monopolise every
--    hourly slot and starve actuaciones retries. Eligibility, attempt
--    accounting, limit and service-only access are unchanged.
CREATE OR REPLACE FUNCTION public.atenia_ai_claim_supported_queue(_limit integer DEFAULT 5)
RETURNS SETOF public.atenia_ai_remediation_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service only' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY action_type
      ORDER BY priority + floor(greatest(0, extract(epoch FROM (now()-created_at))) / 3600) DESC, created_at, id) AS rn,
      priority + floor(greatest(0, extract(epoch FROM (now()-created_at))) / 3600) AS aged, created_at AS c
    FROM public.atenia_ai_remediation_queue
    WHERE status = 'PENDING' AND run_after <= now() AND attempts < max_attempts
      AND action_type IN ('RETRY_ACTS','RETRY_PUBS','RETRY_PUBS_HEAVY','RUN_INTEGRATION_HEALTH')
  ), candidates AS (
    SELECT q.id FROM public.atenia_ai_remediation_queue q JOIN ranked r ON r.id = q.id
    ORDER BY r.rn, r.aged DESC, r.c, q.id
    LIMIT greatest(0, least(coalesce(_limit, 5), 5))
    FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.atenia_ai_remediation_queue q
    SET status='RUNNING', attempts=attempts+1, updated_at=now()
  FROM candidates c WHERE q.id=c.id RETURNING q.*;
END $$;

CREATE OR REPLACE FUNCTION public.atenia_ai_preview_supported_queue(_limit integer DEFAULT 5)
RETURNS SETOF public.atenia_ai_remediation_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service only' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH ranked AS (
    SELECT q.*, row_number() OVER (PARTITION BY q.action_type
      ORDER BY q.priority + floor(greatest(0, extract(epoch FROM (now()-q.created_at))) / 3600) DESC, q.created_at, q.id) AS rn
    FROM public.atenia_ai_remediation_queue q
    WHERE q.status='PENDING' AND q.run_after<=now() AND q.attempts<q.max_attempts
      AND q.action_type IN ('RETRY_ACTS','RETRY_PUBS','RETRY_PUBS_HEAVY','RUN_INTEGRATION_HEALTH')
  )
  SELECT (r).* FROM (SELECT ranked AS r, rn, priority + floor(greatest(0, extract(epoch FROM (now()-created_at))) / 3600) aged, created_at, id FROM ranked) s
  ORDER BY s.rn, s.aged DESC, s.created_at, s.id
  LIMIT greatest(0, least(coalesce(_limit, 5), 5));
END $$;
REVOKE ALL ON FUNCTION public.atenia_ai_claim_supported_queue(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atenia_ai_preview_supported_queue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atenia_ai_claim_supported_queue(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.atenia_ai_preview_supported_queue(integer) TO service_role;

-- 2) Selective, traceable recovery of RETRY_ACTS dead letters caused by the
--    legacy caller identity (CALLER_UNAUTHORIZED in the same window). Only
--    matters still ACTIVE + monitored, without a later successful acts read
--    and without equivalent active work get ONE linked continuation. The
--    original DEAD_LETTER rows are never modified.
INSERT INTO public.atenia_ai_remediation_queue
  (action_type, work_item_id, organization_id, provider, reason_code, priority, payload, run_after)
SELECT 'RETRY_ACTS', d.work_item_id, d.organization_id, d.provider, 'RECOVERY_LEGACY_IDENTITY', d.priority,
  jsonb_build_object('recovered_from', d.id, 'recovery_reason', 'CALLER_UNAUTHORIZED_LEGACY_IDENTITY',
    'recovered_at', now(), 'dead_letter_count', d.n), now()
FROM (
  SELECT DISTINCT ON (q.work_item_id) q.*, count(*) OVER (PARTITION BY q.work_item_id) n
  FROM public.atenia_ai_remediation_queue q
  WHERE q.action_type='RETRY_ACTS' AND q.status='DEAD_LETTER'
    AND q.created_at > now() - interval '5 days'
    AND q.last_error LIKE 'Edge Function returned a non-2xx%'
    AND EXISTS (SELECT 1 FROM public.work_item_sync_timeline t WHERE t.work_item_id=q.work_item_id
      AND t.error_code='CALLER_UNAUTHORIZED'
      AND t.finished_at BETWEEN q.created_at - interval '5 minutes' AND q.updated_at + interval '5 minutes')
  ORDER BY q.work_item_id, q.updated_at DESC
) d
JOIN public.work_items w ON w.id=d.work_item_id
WHERE w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.work_item_sync_timeline t WHERE t.work_item_id=d.work_item_id
      AND t.operation='acts' AND lower(t.status) IN ('success','empty') AND t.finished_at > d.updated_at)
  AND NOT EXISTS (SELECT 1 FROM public.atenia_ai_remediation_queue a WHERE a.work_item_id=d.work_item_id
      AND a.action_type='RETRY_ACTS' AND a.status IN ('PENDING','RUNNING'))
  AND NOT EXISTS (SELECT 1 FROM public.sync_retry_queue s WHERE s.work_item_id=d.work_item_id AND s.kind='ACT_SCRAPE_RETRY');
