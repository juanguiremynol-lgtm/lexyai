/**
 * As-Is Architecture Map: External Provider Wizard → Orchestrator
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WIZARD (UI)                                                            │
 * │  Route: /platform/external-providers/wizard                            │
 * │  Component: ExternalProviderWizard (mode=PLATFORM | ORG)              │
 * │  Steps: Welcome→Template→Connector→Instance→Preflight→Simulation→    │
 * │         Mapping→Routing→E2E→Readiness→Success                        │
 * └───────────────────────┬─────────────────────────────────────────────────┘
 *                         │ Creates:
 *                         ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STORAGE (DB)                                                           │
 * │  provider_connectors:      key, capabilities, allowed_domains          │
 * │  provider_instances:       base_url, auth_type, scope (PLATFORM|ORG)  │
 * │  provider_instance_secrets: AES-256 encrypted (cipher+nonce)          │
 * │  provider_category_routes_global: workflow→connector routing          │
 * │  provider_category_routes_org_override: per-org overrides             │
 * │  provider_coverage_overrides: orchestrator + demo + wizard discovery   │
 * └───────────────────────┬─────────────────────────────────────────────────┘
 *                         │ Consumed by:
 *                         ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME                                                                │
 * │                                                                        │
 * │  providerCoverageMatrix.ts:                                           │
 * │    HARDCODED: COVERAGE_MAP + COMPATIBLE_CONNECTORS                    │
 * │    getProviderCoverageWithOverrides() merges DB overrides             │
 * │                                                                        │
 * │  syncOrchestrator.ts:                                                 │
 * │    orchestrateSync() → loadCoverageOverrides() → merge dynamic        │
 * │    providers into fetchFnRegistry via genericRemoteAdapter.ts         │
 * │                                                                        │
 * │  genericRemoteAdapter.ts:                                             │
 * │    ProviderFetchFn that invokes provider-sync-external-provider       │
 * │    Bridges wizard-registered providers into orchestrator pipeline     │
 * │                                                                        │
 * │  demo-radicado-lookup (edge fn): ✅ INTEGRATED                        │
 * │    Queries provider_coverage_overrides for dynamic providers          │
 * │    Invokes them via provider-sync-external-provider in parallel       │
 * │    Results merged into fanout alongside 5 canonical providers         │
 * │                                                                        │
 * │  sync-by-radicado (edge fn): ✅ INTEGRATED                            │
 * │    Queries provider_coverage_overrides per workflow_type              │
 * │    Dynamic providers invoked in parallel with built-in providers      │
 * │    Results merged via same dedup pipeline as canonical providers      │
 * │                                                                        │
 * │  provider-sync-external-provider (edge fn):                           │
 * │    Handles: secret resolution, SSRF-safe fetch, snapshot parsing,     │
 * │    mapping, canonical upsert, provenance, trace recording             │
 * │                                                                        │
 * │  BUILT-IN adapters (providerAdapters.ts):                             │
 * │    CPNU, SAMAI, TUTELAS — inline fetch → createLegacyAdapter()       │
 * │    PUBLICACIONES — separate edge fn (sync-publicaciones-by-work-item) │
 * │    SAMAI_ESTADOS — EXTERNAL via provider-sync-external-provider       │
 * │                                                                        │
 * │  Precedence: ORG_OVERRIDE > GLOBAL > BUILTIN > coverage_overrides    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * All 3 surfaces (Orchestrator, Demo Modal, Creation Wizard) now discover
 * and invoke dynamic providers from provider_coverage_overrides.
 * New providers added via wizard are automatically used WITHOUT code changes.
 */
