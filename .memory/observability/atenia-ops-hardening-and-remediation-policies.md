# Memory: observability/atenia-ops-hardening-and-remediation-policies
Updated: now

Atenia's operational health is supported by automated remediation and observability policies:

1. **E2E Sentinel Tests** classify failures with explicit `failure_stage` (PRECONDITION, SYNC, POSTCHECK) and `failure_reason` (WORK_ITEM_NOT_FOUND, RADICADO_INVALID, PROVIDER_TIMEOUT, etc.). Sub-1s failures are auto-classified as PRECONDITION. Sentinels are validated at batch start (non-empty radicado, valid 23-digit format, existing work_item_id). Invalid sentinels are auto-disabled after 5 consecutive failures.

2. **Deep Dives** have a 30-minute TTL (DEEP_DIVE_TTL_EXCEEDED) enforced by watchdog, a 6-hour deduplication window per radicado, and a hard guard preventing creation with empty radicado. Deep dives only trigger for SYNC-stage E2E failures (not PRECONDITION).

3. **Incident Policy Engine** auto-enqueues remediation for CRITICAL incidents, auto-resolves after 90 minutes of silence, and auto-escalates to human channels after 2 hours. NEW: Stale CRITICAL incidents (>48h, rising observations, 0 actions) are auto-escalated by watchdog.

4. **Preflight checks** trigger 'CRITICAL_FAILURE' only if >=50% of providers fail for >=3 consecutive checks.

5. **Chain Continuation** triggers on PARTIAL + BUDGET_EXHAUSTED (not just SUCCESS). Guards: no-progress cursor detection, max_continuations cap, continuation_block_reason recorded in ledger.

6. **Remediation Queue Liveness**: RUNNING items > 1h are reclaimed by watchdog (reset to PENDING with incremented attempts) or marked FAILED if max_attempts reached. Error code: REMEDIATION_STUCK.

7. **Ghost Items**: Deterministic remediation with max 2 bootstrap attempts. After threshold, monitoring is disabled (GHOST_NO_INITIAL_SYNC). Warning deduplication prevents repeated emissions.
