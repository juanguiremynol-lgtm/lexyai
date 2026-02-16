
-- A: Add fail_reason and failure metadata to E2E test results
ALTER TABLE public.atenia_e2e_test_results
  ADD COLUMN IF NOT EXISTS fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS failure_summary TEXT,
  ADD COLUMN IF NOT EXISTS failure_stage TEXT;

COMMENT ON COLUMN public.atenia_e2e_test_results.fail_reason IS 'Enum-like: ITEM_NOT_FOUND, SENTINEL_NOT_CONFIGURED, PROVIDER_PRECONDITION_FAILED, PROVIDER_TIMEOUT, SYNC_TIMEOUT, ASSERTION_FAILED, UNKNOWN_ERROR';
COMMENT ON COLUMN public.atenia_e2e_test_results.failure_summary IS 'Human-readable summary <= 280 chars';
COMMENT ON COLUMN public.atenia_e2e_test_results.failure_stage IS 'PRECHECK | ENQUEUE | FETCH | NORMALIZE | PERSIST | VERIFY';

-- B: Add TTL and heartbeat fields to deep dives
ALTER TABLE public.atenia_deep_dives
  ADD COLUMN IF NOT EXISTS max_runtime_ms INTEGER DEFAULT 1200000,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE INDEX IF NOT EXISTS idx_deep_dives_dedupe ON public.atenia_deep_dives (work_item_id, trigger_criteria, status) WHERE status = 'RUNNING';

-- C: Add remediation_disabled flag and first_remediation_at to conversations (incidents)
ALTER TABLE public.atenia_ai_conversations
  ADD COLUMN IF NOT EXISTS remediation_disabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS first_remediation_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_escalated_at TIMESTAMPTZ;

-- E: Add continuation telemetry to daily ledger
ALTER TABLE public.auto_sync_daily_ledger
  ADD COLUMN IF NOT EXISTS continuation_enqueued BOOLEAN,
  ADD COLUMN IF NOT EXISTS continuation_block_reason TEXT;

COMMENT ON COLUMN public.auto_sync_daily_ledger.continuation_block_reason IS 'MAX_CONTINUATIONS_REACHED | NO_PENDING_WORK | POLICY_DISABLED | CONVERGENCE_FAILED | UNKNOWN';

-- F: Add consecutive failure tracking to preflight checks
ALTER TABLE public.atenia_preflight_checks
  ADD COLUMN IF NOT EXISTS consecutive_failures_by_provider JSONB DEFAULT '{}';
