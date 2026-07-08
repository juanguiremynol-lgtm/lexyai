
INSERT INTO public.sync_retry_queue (work_item_id, organization_id, radicado, workflow_type, kind, provider, next_run_at, attempt, max_attempts, last_error_code, last_error_message)
SELECT id, organization_id, radicado, workflow_type, 'ACT_SCRAPE_RETRY', 'cpnu', now(), 1, 3, NULL, 'gateB-hearing-7b038fac-v2'
FROM public.work_items WHERE id='7b038fac-f82a-4619-8c10-fe1fe22b8d57'
ON CONFLICT (work_item_id, kind) DO UPDATE SET
  next_run_at = now(), attempt = 1, claimed_at = NULL,
  last_error_message = 'gateB-hearing-7b038fac-v2', updated_at = now();
