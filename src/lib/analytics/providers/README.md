# Analytics Provider Adapters

This is the **ONLY** folder where external analytics SDK imports are allowed.

Each provider adapter:
1. Implements `AnalyticsProvider` from `../wrapper.ts`
2. Is registered via `registerProvider()` during app init
3. Never exposes the underlying SDK — all calls flow through the wrapper

## Current Adapters
- `console.ts` — Dev-only console logger (always available)

## Planned
- `posthog.ts` — PostHog product analytics (gated by secret + toggle)
- `sentry.ts` — Sentry error tracking (gated by secret + toggle)

## Rules
- **DO NOT** import `posthog-js`, `@sentry/*`, etc. outside this folder
- ESLint `no-restricted-imports` enforces this at build time
- The wrapper enforces: tenant gating, PII redaction, property allowlists
