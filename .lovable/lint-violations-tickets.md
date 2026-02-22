# .then()/.catch() Violation Remediation — Risk-Ordered Tickets

> Generated 2026-02-22. Violations fixed inline are marked ✅.

## Status Summary

| Category | Count |
|---|---|
| ✅ Fixed in this PR | 8 files (sync-pub, check-estados, confirm-courthouse, resolve-courthouse, demo-radicado, security-audit, process-pdf-job, html-to-pdf) |
| ⚠️ Escape hatches (lint-allow-then) | 2 (syncOrchestrator, wompi-webhook) |
| 🔴 Remaining .catch() violations | ~5 files (non-.json() catches) |

---

## Remaining Tickets (ordered by risk)

### 🔴 P1 — High Risk (signing/billing pipeline, data loss possible)

**T1: scheduled-daily-sync — `.catch()` on continuation trigger & supervisor invoke**
- File: `supabase/functions/scheduled-daily-sync/index.ts` (lines ~368, ~387)
- Risk: Silent failure on continuation dispatch = stalled daily sync chain; supervisor not invoked = missed post-sync alerts
- Fix: Wrap in try/catch, log error, set ledger `last_error`

**T2: andro-diagnose — `.catch(() => {})` on action audit insert**
- File: `supabase/functions/andro-diagnose/index.ts` (line ~470)
- Risk: Audit trail silently dropped — compliance gap
- Fix: `try { await ... } catch { console.warn(...) }`

**T3: demo-telemetry — `.catch(() => {})` on batch insert**
- File: `supabase/functions/demo-telemetry/index.ts` (line ~349)
- Risk: Low (telemetry), but pattern spreads; fix for consistency
- Fix: try/catch

### 🟡 P2 — Medium Risk (data enrichment, non-critical paths)

**T4: generate-evidence-bundle — `.json().catch()` on internal function calls**
- File: `supabase/functions/generate-evidence-bundle/index.ts` (lines ~163-173)
- Risk: Already allowlisted (`.json().catch`), but masks internal function 5xx errors behind `{ error: "parse_failed" }`
- Fix: Check response.ok first, then parse; throw on 5xx

**T5: sync-publicaciones-by-work-item — `Promise.race().catch()`**
- File: `supabase/functions/sync-publicaciones-by-work-item/index.ts` (line ~654)
- Risk: Allowlisted pattern (Promise.race), but the catch returns a synthetic result — verify timeout handling is correct
- Fix: Review only; pattern is acceptable

### 🟢 P3 — Low Risk (escape hatches, acceptable patterns)

**T6: _shared/syncOrchestrator.ts — `.then()` in concurrency pool**
- Escape hatch: `// lint-allow-then: concurrency pool pattern requires .then for tracking`
- Status: Acceptable — classic bounded-concurrency pattern

**T7: wompi-webhook-receiver — `.then()/.catch()` on HMAC verification**
- Escape hatch: `// lint-allow-then: WebCrypto API chaining in HMAC verification`  
- Status: Acceptable — already wrapped in outer try/catch
- Optional future fix: refactor to `const sig = await crypto.subtle.sign(...)`

---

## CI Enforcement

The lint script `scripts/lint-no-catch-on-supabase.sh` now:
1. Rejects ALL `.catch()` except `.json().catch()`, `Promise.race/all`, `].catch()`
2. Rejects ALL `.then()` unless line contains `// lint-allow-then: <justification>`
3. Requires justification string after colon (bare `// lint-allow-then` is a violation)
4. Prints CI summary with escape hatch count
