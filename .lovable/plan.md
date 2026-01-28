
# Fix Estados/Publicaciones Procesales Feature

## Executive Summary

The Estados/Publicaciones feature is broken due to three issues:
1. **API route mismatch**: The code uses path-based URL (`/publicaciones/{radicado}`) but the Cloud Run API expects query-param based URL (`/publicaciones?radicado={radicado}`)
2. **UI duplication**: Two tabs exist ("Estados" and "Publicaciones") for the same concept
3. **Missing integration**: CGP/LABORAL workflows don't call Publicaciones - it's only used for PENAL_906

## Root Cause Analysis

### Issue 1: API Route Mismatch
The `debug-external-provider` function (lines 55-58) correctly defines:
```typescript
const PUBLICACIONES_ROUTE_CANDIDATES = [
  '/publicaciones?radicado={id}',  // ← QUERY PARAM format
  '/api/publicaciones?radicado={id}',
];
```

But `sync-publicaciones-by-work-item` (line 148) and `sync-by-work-item` (line 1739) use:
```typescript
// WRONG: Path-based
await fetch(`${baseUrl}/publicaciones/${radicado}`)

// CORRECT: Query-param based
await fetch(`${baseUrl}/publicaciones?radicado=${radicado}`)
```

This explains the 404 errors - the API endpoint exists but expects a different format.

### Issue 2: UI Duplication
Two separate tabs exist in WorkItemDetail:
- **EstadosTab**: Reads from `work_item_acts` table, shows imported estados from ICARUS/scrapers
- **PublicacionesTab**: Reads from `work_item_publicaciones` table, syncs with Publicaciones API

These are conceptually THE SAME THING (court notifications) but split into two different tabs and tables.

### Issue 3: Missing Workflow Integration
The `sync-by-work-item` function only calls Publicaciones API for PENAL_906 workflow:
```typescript
case 'PENAL_906':
  return { primary: 'publicaciones', ... };
case 'CGP':
case 'LABORAL':
  return { primary: 'cpnu', fallback: null, ... };
  // ← NO PUBLICACIONES CALL
```

CGP and LABORAL need publicaciones (estados) ADDITIONALLY to actuaciones from CPNU.

## Implementation Plan

### Phase 1: Fix the API Endpoint (Edge Functions)

#### Task 1.1: Fix sync-publicaciones-by-work-item endpoint URL

**File**: `supabase/functions/sync-publicaciones-by-work-item/index.ts`

Change line 148:
```typescript
// FROM:
const response = await fetch(`${baseUrl}/publicaciones/${radicado}`, {

// TO:
const response = await fetch(`${baseUrl}/publicaciones?radicado=${radicado}`, {
```

Also add auto-scraping when 404 is received (similar to CPNU pattern):
```typescript
if (response.status === 404) {
  // Try /buscar endpoint for async scraping
  const buscarUrl = `${baseUrl}/buscar?radicado=${radicado}`;
  const buscarResponse = await fetch(buscarUrl, { method: 'GET', headers });
  
  if (buscarResponse.ok) {
    const jobData = await buscarResponse.json();
    return { 
      ok: true, 
      publicaciones: [],
      scraping_initiated: true,
      job_id: jobData.jobId 
    };
  }
}
```

#### Task 1.2: Fix sync-by-work-item Publicaciones endpoint (for PENAL_906)

**File**: `supabase/functions/sync-by-work-item/index.ts`

Change line 1739:
```typescript
// FROM:
const response = await fetch(`${baseUrl}/publicaciones/${radicado}`, {

// TO:
const response = await fetch(`${baseUrl}/publicaciones?radicado=${radicado}`, {
```

### Phase 2: Add Publicaciones Call for CGP/LABORAL

#### Task 2.1: Modify sync-by-work-item to also fetch Publicaciones for CGP/LABORAL

**File**: `supabase/functions/sync-by-work-item/index.ts`

After the main CPNU/SAMAI sync completes for CGP/LABORAL workflows, add an **additional** call to Publicaciones API:

```typescript
// After actuaciones sync for CGP/LABORAL (around line 2500)
if (['CGP', 'LABORAL'].includes(workItem.workflow_type)) {
  console.log(`[sync-by-work-item] CGP/LABORAL: Also fetching Publicaciones (estados)`);
  
  try {
    const publicacionesResult = await fetchFromPublicaciones(
      normalizedRadicado,
      workItem.id,
      workItem.owner_id,
      workItem.organization_id,
      supabase
    );
    
    if (publicacionesResult.insertedCount > 0) {
      result.warnings.push(
        `${publicacionesResult.insertedCount} nuevos estados/publicaciones encontrados`
      );
    }
  } catch (pubError) {
    // Non-blocking: log but don't fail the main sync
    console.warn('[sync-by-work-item] Publicaciones fetch failed (non-blocking):', pubError);
    result.warnings.push('Publicaciones fetch failed: ' + (pubError as Error).message);
  }
}
```

This ensures:
- CPNU/SAMAI fetch happens first (for actuaciones)
- Publicaciones fetch happens additionally (for estados)
- Publicaciones errors don't break the main sync

### Phase 3: Consolidate UI Tabs

#### Task 3.1: Rename and clarify tab purposes

**File**: `src/pages/WorkItemDetail/index.tsx`

