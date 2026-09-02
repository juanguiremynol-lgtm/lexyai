ALTER TABLE public.external_sync_run_payloads
  ALTER COLUMN sync_run_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS endpoint text,
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS run_status text,
  ADD COLUMN IF NOT EXISTS enumeracion jsonb,
  ADD COLUMN IF NOT EXISTS work_item_id uuid,
  ADD COLUMN IF NOT EXISTS radicado text;

CREATE INDEX IF NOT EXISTS idx_esrp_run_status ON public.external_sync_run_payloads (run_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_esrp_work_item ON public.external_sync_run_payloads (work_item_id, created_at DESC);

GRANT ALL ON public.external_sync_run_payloads TO service_role;

COMMENT ON COLUMN public.external_sync_run_payloads.run_status IS 'JN4 — verdict emitted by /procesar-radicado. Stored verbatim; not interpreted.';
COMMENT ON COLUMN public.external_sync_run_payloads.enumeracion IS 'JN4 — enumeracion[] as returned by the provider. Stored verbatim; not interpreted.';