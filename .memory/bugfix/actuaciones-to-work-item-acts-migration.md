# Memory: bugfix/actuaciones-to-work-item-acts-migration
Updated: 2026-02-01

## Root Cause Analysis

The data pipeline had 4 critical bugs:

1. **Bug #1 — Wrong Target Table (ROOT CAUSE)**: 
   - `sync-by-work-item` was inserting actuaciones into legacy `actuaciones` table
   - The UI reads from `work_item_acts` table
   - Data was being fetched and stored correctly, just in the wrong place

2. **Bug #2 — Publicaciones Infinite Loop**: 
   - Already fixed in `sync-publicaciones-by-work-item` with polling strategy

3. **Bug #3 — Same issue for scheduled-crawler and scraping-service.ts**

4. **Bug #4 — EstadosTab Mixing Data (FIXED 2026-02-01)**:
   - `EstadosTab.tsx` had a unified query reading from BOTH `work_item_acts` AND `work_item_publicaciones`
   - This caused actuaciones (CPNU/SAMAI) to appear in Estados tab
   - "Buscar Estados" button was calling BOTH edge functions

## Fixes Applied

### Phase 1: Edge Function Fixes (Previous)

Changed all INSERT targets from legacy `actuaciones` table to canonical `work_item_acts` table.

### Phase 2: Frontend Separation (2026-02-01)

#### EstadosTab.tsx — Now queries ONLY `work_item_publicaciones`
- Removed all `work_item_acts` references
- Query key changed: `work-item-estados-unified` → `work-item-publicaciones`
- "Buscar Estados" button now calls ONLY `sync-publicaciones-by-work-item`
- Removed inference/stage suggestion logic (not applicable to publicaciones)

#### ActsTab.tsx — Now queries ONLY `work_item_acts`
- Changed from legacy `actuaciones` table to `work_item_acts`
- Created new `WorkItemActCard.tsx` component matching new schema

#### Files Modified:
- `src/pages/WorkItemDetail/tabs/EstadosTab.tsx` — Complete rewrite
- `src/pages/WorkItemDetail/tabs/ActsTab.tsx` — Schema migration
- `src/pages/WorkItemDetail/tabs/WorkItemActCard.tsx` — New component
- Deleted: `src/pages/WorkItemDetail/tabs/ActuacionCard.tsx`

## Architecture (MUST FOLLOW)

```
┌─────────────────────────────────────────────────────────┐
│                   ACTUACIONES TAB                        │
│  Data source: work_item_acts table ONLY                 │
│  Button: "Actualizar ahora" → sync-by-work-item         │
│  Edge function inserts into: work_item_acts              │
│  External APIs: CPNU (CGP/LABORAL/PENAL/TUTELA)         │
│                 SAMAI (CPACA)                            │
│  Content: Court clerk registry entries (NOT obligations) │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              ESTADOS / PUBLICACIONES TAB                  │
│  Data source: work_item_publicaciones table ONLY         │
│  Button: "Buscar Estados" → sync-publicaciones-by-work-item │
│  Edge function inserts into: work_item_publicaciones     │
│  External API: Publicaciones Procesales API (ALL types)  │
│  Content: Legal notifications with deadlines (OBLIGATIONS)│
└─────────────────────────────────────────────────────────┘
```

## Canonical Tables

| Purpose | Canonical Table | Legacy Table (DO NOT USE) |
|---------|-----------------|---------------------------|
| Actuaciones/Acts | `work_item_acts` | `actuaciones` |
| Publications/Estados | `work_item_publicaciones` | - |
| Deadlines | `work_item_deadlines` | `cgp_deadlines` |
| Milestones | `cgp_milestones` | (still used) |

## Schema Mapping

| `actuaciones` field | `work_item_acts` field |
|---------------------|------------------------|
| `raw_text` | `description` |
| `normalized_text` | `event_summary` |
| `adapter_name` | `source_platform` |
| `act_type_guess` | `act_type` |
| `filing_id` | ❌ Not used |
| `monitored_process_id` | ❌ Not used |
| - | `workflow_type` (NEW, required) |
| - | `scrape_date` (NEW) |
| - | `raw_data` (JSON for extras) |

## Verification Checklist

After deploying:
1. ✅ EstadosTab query reads ONLY from `work_item_publicaciones`
2. ✅ ActsTab query reads ONLY from `work_item_acts`
3. ✅ "Buscar Estados" calls ONLY `sync-publicaciones-by-work-item`
4. ✅ "Actualizar ahora" calls ONLY `sync-by-work-item`
5. ✅ Edge functions write to correct tables
6. Test with radicado: Estados tab shows only publicaciones, Actuaciones tab shows only actuaciones