Update the tab configuration (around line 108-115):
```typescript
// Estados tab stays (from work_item_acts - ICARUS/Excel imports)
if (ESTADOS_WORKFLOWS.includes(workflowType)) {
  baseTabs.push({ 
    value: "estados", 
    label: "Estados", 
    icon: <Activity className="h-4 w-4" /> 
  });
}

// Publicaciones tab (from work_item_publicaciones - Rama Judicial API)
if (ESTADOS_WORKFLOWS.includes(workflowType)) {
  baseTabs.push({ 
    value: "publicaciones", 
    label: "Publicaciones Rama", 
    icon: <Newspaper className="h-4 w-4" /> 
  });
}
```

Actually, the better approach is to **CONSOLIDATE** them into one tab that shows BOTH sources. 

#### Task 3.2: Create unified EstadosPublicacionesTab

**File**: `src/pages/WorkItemDetail/tabs/EstadosPublicacionesTab.tsx` (new file)

Create a consolidated component that:
1. Queries BOTH `work_item_acts` AND `work_item_publicaciones`
2. Merges and sorts by date
3. Displays with source badges (ICARUS, CPNU, Rama Judicial, etc.)
4. Single sync button that calls both syncs

```typescript
const { data: estados } = useQuery({
  queryKey: ["work-item-estados", workItem.id],
  queryFn: async () => {
    // Fetch from both sources
    const [actsResult, pubsResult] = await Promise.all([
      supabase.from("work_item_acts").select("*").eq("work_item_id", workItem.id),
      supabase.from("work_item_publicaciones").select("*").eq("work_item_id", workItem.id),
    ]);
    
    // Map to unified format and merge
    const unified = [
      ...mapActsToUnified(actsResult.data || []),
      ...mapPublicacionesToUnified(pubsResult.data || []),
    ];
    
    // Sort by date descending
    return unified.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  },
});
```

#### Task 3.3: Update WorkItemDetail to use consolidated tab

**File**: `src/pages/WorkItemDetail/index.tsx`

Replace separate tabs with single consolidated tab:
```typescript
// Single consolidated tab for estados + publicaciones
if (ESTADOS_WORKFLOWS.includes(workflowType)) {
  baseTabs.push({ 
    value: "estados", 
    label: "Estados", 
    icon: <Activity className="h-4 w-4" /> 
  });
}
// REMOVE: separate publicaciones tab
```

### Phase 4: Improve Empty State and Sync UX

#### Task 4.1: Update SyncWorkItemButton to also trigger Publicaciones

**File**: `src/components/work-items/SyncWorkItemButton.tsx`

After the main sync call, also call publicaciones sync for CGP/LABORAL:
```typescript
// In handleSync after main sync success
if (['CGP', 'LABORAL'].includes(workItem.workflow_type)) {
  // Also trigger publicaciones sync
  await supabase.functions.invoke('sync-publicaciones-by-work-item', {
    body: { work_item_id: workItem.id }
  });
}
```

OR (better approach): Let the edge function handle this internally (Task 2.1).

#### Task 4.2: Update invalidateQueries to include publicaciones

**File**: `src/components/work-items/SyncWorkItemButton.tsx` (line 118)

Already includes `work-item-publicaciones` - verified this is correct.

## Technical Details

### Database Tables Used
- `work_item_acts`: Stores imported estados from ICARUS/Excel and CPNU/SAMAI actuaciones
- `work_item_publicaciones`: Stores estados from Publicaciones Rama Judicial API
- Both have `work_item_id` FK and `hash_fingerprint` for deduplication

### API Contracts

**Cloud Run Publicaciones API:**
- `GET /publicaciones?radicado={23-digit-radicado}` - Sync lookup
- `GET /buscar?radicado={23-digit-radicado}` - Async scraping job
- Auth: `x-api-key` header (lowercase, from EXTERNAL_X_API_KEY)

**Response format (expected):**
```json
{
  "radicado": "05001333300320250013300",
  "publicaciones": [
    {
      "fecha_publicacion": "2025-01-15",
      "fecha_fijacion": "2025-01-15",
      "fecha_desfijacion": "2025-01-16",
      "tipo_publicacion": "Estado",
      "anotacion": "Auto admite demanda",
      "despacho": "Juzgado 001 Civil Municipal"
    }
  ]
}
```

### Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/sync-publicaciones-by-work-item/index.ts` | Modify | Fix endpoint URL, add auto-scraping |
| `supabase/functions/sync-by-work-item/index.ts` | Modify | Fix PENAL_906 endpoint, add Publicaciones call for CGP/LABORAL |
| `src/pages/WorkItemDetail/index.tsx` | Modify | Consolidate tabs |
| `src/pages/WorkItemDetail/tabs/EstadosTab.tsx` | Modify | Add publicaciones data source |
| `src/pages/WorkItemDetail/tabs/PublicacionesTab.tsx` | Delete or keep | Decide on consolidation approach |

## Success Criteria

1. ✅ Clicking "Actualizar ahora" on CGP/LABORAL work items fetches BOTH actuaciones AND estados
2. ✅ Estados data appears in `work_item_publicaciones` table
3. ✅ UI shows ONE consolidated section or clearly labeled separate tabs
4. ✅ 404 responses trigger auto-scraping with user-friendly feedback
5. ✅ No regression in CPNU/SAMAI functionality
6. ✅ Edge function logs show successful API calls

## Testing Plan

1. Test API endpoint fix with debug-external-provider
2. Test sync-publicaciones-by-work-item manually
3. Test sync-by-work-item for CGP work item
4. Verify data appears in database
5. Verify UI displays the data
6. Test auto-scraping flow for new radicados
