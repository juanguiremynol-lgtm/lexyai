# Memory: observability/atenia-ops-hardening-and-remediation-policies
Updated: 2026-02-17

Canonical operational memory for Atenia's automated remediation, failure classification, and watchdog policies. Referenced by the daily ops report (`atenia-daily-report`), cron watchdog (`atenia-cron-watchdog`), E2E scheduler (`atenia-e2e-scheduled`), daily sync (`scheduled-daily-sync`), and the AI supervisor.

---

## 1. Persistent State We Rely On (Project Memory)

These fields are "persisted memory"—operators and agents can trust them as the canonical source of truth for operational decisions.

| Field | Table | Owner | When Written | Operational Meaning |
|---|---|---|---|---|
| `failure_stage` | `atenia_e2e_test_results` | E2E scheduler | On every E2E result persist | PRECONDITION / SYNC / POSTCHECK — classifies *where* the failure occurred |
| `failure_reason` | `atenia_e2e_test_results` | E2E scheduler | On every non-PASS result | Enumerated reason: ITEM_NOT_FOUND, RADICADO_INVALID, PROVIDER_TIMEOUT, SYNC_TIMEOUT, ASSERTION_FAILED, NO_EXTERNAL_DATA_YET, UNKNOWN_ERROR |
| `failure_summary` | `atenia_e2e_test_results` | E2E scheduler | On every non-PASS result | Human-readable diagnostic string (≤280 chars), safe to log |
| `fail_reason` | `atenia_e2e_test_results` | E2E registry | On FAIL/SKIPPED | Legacy field; same semantics as `failure_reason` |
| `continuation_block_reason` | `auto_sync_daily_ledger` | Daily sync / continuation guarantee | When continuation is blocked | Free-form reason code: `NO_PROGRESS_CURSOR_UNCHANGED`, `MAX_CONTINUATIONS_REACHED`, `NO_SKIPPED_ITEMS`, etc. |
| `lease_heartbeat_at` | `atenia_ai_remediation_queue` | Remediation worker | Periodically while RUNNING | Canonical liveness signal — if stale > 1h, watchdog reclaims the item |
| `ghost_bootstrap_attempts` | `work_items` | Watchdog (ghost policy) | On each bootstrap attempt | Counter of initial-sync attempts for ghost items; threshold = 2 |
| `monitoring_disabled_reason` | `work_items` | Watchdog (ghost policy) | On terminalization | Reason monitoring was disabled: `GHOST_NO_INITIAL_SYNC` |
| `monitoring_disabled_at` | `work_items` | Watchdog (ghost policy) | On terminalization | Timestamp of monitoring disable event |
| `monitoring_enabled` | `work_items` | Multiple | On state change | Master flag; `false` = no sync/E2E/heartbeat activity for this item |
| `consecutive_failures` | `atenia_e2e_test_registry` | E2E registry | After each sentinel test | Tracks consecutive FAIL (not SKIPPED) results; triggers deep dive at ≥3, auto-disable at ≥5 |

---

## 2. Failure Classification Policy (E2E)

### Taxonomy: `failure_stage`

| Stage | Meaning | Examples |
|---|---|---|
| **PRECONDITION** | Test could not start; no sync was attempted | Missing work item, invalid radicado, provider secret unavailable, sentinel not configured |
| **SYNC** | Sync was attempted and failed during execution | Provider timeout, sync timeout, mapping failure, enqueue error |
| **POSTCHECK** | Sync completed but verification of persisted data failed | Zero actuaciones after sync, assertion mismatch, data regression |

### Hard Rules

- **Sub-1s rule**: Any E2E test completing in < 1 second is auto-classified as `failure_stage=PRECONDITION` regardless of step analysis. Rationale: a real sync always takes > 1s.
- **PRECONDITION ≠ FAIL**: Precondition failures are persisted as `overall=SKIPPED` (not `FAIL`). They do not increment `consecutive_failures` on the sentinel registry.
- **Deep dive trigger**: Deep dives are triggered **only** when `failure_stage=SYNC` (or equivalent real-sync-failed condition). PRECONDITION and POSTCHECK failures never trigger deep dives.
- **Sentinel invalidation**: An invalid sentinel (empty radicado, format mismatch, missing work item) emits `PRECONDITION_FAIL` — it should not page operators and should not create deep dives.

---

## 3. Sentinel Policy (Scheduled E2E)

### Validation Gates (`validateSentinel()`)

