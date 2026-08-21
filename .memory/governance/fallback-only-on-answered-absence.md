---
name: Fallback only on answered absence
description: Provider fallback may advance ONLY on empty/not-found; transient silence yields UNAVAILABLE and is recorded as a run failure
type: constraint
---

Provider chains may advance to the next provider **only when the current provider
answered and had nothing** (`NOT_FOUND`, `PROVIDER_NOT_FOUND`, `RADICADO_NOT_FOUND`,
`PROVIDER_EMPTY_RESULT`).

Silence — timeout, 5xx, network error, rate limit, `PROVIDER_ERROR`,
`SCRAPING_STUCK`, `UPSTREAM_ROUTE_MISSING`, `UNKNOWN_ERROR` — is **never** an absence
of judicial activity. It yields `FoundStatus = "UNAVAILABLE"`, which:

- never triggers fallback (`shouldTriggerFallback` fires on `NOT_FOUND` only),
- never rolls up into a `SUCCESS` sync run (downgraded to `PARTIAL`/`FAILED` with
  `error_code = PROVIDER_UNAVAILABLE`),
- must never be reported to the lawyer as "sin novedades".

**Retry semantics and fallback semantics are separate.** A transient code justifies
retrying the SAME provider (`isRetryableSameProvider`); it never justifies accepting a
DIFFERENT provider's answer as complete.

Two implementations must stay in lockstep:
- `supabase/functions/_shared/providerStrategy.ts` (`determineFoundStatus`, `shouldTriggerFallback`)
- `src/lib/resolveProviderChain.ts` (`decideFallback` → `STOP_UNAVAILABLE`)

Parity is guarded by `src/test/fallback-unavailable-z1.test.ts`.

**Why:** a missed actuación silently becomes a missed término. Collapsing
"we could not ask" into "there is nothing" is the most dangerous failure mode in the
system.
