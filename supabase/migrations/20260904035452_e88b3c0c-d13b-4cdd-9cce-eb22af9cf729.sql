ALTER TABLE public.external_sync_runs
  ADD CONSTRAINT chk_failed_run_declares_reason
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL) NOT VALID;