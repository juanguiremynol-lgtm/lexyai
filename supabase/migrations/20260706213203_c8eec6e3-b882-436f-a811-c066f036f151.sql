
ALTER TABLE public.platform_job_heartbeats
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS trigger_source text,
  ADD COLUMN IF NOT EXISTS work_item_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_type text,
  ADD COLUMN IF NOT EXISTS error_summary text;

CREATE INDEX IF NOT EXISTS idx_pjh_job_status_started
  ON public.platform_job_heartbeats (job_name, status, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pjh_job_correlation
  ON public.platform_job_heartbeats (job_name, correlation_id)
  WHERE correlation_id IS NOT NULL;

UPDATE public.atenia_ai_remediation_queue q
SET status = 'CANCELLED_NOT_APPLICABLE',
    last_error = COALESCE(last_error, '') || ' | quarantined: category not online-sync eligible',
    updated_at = now()
FROM public.work_items w
WHERE q.work_item_id = w.id
  AND q.status IN ('PENDING','RUNNING','FAILED')
  AND w.workflow_type::text IN ('GOV_PROCEDURE','GOV_PROC','PROC_ADMIN','PETICION');

UPDATE public.sync_retry_queue
SET attempt = GREATEST(max_attempts, attempt) + 1,
    last_error_code = 'CANCELLED_NOT_APPLICABLE',
    last_error_message = 'category not online-sync eligible — quarantined',
    updated_at = now()
WHERE workflow_type::text IN ('GOV_PROCEDURE','GOV_PROC','PROC_ADMIN','PETICION');

UPDATE public.sync_item_failure_tracker t
SET dead_lettered = false,
    reset_at = now(),
    last_failure_reason = COALESCE(last_failure_reason, '') || ' | reset: category not online-sync eligible',
    updated_at = now()
FROM public.work_items w
WHERE t.work_item_id = w.id
  AND t.dead_lettered = true
  AND w.workflow_type::text IN ('GOV_PROCEDURE','GOV_PROC','PROC_ADMIN','PETICION');