Before executing any sentinel E2E test, the batch runner validates:

1. **Non-empty radicado** — reject if `radicado` is null, empty, or whitespace.
2. **23-digit format** — reject if radicado does not match the expected 23-digit Colombian judicial format.
3. **Valid `work_item_id`** — reject if the referenced work item does not exist or has `deleted_at IS NOT NULL`.

If validation fails, the test is recorded as `overall=SKIPPED`, `failure_stage=PRECONDITION`, `fail_reason=SENTINEL_NOT_CONFIGURED` or `ITEM_NOT_FOUND`.

### Auto-Disable Rule

- **Threshold**: 5 consecutive failures (tracked via `atenia_e2e_test_registry.consecutive_failures`).
- **Action**: Sentinel is auto-disabled (removed from active pool or flagged).
- **What happens next**: The registry refresh job (`refreshE2ERegistry`) will attempt to select a replacement sentinel from the same workflow type, preferring work items with a recent `last_successful_sync_at`.
- **Operator action**: If no healthy candidate exists for a workflow type, the sentinel gap will appear in the daily ops report under the E2E tool section.

### Operator Guidance: Healthy Sentinel

A healthy sentinel is a work item that:
- Has `monitoring_enabled=true` and `deleted_at IS NULL`
- Has at least one successful sync in the last 7 days (`last_successful_sync_at`)
- Has a valid, non-empty radicado matching the 23-digit format
- Belongs to a workflow type with known provider coverage in `PROVIDERS_FOR_TYPE`

To refresh the sentinel pool manually, call `refreshE2ERegistry(orgId)` or trigger the E2E registry refresh from the audit wizard.

---

## 4. Chain Continuation Guarantee

### State Machine

Continuation is evaluated at the end of every daily sync ledger entry. The following terminal states trigger continuation:

| Ledger `status` | `failure_reason` | Triggers Continuation? |
|---|---|---|
| `SUCCESS` | — | ✅ Yes (if items remain) |
| `PARTIAL` | `BUDGET_EXHAUSTED` | ✅ Yes |
| `PARTIAL` | other | ✅ Yes (if `items_skipped > 0`) |
| `FAILED` | `BUDGET_EXHAUSTED` | ✅ Yes |
| `FAILED` | other | ❌ No |

### Skipped-Work Rule

Continue if `items_skipped > 0`, even when `items_succeeded = 0`. This ensures that budget-exhausted chains don't stall when all remaining items were skipped due to timeout budget.

### Guardrails

1. **No-progress cursor detection**: If `cursor_last_work_item_id` is identical between the current and previous ledger entry in the chain, continuation is blocked. Reason: `NO_PROGRESS_CURSOR_UNCHANGED`.
2. **`max_continuations` cap**: A configurable cap (default defined in `scheduled-daily-sync`) prevents infinite chains. Reason: `MAX_CONTINUATIONS_REACHED`.
3. **`continuation_block_reason`**: Always recorded in the ledger entry when continuation is blocked, enabling post-hoc diagnosis.

### Return Type

The sync run return type includes: `{ status, items_succeeded, items_failed, items_skipped, failure_reason, cursor_last_work_item_id }`.

---

## 5. Deep Dive Policy (Timeouts and Terminal States)

### TTL Rule

- **Threshold**: 30 minutes (`DEEP_DIVE_TTL_MS = 1_800_000`).
- **Enforcement**: The cron watchdog (`atenia-cron-watchdog`) queries for `status=RUNNING` deep dives with `started_at` older than 30 minutes.
- **Transition**: `status → TIMED_OUT`, `finished_at → now()`, `duration_ms → calculated`, `root_cause → 'DEEP_DIVE_TTL_EXCEEDED'`.
- **Error code**: `DEEP_DIVE_TTL_EXCEEDED`.

### Creation Guard

- **Invariant**: A deep dive **cannot** be created with an empty or null radicado. This is enforced as a hard guard in `triggerDeepDive()` / `executeDeepDive()`. If radicado is empty, the function returns early without inserting.
- **Deduplication**: A 6-hour deduplication window per radicado prevents duplicate deep dives for the same item.

### Trigger Rules

- Deep dives trigger on **3+ consecutive E2E SYNC-stage failures** for a sentinel item.
- Deep dives do **not** trigger for PRECONDITION-stage failures.
- Deep dives do **not** trigger for SKIPPED results.

### Cleanup Guidance

