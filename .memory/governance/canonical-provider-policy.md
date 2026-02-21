# Memory: governance/canonical-provider-policy
Updated: 2026-02-21

## IMMUTABLE PROVIDER POLICY — Requires Double Authorization at Org Level to Change

### The 5 Canonical External APIs

These are the ONLY 5 external data providers in ATENIA. No more, no less.

| # | Key            | Display Name              | Scope        | Target Table               | Primary For            | Fallback For      |
|---|----------------|---------------------------|--------------|----------------------------|------------------------|--------------------|
| 1 | cpnu           | CPNU (Rama Judicial)      | ACTUACIONES  | work_item_acts             | CGP, LABORAL, PENAL_906 | TUTELA, CPACA      |
| 2 | samai          | SAMAI (Consejo de Estado) | ACTUACIONES  | work_item_acts             | CPACA                  | CGP, LABORAL       |
| 3 | publicaciones  | Publicaciones Procesales  | ESTADOS      | work_item_publicaciones    | ALL categories         | —                  |
| 4 | samai_estados  | SAMAI Estados             | ESTADOS      | work_item_publicaciones    | CPACA                  | —                  |
| 5 | tutelas        | Tutelas API               | ACTUACIONES  | work_item_acts             | TUTELA                 | —                  |

### Scope Invariants (NEVER violated)

- ACTUACIONES providers (cpnu, samai, tutelas) write ONLY to `work_item_acts`
- ESTADOS providers (publicaciones, samai_estados) write ONLY to `work_item_publicaciones`
- These two scopes are NEVER mixed in tables, tabs, or API calls
- Provider key "none", null, or "" is REJECTED at every write point

### Routing Rules Per Category

```
CGP         → actuaciones: [cpnu]                    → estados: [publicaciones]
LABORAL     → actuaciones: [cpnu]                    → estados: [publicaciones]
PENAL_906   → actuaciones: [cpnu]                    → estados: [publicaciones]
CPACA       → actuaciones: [samai]                   → estados: [publicaciones, samai_estados]
TUTELA      → actuaciones: [cpnu, tutelas, samai]    → estados: [publicaciones]
```

### Demo Lookup Routing (Landing Page Modal)

The demo modal ALWAYS fans out to ALL 5 providers regardless of category, because:
1. We don't know the category of the user's radicado
2. As a sales surface, we want maximum data coverage
3. Fan-out results are merged and deduped before display

### Work Item Wizard Routing

When creating a work item via the wizard, the user selects the category FIRST. Then:
1. Primary providers for that category are queried
2. Fallback providers are queried to validate the user's category choice
3. If data is found in a fallback provider but NOT the primary, the user is prompted to correct their category selection

### Key Naming Rules

- All internal/indexed fields use lowercase canonical keys: `cpnu`, `samai`, `publicaciones`, `samai_estados`, `tutelas`
- User-facing text uses display names: "CPNU (Rama Judicial)", "SAMAI (Consejo de Estado)", etc.
- Legacy aliases (tutelas-api, Rama Judicial, SAMAI_ESTADOS) are normalized via `normalizeProviderKey()`
- Source of truth: `supabase/functions/_shared/providerRegistry.ts` and `src/lib/providerRegistry.ts`

### Change Control

Any modification to this policy requires:
1. Written justification with technical rationale
2. Approval from the organization administrator
3. Double confirmation before execution
4. Update to both providerRegistry.ts files (edge function + frontend)
5. Update to this policy document
