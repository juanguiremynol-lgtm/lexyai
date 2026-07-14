/**
 * Scraping Module (post-consolidation, 2026-07-14)
 *
 * The legacy pluggable scraping adapter layer (default/external/noop adapters,
 * adapter-registry, scraping-service) was removed after being confirmed dead:
 * no runtime callers, no tests, no UI dependencies. All judicial ingestion is
 * handled server-side by the canonical provider chain in
 * `supabase/functions/_shared/providerAdapters/*` under the canonical provider
 * policy (CPNU / SAMAI / PP / SAMAI_ESTADOS / Tutelas).
 *
 * Only the milestone mapper survives — it is a pure text-classification
 * helper still consumed by `TimelineTab` and `PatternTestingPanel`.
 */
export * from './milestone-mapper';