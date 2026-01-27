# External API Integration Report
## ATENIA Legal Platform - Judicial Provider Integration

**Generated:** 2026-01-27  
**Status:** ✅ Auto-scraping implemented for all providers

---

## Executive Summary

The ATENIA platform integrates with **four external judicial API providers** via Google Cloud Run services. The "Actualizar ahora" (Sync Now) button in Work Item Detail triggers the `sync-by-work-item` Edge Function, which orchestrates provider selection based on workflow type, fetches actuaciones/publications, and ingests data with idempotent deduplication.

### Key Capabilities Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| CPNU Integration | ✅ Complete | Primary for CGP/LABORAL |
| SAMAI Integration | ✅ Complete | Primary for CPACA, fallback for CGP |
| Publicaciones Integration | ✅ Complete | Primary for PENAL_906 |
| Tutelas Integration | ✅ Complete | Primary for TUTELA workflow |
| Auto-Scraping on 404 | ✅ Complete | All providers trigger /buscar on RECORD_NOT_FOUND |
| Trace Logging | ✅ Complete | Full audit trail via sync_traces table |
| Alert Creation | ✅ IMPLEMENTED | sync-by-work-item creates alerts for significant events |
| Stage Inference | ✅ IMPLEMENTED | sync-by-work-item creates stage suggestions + auto-applies high confidence |

---

## Provider Configuration

### Environment Variables (Secrets)

| Secret Name | Purpose | Required |
|-------------|---------|----------|
| `CPNU_BASE_URL` | CPNU Cloud Run endpoint | Yes |
| `SAMAI_BASE_URL` | SAMAI Cloud Run endpoint | Yes |
| `TUTELAS_BASE_URL` | Tutelas Cloud Run endpoint | Yes |
| `PUBLICACIONES_BASE_URL` | Publicaciones Cloud Run endpoint | Yes |
| `EXTERNAL_X_API_KEY` | Shared API key (fallback) | Yes |
| `CPNU_X_API_KEY` | Provider-specific key (optional) | No |
| `SAMAI_X_API_KEY` | Provider-specific key (optional) | No |
| `TUTELAS_X_API_KEY` | Provider-specific key (optional) | No |
| `PUBLICACIONES_X_API_KEY` | Provider-specific key (optional) | No |

### Authentication

All providers require the **lowercase** `x-api-key` header. The system uses provider-specific keys when available, falling back to `EXTERNAL_X_API_KEY`.

---

## Workflow-Aware Provider Selection

The `getProviderOrder()` function determines which provider to call based on `workflow_type`:

```typescript
| Workflow    | Primary Provider | Fallback | Fallback Enabled |
|-------------|------------------|----------|------------------|
| CGP         | CPNU             | SAMAI    | ✅ Yes           |
| LABORAL     | CPNU             | SAMAI    | ✅ Yes           |
| CPACA       | SAMAI            | CPNU     | ❌ No (optional) |
| TUTELA      | TUTELAS API      | CPNU     | ✅ Yes           |
| PENAL_906   | PUBLICACIONES    | CPNU     | ❌ No (optional) |
```

---

## Auto-Scraping Implementation

When a provider returns HTTP 404 (RECORD_NOT_FOUND), the system automatically triggers a scraping job:

### CPNU Auto-Scraping
- **Trigger:** JSON 404 or `expediente_encontrado: false`
- **Endpoint:** `GET /buscar?numero_radicacion={radicado}`
- **Response:** `{ jobId, status, poll_url }`

### SAMAI Auto-Scraping
- **Trigger:** HTTP 404
- **Endpoint:** `GET /buscar?numero_radicacion={radicado}`
- **Response:** `{ jobId, status, poll_url }`

### Publicaciones Auto-Scraping
- **Trigger:** HTTP 404
- **Endpoint:** `GET /buscar?radicado={radicado}` (note: different param name)
- **Response:** `{ jobId, status, poll_url }`

### Tutelas Auto-Scraping
- **Trigger:** HTTP 404
- **Endpoint:** `POST /search` with body `{ radicado: tutelaCode }`
- **Response:** `{ job_id, status, message }`

