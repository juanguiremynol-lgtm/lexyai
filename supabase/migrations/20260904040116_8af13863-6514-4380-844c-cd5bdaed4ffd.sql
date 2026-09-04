ALTER TABLE public.external_sync_run_payloads
  DROP CONSTRAINT IF EXISTS external_sync_run_payloads_stage_check;

ALTER TABLE public.external_sync_run_payloads
  ADD CONSTRAINT external_sync_run_payloads_stage_check
  CHECK (stage IN ('request','response','parsed','upsert_summary','freshness_gate','dedupe','PROCESAR_RADICADO_ACK'));