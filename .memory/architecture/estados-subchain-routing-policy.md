# Memory: architecture/estados-subchain-routing-policy
Updated: 2026-02-13

## ESTADOS Subchain Routing Policy (deterministic, per-workflow)

The ESTADOS/PUBS subchain runs independently from ACTUACIONES. Provider order is governed by:
1. DB routes (`provider_category_routes_global` / `_org_override`) — PRIMARY first, then FALLBACK, sorted by priority
2. Built-in providers (`BUILTIN_PROVIDERS` in `resolveProviderChain.ts`) — injected between PRIMARY and FALLBACK external routes
3. Compatibility gate (`providerCoverageMatrix.ts`) — blocks incompatible providers

### Per-Workflow ESTADOS Chain

| Workflow   | Primary                          | Built-in Fallback  | Notes |
|------------|----------------------------------|--------------------|-------|
| CGP        | —                                | publicaciones      | Built-in only; no external route needed |
| LABORAL    | —                                | publicaciones      | Same as CGP |
| CPACA      | SAMAI_ESTADOS (EXTERNAL, DB route) | publicaciones    | Both consulted; merge non-duplicates |
| TUTELA     | —                                | (none)             | No ESTADOS providers |
| PENAL_906  | —                                | publicaciones      | Same as CGP |

### Key Design Decisions
- SAMAI_ESTADOS route scope changed from `BOTH` to `PUBS` (it only returns estados, not actuaciones)
- `publicaciones` added as BUILTIN fallback for CPACA in `resolveProviderChain.ts` and coverage matrix
- Compatibility gate updated: CPACA ESTADOS now allows `publicaciones` in addition to SAMAI_ESTADOS variants
- Merge semantics: UNION_PREFER_PRIMARY ensures SAMAI_ESTADOS data wins on field conflicts; complementary Publicaciones entries are preserved
- Provenance tracked via `act_provenance` — UI shows correct source badges even when canonical record is deduped