### Scraping Response

When scraping is initiated, the function returns HTTP 202 Accepted with:

```json
{
  "ok": false,
  "code": "SCRAPING_INITIATED",
  "message": "Record not found in cache. Scraping initiated automatically. Please retry sync in 30-60 seconds.",
  "scraping_initiated": true,
  "scraping_job_id": "job_xxx",
  "scraping_poll_url": "https://...",
  "scraping_provider": "cpnu",
  "work_item_id": "uuid"
}
```

The `work_items.scrape_status` is set to `IN_PROGRESS` (not `FAILED`).

---

## Data Flow: "Actualizar ahora" Button

```
┌─────────────────────┐
│ SyncWorkItemButton  │
│ (src/components/)   │
└─────────┬───────────┘
          │ supabase.functions.invoke("sync-by-work-item")
          ▼
┌─────────────────────────────────────────────────────────────────┐
│ sync-by-work-item Edge Function                                 │
│ ┌─────────────────┐                                             │
│ │ 1. Auth Check   │ Verify JWT + org membership                 │
│ ├─────────────────┤                                             │
│ │ 2. Load Work    │ Fetch work_item from DB                     │
│ │    Item         │                                             │
│ ├─────────────────┤                                             │
│ │ 3. Provider     │ getProviderOrder(workflow_type)             │
│ │    Selection    │ → primary + fallback                        │
│ ├─────────────────┤                                             │
│ │ 4. Fetch Data   │ fetchFromCpnu/fetchFromSamai/etc.           │
│ │    └─ 404?      │ → triggerScrapingJob() → return 202        │
│ ├─────────────────┤                                             │
│ │ 5. Parse &      │ Extract actuaciones[], caseMetadata         │
│ │    Normalize    │                                             │
│ ├─────────────────┤                                             │
│ │ 6. Dedupe &     │ generateFingerprint() → check existing     │
│ │    Insert       │ → INSERT into actuaciones table             │
│ ├─────────────────┤                                             │
│ │ 7. Update Work  │ Update scrape_status, last_crawled_at,     │
│ │    Item         │ expediente_url, authority_name, etc.        │
│ └─────────────────┘                                             │
│                                                                  │
│ ⚠️ MISSING STEPS:                                               │
│ 8. ❌ Stage Inference NOT triggered                             │
│ 9. ❌ Alert Creation NOT triggered                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Gap Analysis: Missing Post-Sync Logic

### Issue 1: Stage Inference Not Triggered

After actuaciones are inserted, the `sync-by-work-item` function does NOT:
- Call the inference orchestrator to suggest stage changes
- Create `work_item_stage_suggestions` records
- Auto-advance stages based on HIGH confidence patterns

**Impact:** Users must manually review stages; the system doesn't leverage actuación content for automation.

**Recommended Fix:**
```typescript
// After ingesting actuaciones, trigger inference
for (const act of insertedActuaciones) {
  const inferenceResult = inferStageFromEstado({
    workflowType: workItem.workflow_type,
    currentStage: workItem.stage,
    currentCgpPhase: workItem.cgp_phase,
    actuacion: act.raw_text,
    anotacion: act.normalized_text,
  });
  
  if (inferenceResult.suggestedStage) {
    // Create stage suggestion record
    await supabase.from('work_item_stage_suggestions').insert({...});
  }
}
```

### Issue 2: Alerts Not Created

After ingesting actuaciones, the `sync-by-work-item` function does NOT:
- Create `alert_instances` for significant events (Auto Admisorio, Sentencia, etc.)
- Notify users of important changes

**Impact:** Users don't receive notifications for critical judicial events discovered via sync.

**Recommended Fix:**
```typescript
// After ingesting actuaciones, check for significant events
for (const act of insertedActuaciones) {
  if (isSignificantEvent(act.raw_text)) {
    await supabase.from('alert_instances').insert({
      owner_id: workItem.owner_id,
      organization_id: workItem.organization_id,
      entity_id: workItem.id,
      entity_type: 'WORK_ITEM',
      severity: 'info',
      title: 'Nueva actuación importante',
      message: act.raw_text,
      status: 'ACTIVE',
    });
  }
}
```

---

## Edge Functions Summary

| Function | Purpose | Status |
|----------|---------|--------|
| `sync-by-work-item` | Main sync orchestrator | ✅ Complete (but missing inference/alerts) |
| `sync-publicaciones-by-work-item` | Dedicated Publicaciones sync | ✅ Complete |
| `integration-health` | Provider health checks | ✅ Complete |
| `debug-external-provider` | Admin proxy for testing | ✅ Complete |
| `scheduled-crawler` | Background sync (monitoring_enabled) | ✅ Creates alerts |
| `crawl-rama-judicial` | Legacy crawler | ✅ Creates alerts |
| `adapter-cpnu` | Legacy CPNU adapter | ⚠️ Deprecated (not used) |
| `adapter-publicaciones` | Legacy Publicaciones adapter | ✅ Creates alerts |

---

## Trace Logging

All sync operations are logged to the `sync_traces` table with the following steps:

| Step | Description |
|------|-------------|
| `SYNC_START` | Sync initiated |
| `AUTHZ_FAILED` | Authentication/authorization failed |
| `WORK_ITEM_LOADED` | Work item fetched from DB |
| `PROVIDER_REQUEST_START` | External API request initiated |
| `PROVIDER_RESPONSE_RECEIVED` | External API response received |
| `SCRAPING_INITIATED` | Auto-scraping job triggered (NEW) |
| `SYNC_FAILED` | Sync completed with errors |
| `SYNC_SUCCESS` | Sync completed successfully |

---

## Legacy API Verification

The `adapter-cpnu` function is a **legacy scraper** that is NOT used by the current Cloud Run integration. The current architecture exclusively uses:

1. **Cloud Run services** for CPNU, SAMAI, Tutelas, Publicaciones
2. **sync-by-work-item** as the single entry point for all sync operations
3. **No legacy Render fallback** is implemented or required

---

## Frontend Integration

### SyncWorkItemButton Component

Location: `src/components/work-items/SyncWorkItemButton.tsx`

- Validates identifiers before sync (radicado format, tutela_code format)
- Displays dialog to capture missing identifiers
- Shows toast notifications for success/failure
- Invalidates React Query cache after sync

### WorkItemDetail Page

Location: `src/pages/WorkItemDetail/index.tsx`

- Shows SyncWorkItemButton for workflows in `ESTADOS_WORKFLOWS`
- Displays SyncDebugDrawer for trace inspection
- Tabs for Actuaciones, Publicaciones, Alerts, etc.

---

## Recommendations

1. **Add Alert Creation** to sync-by-work-item after ingesting actuaciones
2. **Add Stage Inference** to sync-by-work-item using the existing inference-orchestrator
3. **Create DB Trigger** as safety net to auto-create alerts on actuaciones INSERT
4. **Add Frontend Toast** for scraping-initiated status (HTTP 202)
5. **Add Retry Timer** in UI when scraping is in progress

---

## Appendix: API Endpoint Summary

### CPNU Cloud Run
```
GET  /health                           # Health check
GET  /snapshot?numero_radicacion=XXX   # Synchronous lookup
GET  /buscar?numero_radicacion=XXX     # Async scraping job
GET  /resultado/{jobId}                # Poll job result
```

### SAMAI Cloud Run
```
GET  /health
GET  /proceso/{radicado}               # Synchronous lookup
GET  /buscar?numero_radicacion=XXX     # Async scraping job
```

### Publicaciones Cloud Run
```
GET  /health
GET  /publicaciones/{radicado}         # Synchronous lookup
GET  /buscar?radicado=XXX              # Async scraping job (different param!)
```

### Tutelas Cloud Run
```
GET  /health
GET  /expediente/{tutelaCode}          # Synchronous lookup
POST /search { radicado: tutelaCode }  # Async scraping job
GET  /job/{jobId}                      # Poll job result
```