No deep dive should persist in `RUNNING` beyond the 30-minute TTL. If the watchdog is not running, a manual query can clean up:
```sql
UPDATE atenia_deep_dives
SET status = 'TIMED_OUT', finished_at = now(),
    duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000,
    root_cause = 'DEEP_DIVE_TTL_EXCEEDED'
WHERE status = 'RUNNING'
  AND started_at < now() - INTERVAL '30 minutes';
```

---

## 6. Remediation Queue Liveness Policy

### Liveness Signal

The field `lease_heartbeat_at` on `atenia_ai_remediation_queue` is the canonical liveness signal. Workers must update this timestamp periodically while processing an item.

### Watchdog Reclaim Rule

- **Threshold**: RUNNING for > 1 hour (based on `lease_heartbeat_at` or `updated_at` if heartbeat is null).
- **Reclaim behavior**: Reset `status → PENDING`, increment `attempts`, set `run_after` with backoff. The item re-enters the queue for another worker to pick up.
- **Terminal rule**: If `attempts >= max_attempts`, mark `status → FAILED` with `last_error = 'REMEDIATION_STUCK'`.
- **Error code**: `REMEDIATION_STUCK`.

### Operational Invariant

No remediation queue item should remain in `RUNNING` for more than 1 hour without a heartbeat update. If it does, the watchdog will reclaim or terminalize it.

---

## 7. Ghost Item Policy

### Definition

A **ghost item** is a work item with `monitoring_enabled=true` that has never had an initial sync (`last_successful_sync_at IS NULL` and no sync ledger entries).

### Bootstrap Attempts

- **Tracked by**: `work_items.ghost_bootstrap_attempts` (integer, default 0).
- **Maximum**: 2 attempts.
- **Behavior**: The watchdog enqueues an initial sync job for each ghost item. Each attempt increments `ghost_bootstrap_attempts`.

### Terminalization

When `ghost_bootstrap_attempts >= 2` and the item still has no successful sync:
- `monitoring_enabled → false`
- `monitoring_disabled_reason → 'GHOST_NO_INITIAL_SYNC'`
- `monitoring_disabled_at → now()`

### Alerting / Warning Deduplication

- The warning "asuntos monitoreados sin sincronización inicial" is emitted **only once** at terminalization, not on every watchdog cycle.
- Once an item is terminalized (monitoring disabled), it is excluded from future ghost detection queries, preventing repeated warning emissions.

---

## 8. Incident Staleness Escalation Policy

### Auto-Escalation Rule

The watchdog checks open incidents with the following criteria:

| Condition | Threshold |
|---|---|
| `severity` | `CRITICAL` |
| Age (time since creation) | > 48 hours |
| `observation_count` | > 0 (and rising) |
| `action_count` | = 0 |

### Escalation Action

When all conditions are met:
1. Auto-create an escalation action (`action_type = 'AUTO_ESCALATE_STALE_CRITICAL'`) attached to the incident.
2. Increment the incident's `action_count` to prevent re-escalation on the next cycle.
3. The escalation is an **auto-nudge** — it surfaces the incident for operator attention but does not execute remediation.

### Operator Note

This policy exists to ensure that no CRITICAL incident can accumulate dozens of observations without any human or automated response. The escalation action makes the incident visible in the daily ops report and the audit wizard.

---

## 9. Preflight Check Policy

Preflight checks probe provider connectivity, authentication, and data shape before sync cycles.

- **CRITICAL_FAILURE** is declared only if **≥50% of providers fail** for **≥3 consecutive checks**.
- Individual provider failures below this threshold are logged as observations but do not block sync.

---

## Summary of Thresholds

| Policy | Threshold | Action |
|---|---|---|
| Deep dive TTL | 30 minutes RUNNING | → TIMED_OUT |
| Remediation queue liveness | 1 hour RUNNING | → Reclaim (PENDING) or FAILED |
| Ghost bootstrap attempts | 2 failed attempts | → Disable monitoring |
| Sentinel auto-disable | 5 consecutive failures | → Remove from active pool |
| Stale CRITICAL escalation | 48h open, 0 actions, observations rising | → Auto-escalation action |
| Sub-1s E2E classification | < 1 second duration | → PRECONDITION stage |
| Deep dive deduplication | 6-hour window per radicado | → Skip creation |
| Preflight CRITICAL | ≥50% providers × ≥3 consecutive | → CRITICAL_FAILURE |
| Chain no-progress | Identical cursor between entries | → Block continuation |
