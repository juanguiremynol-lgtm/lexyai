# ATENIA Sync Architecture Audit v1
**Generated:** 2026-02-05
**Purpose:** Comprehensive inventory of all sync-related components for debugging and maintenance

---

## EXECUTIVE SUMMARY

The ATENIA sync architecture follows a **multi-provider, workflow-aware** design that fetches judicial data from 4 external APIs (CPNU, SAMAI, TUTELAS, PUBLICACIONES) and stores it in two canonical tables (`work_item_acts` for actuaciones, `work_item_publicaciones` for estados).

### Key Architecture Principles:
1. **Work-item-centric**: All data flows through `work_items` table
2. **Dual-table separation**: Actuaciones ≠ Publicaciones (legally distinct)
3. **Workflow-based provider selection**: CGP→CPNU, CPACA→SAMAI, etc.
4. **Idempotent ingestion**: Hash fingerprints prevent duplicates
5. **Self-sufficient polling**: Edge functions poll internally (no HTTP 202 to client)

---

## TASK 1: Edge Functions Inventory

### 1. sync-by-work-item
- **Location:** `supabase/functions/sync-by-work-item/index.ts`
- **Lines:** 3,184 total (LARGE - needs refactoring)
- **Purpose:** Primary sync function for existing work items. Fetches actuaciones from CPNU/SAMAI and writes to `work_item_acts`.
- **Trigger:** 
  - `useLoginSync` hook (on user login, max 3/day)
  - `scheduled-daily-sync` (cron at 7 AM COT)
  - Manual from debug console
- **Input parameters:** 
  ```json
  { "work_item_id": "uuid", "force_refresh?": boolean }
  ```
- **External APIs called:**
  - CPNU: `/snapshot?numero_radicacion={radicado}` (primary for CGP/LABORAL)
  - CPNU: `/buscar?numero_radicacion={radicado}` (triggers scraping job)
  - SAMAI: `/buscar?numero_radicacion={radicado}` (for CPACA, fallback for others)
  - SAMAI: `/resultado/{jobId}` (polling for results)
- **Database tables written to:**
  - `work_item_acts` (INSERT new actuaciones)
  - `work_items` (UPDATE metadata: authority_name, last_crawled_at, scrape_status)
  - `sync_traces` (trace logging for debugging)
  - `stage_suggestions` (PENDING stage inference records)
  - `alert_instances` (for significant events like sentencias)
- **Database tables read from:**
  - `work_items` (fetch work item details)
  - `organization_memberships` (verify user access)
  - `work_item_acts` (check existing fingerprints for dedup)
- **Returns:**
  ```json
  {
    "ok": boolean,
    "inserted_count": number,
    "skipped_count": number,
    "latest_event_date": string|null,
    "provider_used": string,
    "provider_attempts": Array,
    "trace_id": string,
    "code?": string
  }
  ```
- **Error handling:** Returns structured error codes (MISSING_RADICADO, UNAUTHORIZED, CPNU_SYNC_FAILED, etc.)
- **Key functions inside:**
  - `getProviderOrder()` (L214-238) - workflow-based provider selection
  - `detectSignificantEvent()` (L287-299) - alert generation
  - `inferStageFromActuacion()` (L409-428) - stage inference
  - `generateFingerprint()` (L466-482) - deduplication hash
  - `parseColombianDate()` (L484-512) - date parsing
  - `pollForScrapingResult()` (L628-694) - internal polling loop
  - `triggerCpnuScrapingJob()` (L699-799) - /buscar job creation
  - `triggerSamaiScrapingJob()` (L852-1008) - SAMAI scraping with cached data detection
  - `fetchFromCpnu()` - CPNU /snapshot call
  - `fetchFromSamai()` - SAMAI async flow
- **Polling configuration (L608-614):**
  ```typescript
  const POLLING_CONFIG = {
    maxAttempts: 12,       // 12 attempts
    pollIntervalMs: 5000,  // 5 seconds between polls
    // Total max wait: 60 seconds
  };
  ```
- **Known issues:**
  - ⚠️ File is 3,184 lines - needs refactoring into modules
  - ⚠️ SAMAI response parsing may be inconsistent (different response structures)

---

### 2. sync-publicaciones-by-work-item
- **Location:** `supabase/functions/sync-publicaciones-by-work-item/index.ts`
- **Lines:** 670 total
- **Purpose:** Fetches court publications (estados electrónicos, edictos) from Publicaciones API and writes to `work_item_publicaciones`.
- **Trigger:**
  - `useLoginSync` hook (paired with sync-by-work-item)
  - `scheduled-daily-sync`
  - Manual from debug console
- **Input parameters:**
  ```json
  { "work_item_id": "uuid", "_scheduled?": boolean }
  ```
- **External APIs called:**
  - Publicaciones v3: `GET /snapshot/{radicado}` (SYNCHRONOUS, 10-30s)
  - Publicaciones v3: `GET /search/{radicado}` (legacy fallback)
- **Database tables written to:**
  - `work_item_publicaciones` (INSERT new estados)
  - `alert_instances` (for new estados with deadlines)
- **Database tables read from:**
  - `work_items` (fetch work item and radicado)
  - `organization_memberships` (verify access - skipped for _scheduled)
  - `work_item_publicaciones` (check existing fingerprints)
- **Returns:**
  ```json
  {
    "ok": boolean,
    "inserted_count": number,
    "skipped_count": number,
    "alerts_created": number,
    "newest_publication_date": string|null,
    "inserted": Array<InsertedPublication>,
    "status": "SUCCESS"|"EMPTY"|"ERROR"
  }
  ```
- **Key functions inside:**
  - `fetchPublicaciones()` (L227-296) - v3 synchronous API call
  - `extractPublicacionesFromResponse()` (L301-325) - response parsing
  - `generatePublicacionFingerprint()` (L331-347) - deduplication
  - `calculateNextBusinessDay()` (L151-164) - términos calculation
  - `extractDateFromTitle()` (L179-216) - date parsing from filenames
- **Known issues:**
  - ✅ Working well - v3 synchronous API is reliable
  - First publicación successfully inserted per debug logs

---

### 3. sync-by-radicado
- **Location:** `supabase/functions/sync-by-radicado/index.ts`
- **Lines:** 978 total
- **Purpose:** Lookup and optionally create/update work items by radicado. Used by creation wizard.
- **Trigger:**
  - Frontend `useRadicadoLookup` hook
  - Creation wizard "Buscar" button
- **Input parameters:**
  ```json
  {
    "radicado": string,
    "mode": "LOOKUP" | "SYNC_AND_APPLY",
    "workflow_type?": string,
    "stage?": string,
    "client_id?": string,
    "create_if_missing?": boolean
  }
  ```
- **External APIs called:**
  - Calls `adapter-cpnu` edge function (internal)
  - Calls SAMAI directly: `GET /snapshot?numero_radicacion={radicado}`
  - Calls TUTELAS API for TUTELA workflow
- **Database tables written to:**
  - `work_items` (INSERT/UPDATE in SYNC_AND_APPLY mode)
- **Returns:**
  ```json
  {
    "ok": boolean,
    "work_item_id?": string,
    "created": boolean,
    "updated": boolean,
    "found_in_source": boolean,
    "source_used": string,
    "sources_checked": string[],
    "cgp_phase": "FILING"|"PROCESS",
    "process_data": ProcessData,
    "attempts": AttemptLog[]
  }
  ```
- **Key functions inside:**
  - `getProviderOrder()` (L100-115) - workflow-based provider selection
  - `validateRadicado()` (L138-186) - 23-digit validation
  - `detectAutoAdmisorio()` (L191-223) - FILING/PROCESS classification
  - `fetchFromCpnu()` (L255-353) - calls adapter-cpnu
  - `fetchFromSamai()` (L358-487) - direct SAMAI call
  - `fetchFromTutelas()` (L493+) - TUTELAS API call
- **Known issues:**
  - ⚠️ SAMAI party extraction may not work correctly
  - ⚠️ TUTELAS API not fully tested

---

### 4. scheduled-daily-sync
- **Location:** `supabase/functions/scheduled-daily-sync/index.ts`
- **Lines:** 370 total (provided in context)
- **Purpose:** Daily background sync for all organizations at 7 AM COT (12 PM UTC)
- **Trigger:** pg_cron schedule (must be configured manually in Supabase)
- **Input parameters:** None (HTTP request triggers it)
- **External APIs called:** Invokes `sync-by-work-item` and `sync-publicaciones-by-work-item` for each work item
- **Database tables written to:**
  - `auto_sync_daily_ledger` (per-org sync status)
  - `job_runs` (legacy job tracking)
  - Indirectly: `work_item_acts`, `work_item_publicaciones`
- **Key functions inside:**
  - `syncOrganization()` (L155-343) - per-org processing with ledger
  - `logJobRun()` (L345-370) - legacy job_runs logging
- **Configuration:**
  - `SYNC_ENABLED_WORKFLOWS`: ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906']
  - `TERMINAL_STAGES`: ['ARCHIVADO', 'FINALIZADO', 'EJECUTORIADO', ...]
  - `SUCCESS_THRESHOLD`: 0.9 (90% for SUCCESS vs PARTIAL)
  - Item limit: 30 per org (reduced from 100 due to 60s polling)
- **Known issues:**
  - ⚠️ Requires manual pg_cron configuration
  - ⚠️ May timeout with large organizations

---

### 5. fallback-sync-check
- **Location:** `supabase/functions/fallback-sync-check/index.ts`
- **Lines:** 321 total
- **Purpose:** Catches missed syncs from daily job; retries failed orgs
- **Trigger:** pg_cron every 2-4 hours
- **Configuration:**
  - `RETRY_HOURS`: [2, 4, 7, 10, 13] (hours after 07:00 COT)
  - `MAX_RETRIES`: 5
  - `CUTOFF_HOUR`: 20 (8 PM COT)
- **Database tables read from:**
  - `auto_sync_daily_ledger` (via RPC `get_pending_daily_syncs`)
  - `work_items` (for missed org detection)
- **Key functions inside:**
  - `findMissedOrganizations()` (L286-321) - detects orgs with no ledger entry

---

### 6. debug-external-provider
- **Location:** `supabase/functions/debug-external-provider/index.ts`
- **Lines:** 1,110 total
- **Purpose:** Admin proxy for testing external APIs without exposing secrets
- **Trigger:** Manual from Super Debug Console
- **Input parameters:**
  ```json
  {
    "provider": "cpnu"|"samai"|"tutelas"|"publicaciones",
    "identifier": { "radicado?": string, "tutela_code?": string },
    "mode?": "lookup"|"raw",
    "timeoutMs?": number
  }
  ```
- **Key functions inside:**
  - Route probing with `CPNU_ROUTE_CANDIDATES`, `SAMAI_ROUTE_CANDIDATES`, etc.
  - Error classification: `UPSTREAM_ROUTE_MISSING`, `RECORD_NOT_FOUND`, `UPSTREAM_AUTH`
  - `getApiKeyForProvider()` - provider-specific key selection

---

### 7. integration-health
- **Location:** `supabase/functions/integration-health/index.ts`
- **Lines:** 779 total
- **Purpose:** Verifies secrets are present and providers are reachable
- **Trigger:** Manual from Super Debug Console
- **Checks:**
  - Required secrets: CPNU_BASE_URL, SAMAI_BASE_URL, TUTELAS_BASE_URL, PUBLICACIONES_BASE_URL, EXTERNAL_X_API_KEY
  - Optional keys: CPNU_X_API_KEY, SAMAI_X_API_KEY, etc.
  - Connectivity: GET /health for each provider
  - Auth: GET /snapshot with test radicado
- **Key functions inside:**
  - `checkConnectivity()` - GET /health
  - `checkAuthWithSnapshot()` - authenticated endpoint test
  - `getApiKeyInfo()` - key presence check

---

### 8. adapter-cpnu
- **Location:** `supabase/functions/adapter-cpnu/index.ts`
- **Lines:** 1,648 total (LARGE)
- **Purpose:** Direct CPNU API adapter with retry logic and fallback to external scraping service
- **External APIs called:**
  - CPNU v2 API: Multiple endpoint candidates
  - Render fallback: `https://rama-judicial-api.onrender.com`
- **Key functions inside:**
  - `cpnuFetchJson()` (L345-468) - multi-candidate fetch with retries
  - `validateCompleteness()` (L260-286) - check for required fields
  - `classifyExternalApiError()` (L488+) - error classification

---

### 9. Other Sync-Related Functions

| Function | Location | Purpose | Status |
|----------|----------|---------|--------|
| `adapter-publicaciones` | `supabase/functions/adapter-publicaciones/` | Legacy adapter (may be unused) | ⚠️ Review needed |
| `adapter-historico` | `supabase/functions/adapter-historico/` | Portal Histórico adapter | Deprecated |
| `scheduled-publicaciones-monitor` | `supabase/functions/scheduled-publicaciones-monitor/` | Daily publicaciones discovery | Active |
| `normalize-actuaciones` | `supabase/functions/normalize-actuaciones/` | Actuaciones processing pipeline | Active |
| `sync-penal906-by-radicado` | `supabase/functions/sync-penal906-by-radicado/` | Penal-specific sync | Active |
| `process-monitor` | `supabase/functions/process-monitor/` | Background monitoring | Active |

---

## TASK 2: External API Integration Map

### 1. CPNU (Consulta de Procesos Nacional Unificado)
- **Base URL env var:** `CPNU_BASE_URL`
- **Current value:** ✅ Configured (secret present)
- **Auth method:** `x-api-key` header (lowercase)
- **Auth env var:** `CPNU_X_API_KEY` → fallback `EXTERNAL_X_API_KEY`
- **Endpoints used:**
  | Endpoint | Method | Purpose | Response |
  |----------|--------|---------|----------|
  | `/snapshot?numero_radicacion={rad}` | GET | Cached data lookup | Sync JSON or 404 |
  | `/buscar?numero_radicacion={rad}` | GET | Trigger scraping job | `{jobId, status}` |
  | `/resultado/{jobId}` | GET | Poll for job result | `{status, result}` |
  | `/health` | GET | Health check | 200 OK |
- **Response structure (actuaciones):**
  ```json
  {
    "procesos": [{
      "idProceso": 12345,
      "despacho": "Juzgado 002 Civil Municipal",
      "demandante": "NOMBRE",
      "demandado": "NOMBRE",
      "tipoProceso": "EJECUTIVO SINGULAR",
      "sujetos_procesales": [{ "tipo": "DEMANDANTE", "nombre": "..." }],
      "actuaciones": [{
        "fecha": "2025-06-01",
        "actuacion": "AUTO ADMISORIO",
        "anotacion": "Se admite la demanda...",
        "consActuacion": 1,
        "fechaRegistro": "2025-06-01 10:30:00"
      }]
    }]
  }
  ```
- **Fields extracted:**
  | API Field | DB Column | Table |
  |-----------|-----------|-------|
  | `procesos[0].despacho` | `authority_name` | `work_items` |
  | `procesos[0].sujetos_procesales` | parsed → `demandantes`, `demandados` | `work_items` |
  | `actuaciones[].fecha` | `act_date` | `work_item_acts` |
  | `actuaciones[].actuacion` | `description` | `work_item_acts` |
  | `actuaciones[].anotacion` | `annotation` | `work_item_acts` |
  | `actuaciones[].consActuacion` | `indice` | `work_item_acts` |
- **Workflow types that use this:** CGP (primary), LABORAL (primary), PENAL_906 (primary), TUTELA (fallback)
- **Edge functions that call this:** `sync-by-work-item`, `sync-by-radicado`, `adapter-cpnu`, `debug-external-provider`
- **Known parsing issues:** ✅ Generally working well

---

### 2. SAMAI (Sistema de Gestión Judicial CPACA)
- **Base URL env var:** `SAMAI_BASE_URL`
- **Current value:** ✅ Configured (secret present)
- **Auth method:** `x-api-key` header
- **Auth env var:** `SAMAI_X_API_KEY` → fallback `EXTERNAL_X_API_KEY`
- **Endpoints used:**
  | Endpoint | Method | Purpose | Response |
  |----------|--------|---------|----------|
  | `/buscar?numero_radicacion={rad}` | GET | Trigger scraping or return cached | `{success, status, result?, jobId?}` |
  | `/resultado/{jobId}` | GET | Poll for job result | `{status, data}` |
  | `/snapshot?numero_radicacion={rad}` | GET | (May not exist) | 404 |
- **Response structure (when cached):**
  ```json
  {
    "success": true,
    "status": "done",
    "cached": true,
    "result": {
      "corporacionNombre": "Consejo de Estado",
      "ponente": "Dr. Fulano",
      "etapa": "Fallo",
      "sujetos": [
        { "tipo": "DEMANDANTE", "nombre": "..." },
        { "tipo": "DEMANDADO", "nombre": "..." }
      ],
      "actuaciones": [{
        "fechaActuacion": "2025-06-01",
        "actuacion": "FALLO",
        "anotacion": "Se resuelve...",
        "fechaRegistro": "2025-06-01",
        "indice": "1"
      }]
    }
  }
  ```
- **Fields extracted:**
  | API Field | DB Column | Table |
  |-----------|-----------|-------|
  | `result.corporacionNombre` | `authority_name` | `work_items` |
  | `result.sujetos` | parsed → `demandantes`, `demandados` | `work_items` |
  | `actuaciones[].fechaActuacion` | `act_date` | `work_item_acts` |
  | `actuaciones[].actuacion` | `description` | `work_item_acts` |
- **Workflow types that use this:** CPACA (primary), CGP/LABORAL (fallback DISABLED)
- **Edge functions that call this:** `sync-by-work-item`, `sync-by-radicado`
- **Known parsing issues:**
  - ⚠️ **CRITICAL**: Party extraction may fail - different field names (`sujetos` vs `sujetos_procesales`)
  - ⚠️ Date field is `fechaActuacion` not `fecha`
  - ⚠️ `/snapshot` endpoint may return 404 (use `/buscar` instead)

---

### 3. TUTELAS (Corte Constitucional API)
- **Base URL env var:** `TUTELAS_BASE_URL`
- **Current value:** ✅ Configured (secret present)
- **Auth method:** `x-api-key` header
- **Auth env var:** `TUTELAS_X_API_KEY` → fallback `EXTERNAL_X_API_KEY`
- **Endpoints used:**
  | Endpoint | Method | Purpose |
  |----------|--------|---------|
  | `/expediente/{tutela_code}` | GET | Lookup by T-code |
  | `/api/expediente/{tutela_code}` | GET | Alternative path |
- **Workflow types that use this:** TUTELA (secondary/fallback)
- **Current status:** ⚠️ Possibly not working - needs testing

---

### 4. PUBLICACIONES (Publicaciones Procesales v3)
- **Base URL env var:** `PUBLICACIONES_BASE_URL`
- **Current value:** ✅ Configured (secret present)
- **API Version:** v3.0.0-simple (SYNCHRONOUS - no job queue)
- **Auth method:** `x-api-key` header
- **Auth env var:** `PUBLICACIONES_X_API_KEY` → fallback `EXTERNAL_X_API_KEY`
- **Endpoints used:**
  | Endpoint | Method | Purpose | Response |
  |----------|--------|---------|----------|
  | `/snapshot/{radicado}` | GET | Synchronous scrape + return | `{found, publicaciones}` |
  | `/search/{radicado}` | GET | Legacy fallback | Same |
- **Response structure:**
  ```json
  {
    "found": true,
    "totalResultados": 3,
    "publicaciones": [{
      "key": "pub_12345",
      "tipo": "ESTADO",
      "asset_id": "asset_xxx",
      "titulo": "003Estados20260122.pdf",
      "pdf_url": "https://...",
      "fecha_publicacion": "2026-01-22",
      "clasificacion": {
        "categoria": "ESTADO_ELECTRONICO",
        "es_descargable": true
      }
    }]
  }
  ```
- **Fields extracted:**
  | API Field | DB Column | Table |
  |-----------|-----------|-------|
  | `publicaciones[].titulo` | `title` | `work_item_publicaciones` |
  | `publicaciones[].pdf_url` | `pdf_url` | `work_item_publicaciones` |
  | `publicaciones[].asset_id` | → `hash_fingerprint` | `work_item_publicaciones` |
  | `publicaciones[].fecha_publicacion` | `fecha_fijacion` | `work_item_publicaciones` |
- **Workflow types that use this:** ALL (CGP, LABORAL, CPACA, PENAL_906)
- **Edge functions that call this:** `sync-publicaciones-by-work-item`
- **Known parsing issues:** ✅ Working well (first publicación inserted successfully)

---

## TASK 3: Database Schema Inventory

### 1. work_items
**Purpose:** Main case/process records (canonical entity)

| Column | Type | Purpose | Set by |
|--------|------|---------|--------|
| `id` | UUID | Primary key | Auto |
| `organization_id` | UUID | Tenant isolation | User creation |
| `owner_id` | UUID | Owner reference | User creation |
| `radicado` | TEXT | 23-digit case number | User/API |
| `workflow_type` | ENUM | Determines provider selection | User selection |
| `stage` | TEXT | Current procedural stage | Inference/Manual |
| `authority_name` | TEXT | Court/Judge name | Extracted from API |
| `demandantes` | TEXT | Plaintiff names | Extracted from API |
| `demandados` | TEXT | Defendant names | Extracted from API |
| `accionante` | TEXT | Tutela plaintiff | Extracted from API |
| `accionado` | TEXT | Tutela defendant | Extracted from API |
| `monitoring_enabled` | BOOLEAN | Eligible for auto-sync | User toggle |
| `last_synced_at` | TIMESTAMPTZ | Last successful sync | Edge function |
| `last_crawled_at` | TIMESTAMPTZ | Last API call attempt | Edge function |
| `scrape_status` | TEXT | NOT_ATTEMPTED/IN_PROGRESS/SUCCESS/FAILED | Edge function |
| `total_actuaciones` | INT | Count cache | Trigger/Sync |

**Triggers:**
- `set_work_item_org_from_owner` - auto-set organization_id
- Various RLS policy triggers

**RLS policies:** Yes, org-scoped

---

### 2. work_item_acts
**Purpose:** Individual actuaciones/case events (append-only)

| Column | Type | Purpose | Set by |
|--------|------|---------|--------|
| `id` | UUID | Primary key | Auto |
| `work_item_id` | UUID | FK to work_items | Edge function |
| `organization_id` | UUID | Tenant isolation | Trigger (from work_item) |
| `owner_id` | UUID | Owner reference | Edge function |
| `description` | TEXT | Actuación type (actuacion field) | From API |
| `annotation` | TEXT | Details (anotacion field) | From API |
| `act_date` | DATE | When it occurred | From API, parsed |
| `act_date_raw` | TEXT | Original date string | From API |
| `source` | TEXT | cpnu/samai/tutelas/manual | Edge function |
| `indice` | TEXT | Sequence number (consActuacion) | From API |
| `hash_fingerprint` | TEXT | Dedup key | Generated |
| `date_source` | TEXT | api_explicit/parsed_filename/etc | Edge function |
| `date_confidence` | TEXT | high/medium/low | Edge function |
| `is_canonical` | BOOLEAN | Verified record | Edge function |
| `is_archived` | BOOLEAN | Soft delete | Manual |
| `raw_data` | JSONB | Full API payload | Edge function |
| `created_at` | TIMESTAMPTZ | Ingestion time | Auto |

**Triggers:**
- `protect_work_item_acts_delete` - PREVENTS DELETE operations
- `set_actuacion_org_from_work_item` - auto-set organization_id

**Indexes:**
- `idx_work_item_acts_fingerprint` UNIQUE (work_item_id, hash_fingerprint)
- `idx_work_item_acts_work_item_id`
- `idx_work_item_acts_act_date`

**RLS policies:** Yes, org-scoped

---

### 3. work_item_publicaciones
**Purpose:** Estados/notifications from Publicaciones API (append-only)

| Column | Type | Purpose | Set by |
|--------|------|---------|--------|
| `id` | UUID | Primary key | Auto |
| `work_item_id` | UUID | FK to work_items | Edge function |
| `organization_id` | UUID | Tenant isolation | Trigger |
| `title` | TEXT | Publication title | From API |
| `pdf_url` | TEXT | PDF download link | From API |
| `entry_url` | TEXT | Web page link | From API |
| `pdf_available` | BOOLEAN | Has downloadable PDF | From API |
| `fecha_fijacion` | DATE | Posted date | From API |
| `fecha_desfijacion` | DATE | Removed date | From API |
| `terminos_inician` | DATE | Terms start (calculated) | Edge function |
| `tipo_publicacion` | TEXT | ESTADO/EDICTO/etc | From API |
| `source` | TEXT | Always 'publicaciones' | Edge function |
| `hash_fingerprint` | TEXT | Dedup key (asset_id based) | Generated |
| `is_archived` | BOOLEAN | Soft delete | Manual |
| `raw_json` | JSONB | Full API payload | Edge function |
| `created_at` | TIMESTAMPTZ | Ingestion time | Auto |

**Triggers:**
- `protect_work_item_publicaciones_delete` - PREVENTS DELETE operations
- `set_publicacion_org_from_work_item` - auto-set organization_id

**Indexes:**
- `idx_work_item_publicaciones_fingerprint` UNIQUE (work_item_id, hash_fingerprint)
- `idx_work_item_publicaciones_work_item_id`

**RLS policies:** Yes, org-scoped

---

### 4. auto_sync_daily_ledger
**Purpose:** Track daily cron sync status per organization

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `organization_id` | UUID | FK |
| `run_date` | DATE | YYYY-MM-DD in COT |
| `scheduled_for` | TIMESTAMPTZ | 07:00 COT target |
| `status` | ENUM | PENDING/RUNNING/SUCCESS/PARTIAL/FAILED |
| `items_targeted` | INT | Count of eligible items |
| `items_succeeded` | INT | Sync successes |
| `items_failed` | INT | Sync failures |
| `started_at` | TIMESTAMPTZ | Run start |
| `completed_at` | TIMESTAMPTZ | Run end |
| `last_heartbeat_at` | TIMESTAMPTZ | For stale lock detection |
| `retry_count` | INT | Retry attempts |
| `last_error` | TEXT | Error message |
| `run_id` | TEXT | Unique run identifier |

**Indexes:**
- UNIQUE (organization_id, run_date)

---

### 5. auto_sync_login_runs
**Purpose:** Track login-triggered syncs per user per day (max 3)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `user_id` | UUID | User who logged in |
| `organization_id` | UUID | User's org |
| `run_date` | DATE | YYYY-MM-DD in COT |
| `run_count` | INT | Syncs today (max 3) |
| `last_run_at` | TIMESTAMPTZ | Most recent sync |

**Indexes:**
- UNIQUE (user_id, organization_id, run_date)

---

### 6. sync_traces
**Purpose:** Detailed sync step logging for debugging

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `trace_id` | TEXT | Unique trace identifier |
| `work_item_id` | UUID | FK |
| `organization_id` | UUID | FK |
| `workflow_type` | TEXT | CGP/LABORAL/etc |
| `step` | TEXT | SYNC_START/PROVIDER_REQUEST/etc |
| `provider` | TEXT | cpnu/samai/etc |
| `http_status` | INT | Response status |
| `latency_ms` | INT | Request duration |
| `success` | BOOLEAN | Step succeeded |
| `error_code` | TEXT | UPSTREAM_AUTH/RECORD_NOT_FOUND/etc |
| `message` | TEXT | Truncated message |
| `meta` | JSONB | Additional data |
| `created_at` | TIMESTAMPTZ | Timestamp |

---

### 7. alert_instances
**Purpose:** Alerts generated from sync results (replaces legacy `alerts` table)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `entity_type` | TEXT | 'work_item' |
| `entity_id` | UUID | FK to work_items |
| `organization_id` | UUID | Tenant |
| `owner_id` | UUID | User |
| `severity` | TEXT | INFO/WARNING/CRITICAL |
| `title` | TEXT | Alert title |
| `message` | TEXT | Alert body |
| `status` | TEXT | FIRED/ACKNOWLEDGED/RESOLVED |
| `fired_at` | TIMESTAMPTZ | When created |

---

## TASK 4: Frontend Components Inventory

### Work Item Creation Wizard

#### File: `src/hooks/use-radicado-lookup.ts`
- **Purpose:** Hook for radicado validation and lookup
- **Sync-related functionality:**
  - `lookup()` - calls `sync-by-radicado` in LOOKUP mode
  - `sync()` - calls `sync-by-radicado` in SYNC_AND_APPLY mode
  - `validateRadicado()` - 23-digit validation, CGP ending check
- **API calls made:** `supabase.functions.invoke('sync-by-radicado')`
- **Fields auto-populated:**
  - `process_data.despacho` → `authority_name` ✅
  - `process_data.demandante` → `accionante` ⚠️ (may be empty for SAMAI)
  - `process_data.demandado` → `accionado` ⚠️ (may be empty for SAMAI)
- **Known issues:**
  - ⚠️ SAMAI response parsing for parties not working

---

### Login Sync Hook

#### File: `src/hooks/useLoginSync.ts`
- **Purpose:** Trigger automatic sync on user login (max 3/day)
- **Lines:** 243 total
- **Sync-related functionality:**
  - Checks `sessionStorage` to prevent duplicate runs
  - Calls `checkAndIncrementLoginSync()` RPC for rate limiting
  - Fetches eligible work items (limit 10, oldest sync first)
  - Calls BOTH edge functions in parallel per work item:
    1. `sync-by-work-item` → `work_item_acts`
    2. `sync-publicaciones-by-work-item` → `work_item_publicaciones`
- **Configuration:**
  - `SYNC_ENABLED_WORKFLOWS`: ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906']
  - `TERMINAL_STAGES`: ['ARCHIVADO', 'FINALIZADO', ...]
  - Item limit: 10 (reduced due to 60s polling)
  - Delay between items: 500ms
- **Located in:** `TenantLayout.tsx` (line 24: `useLoginSync()`)

---

### Auto-Sync Service

#### File: `src/lib/services/auto-sync-service.ts`
- **Purpose:** Shared sync logic for frontend components
- **Key functions:**
  - `getEligibleWorkItems()` - query eligible items
  - `syncWorkItemBatch()` - batch sync with progress callback
  - `isEligibleForSync()` - eligibility check
  - `getSyncStatusDescription()` - status labels

---

### Work Item Detail Tabs

#### File: `src/pages/WorkItemDetail/tabs/ActuacionesTab.tsx` (estimated)
- **Data source:** `work_item_acts` table
- **Query:** `supabase.from('work_item_acts').select('*').eq('work_item_id', ...)`
- **Filters:** `is_archived = false` (should be applied)

#### File: `src/pages/WorkItemDetail/tabs/EstadosTab.tsx`
- **Data source:** `work_item_publicaciones` table ONLY
- **Purpose:** Display court notifications with deadline highlighting
- **Note:** "Sync happens automatically on login and via daily cron - no manual sync button"

#### File: `src/pages/WorkItemDetail/tabs/PublicacionesTab.tsx`
- **Data source:** `work_item_publicaciones` table
- **Query:** `supabase.from('work_item_publicaciones').select('*').eq('work_item_id', ...)`

---

### Debug Console

#### File: `src/pages/ApiDebugPage.tsx`
- **Purpose:** Super Debug Console for platform admins
- **Tabs:**
  - Integration Health - calls `integration-health`
  - API Test - calls `debug-external-provider`
  - Sync History - reads `auto_sync_login_runs` and `auto_sync_daily_ledger`
  - Sync Test - full pipeline test

---

## TASK 5: Data Flow Diagrams

### Flow 1: Work Item Creation with Radicado Lookup

```
User enters radicado in wizard
          ↓
[Frontend: useRadicadoLookup.ts]
  - validateRadicadoForWorkflow() → 23-digit check, CGP ending
          ↓
supabase.functions.invoke('sync-by-radicado', { mode: 'LOOKUP' })
          ↓
[Edge Function: sync-by-radicado/index.ts]
          ↓
getProviderOrder(workflow_type) → determines provider
          ↓
┌─────────────────────────────────────────────────────┐
│ CGP/LABORAL: CPNU only (no SAMAI fallback)          │
│ CPACA: SAMAI only                                    │
│ TUTELA: CPNU primary → TUTELAS fallback             │
└─────────────────────────────────────────────────────┘
          ↓
[Provider Call]
  - CPNU: GET /snapshot?numero_radicacion={rad}
  - If 404 → GET /buscar → poll /resultado/{jobId}
  - SAMAI: GET /buscar → check if cached → poll if needed
          ↓
[Parse Response]
  - Extract despacho, sujetos_procesales, actuaciones
  - detectAutoAdmisorio() → FILING or PROCESS
          ↓
Returns to frontend:
{
  ok: true,
  found_in_source: true,
  source_used: "CPNU",
  cgp_phase: "PROCESS",
  process_data: {
    despacho: "Juzgado 002 Civil",
    demandante: "...",     ← ⚠️ MAY BE EMPTY FOR SAMAI
    demandado: "...",      ← ⚠️ MAY BE EMPTY FOR SAMAI
    total_actuaciones: 5
  }
}
          ↓
[Frontend: CreateWorkItemWizard]
  setValue('authority_name', process_data.despacho)
  setValue('accionante', process_data.demandante)  ← EMPTY?
          ↓
User reviews and submits
          ↓
[supabase.from('work_items').insert(...)]
```

---

### Flow 2: Auto-Sync on Login

```
User logs in → TenantLayout mounts
          ↓
[useLoginSync hook starts]
  - Check sessionStorage for today's sync key
  - If found → skip (already synced today in this browser session)
          ↓
checkAndIncrementLoginSync(userId, orgId)
  → RPC: atomic check + increment in auto_sync_login_runs
          ↓
If count >= 3:
  → Toast: "Límite alcanzado"
  → Return (no sync)
          ↓
Query work_items:
  - organization_id = current
  - monitoring_enabled = true
  - workflow_type IN ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906']
  - stage NOT IN terminal stages
  - radicado IS NOT NULL (and 23 digits)
  - ORDER BY last_synced_at ASC (oldest first)
  - LIMIT 10
          ↓
For each work item (parallel per item):
  ┌─────────────────────────────────────────────────────┐
  │ Promise.allSettled([                                │
  │   supabase.functions.invoke('sync-by-work-item'),   │
  │   supabase.functions.invoke('sync-publicaciones-by-work-item') │
  │ ])                                                  │
  └─────────────────────────────────────────────────────┘
          ↓
Track results: successCount, publicacionesCount, errorCount
          ↓
Set sessionStorage key → prevent repeat today
          ↓
Toast: "Sincronización completada: X actuaciones, Y estados"
```

---

### Flow 3: Daily Cron Sync (7 AM COT)

```
pg_cron triggers scheduled-daily-sync at 12:00 UTC (7:00 AM COT)
          ↓
[Edge Function: scheduled-daily-sync/index.ts]
          ↓
Query distinct organization_ids from work_items:
  - monitoring_enabled = true
  - workflow_type IN sync-enabled
  - stage NOT IN terminal
  - radicado NOT NULL
          ↓
For each organization:
  ┌─────────────────────────────────────────────────────┐
  │ acquire_daily_sync_lock(org_id, run_id)             │
  │   → Check auto_sync_daily_ledger                    │
  │   → If SUCCESS today → skip                         │
  │   → If RUNNING (with recent heartbeat) → skip       │
  │   → Otherwise → acquire lock, set RUNNING           │
  └─────────────────────────────────────────────────────┘
          ↓
Query work_items for org (LIMIT 30, oldest sync first)
          ↓
For each work item:
  - supabase.functions.invoke('sync-by-work-item')
  - If CGP/LABORAL/CPACA/PENAL_906:
      supabase.functions.invoke('sync-publicaciones-by-work-item')
  - Update work_items.last_synced_at
  - Heartbeat ledger every 10 items
          ↓
Calculate success rate:
  - >= 90% → SUCCESS
  - > 0 synced → PARTIAL
  - 0 synced → FAILED
          ↓
Update ledger with final status
          ↓
Log to job_runs table (legacy)
```

---

### Flow 4: Fallback Sync Check (Every 2-4 hours)

```
pg_cron triggers fallback-sync-check
          ↓
Check COT time:
  - If >= 20:00 → "Past cutoff, no retries"
          ↓
RPC: get_pending_daily_syncs()
  → Returns orgs with FAILED/PARTIAL status, retry_count < 5
          ↓
If no pending:
  - findMissedOrganizations() → orgs with no ledger entry today
  - If missed → invoke scheduled-daily-sync
          ↓
For each pending org:
  - Apply backoff (retry_count * 2000ms, max 10s)
  - Sync work items (limit 50)
  - Update ledger status
```

---

## TASK 6: Configuration & Environment Variables

### Supabase Edge Function Secrets

| Variable | Purpose | Used by | Status |
|----------|---------|---------|--------|
| `CPNU_BASE_URL` | CPNU API endpoint | sync-by-work-item, sync-by-radicado, adapter-cpnu, debug-external-provider, integration-health | ✅ Set |
| `SAMAI_BASE_URL` | SAMAI API endpoint | sync-by-work-item, sync-by-radicado, debug-external-provider, integration-health | ✅ Set |
| `TUTELAS_BASE_URL` | Tutelas API endpoint | sync-by-work-item (TUTELA), debug-external-provider, integration-health | ✅ Set |
| `PUBLICACIONES_BASE_URL` | Publicaciones v3 API | sync-publicaciones-by-work-item, debug-external-provider, integration-health | ✅ Set |
| `EXTERNAL_X_API_KEY` | Shared API auth key | All external calls (fallback) | ✅ Set |
| `CPNU_X_API_KEY` | CPNU-specific key | (optional override) | ❌ Not set |
| `SAMAI_X_API_KEY` | SAMAI-specific key | (optional override) | ❌ Not set |
| `TUTELAS_X_API_KEY` | Tutelas-specific key | (optional override) | ❌ Not set |
| `PUBLICACIONES_X_API_KEY` | Publicaciones-specific key | (optional override) | ❌ Not set |
| `CPNU_TEST_RADICADO` | Test radicado for health check | integration-health | ✅ Set |
| `SAMAI_TEST_RADICADO` | Test radicado for health check | integration-health | ✅ Set |

### Frontend Environment Variables

| Variable | Purpose | File |
|----------|---------|------|
| `VITE_SUPABASE_URL` | Supabase connection | .env |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key | .env |
| `VITE_SUPABASE_PROJECT_ID` | Project ID | .env |

### Database RPC Functions (Sync-related)

| Function | Purpose |
|----------|---------|
| `acquire_daily_sync_lock` | Idempotent lock for daily sync |
| `update_daily_sync_ledger` | Update ledger status/counts |
| `get_pending_daily_syncs` | Get orgs needing retry |
| `check_and_increment_login_sync` | Atomic login sync counter |
| `get_login_sync_status` | Read-only sync status |

---

## TASK 7: Known Issues & Gaps Catalog

### CRITICAL (Blocking functionality)

#### 1. SAMAI Party Extraction Not Working
- **Symptom:** Accionante/Accionado fields empty in creation wizard
- **Evidence:** User reported SAMAI responded (86ms) but parties empty
- **Root cause:** SAMAI response uses different field names
  - SAMAI: `result.sujetos` (not `sujetos_procesales`)
  - SAMAI: `fechaActuacion` (not `fecha`)
- **Files involved:**
  - `supabase/functions/sync-by-radicado/index.ts` L428-449 (fetchFromSamai)
  - `supabase/functions/sync-by-work-item/index.ts` L918-963 (cachedData extraction)
- **Status:** ⚠️ NOT FIXED
- **Fix required:**
  ```typescript
  // In fetchFromSamai(), check for both field names:
  const sujetos = proceso.sujetos_procesales || proceso.sujetos || [];
  ```

#### 2. SAMAI Actuaciones Count Shows 0
- **Symptom:** "Total encontradas: 0" even though SAMAI has actuaciones
- **Evidence:** SAMAI web shows 8 actuaciones for test radicado
- **Root cause:** Parser looking in wrong path or date field name
- **Files involved:** Same as above
- **Status:** ⚠️ NOT FIXED

---

### HIGH (Major functionality affected)

#### 3. Daily Sync May Timeout
- **Symptom:** Large organizations may not complete within function timeout
- **Evidence:** `scheduled-daily-sync` has 48-50 second timeout checks
- **Mitigation:** Reduced item limit from 100 to 30
- **Status:** ⚠️ Monitoring needed

#### 4. TUTELAS API Not Fully Tested
- **Symptom:** Unknown if TUTELAS API is working
- **Files involved:** 
  - `supabase/functions/sync-by-work-item/index.ts` (TUTELA workflow)
  - `supabase/functions/sync-by-radicado/index.ts` (fetchFromTutelas)
- **Status:** ⚠️ NEEDS TESTING

---

### MEDIUM (Partial functionality)

#### 5. Date Confidence Often Not Set
- **Symptom:** `date_confidence` column often NULL
- **Files involved:** Edge functions should set this during ingestion
- **Status:** ⚠️ Low priority

#### 6. Large Edge Functions Need Refactoring
- **Symptom:** `sync-by-work-item` is 3,184 lines, `adapter-cpnu` is 1,648 lines
- **Risk:** Hard to maintain, debug, and extend
- **Status:** ⚠️ Technical debt

---

### LOW (Minor issues)

#### 7. Path Prefix Configuration Complexity
- **Symptom:** Some providers may need `CPNU_PATH_PREFIX` for gateway deployments
- **Status:** Currently empty prefix works

---

## TASK 8: Code Duplication & Overlap Analysis

### Duplicate Parsing Functions

| Function | Location 1 | Location 2 | Differences |
|----------|------------|------------|-------------|
| `parseColombianDate()` | sync-by-work-item L484 | sync-by-radicado L228 | Similar logic |
| `generateFingerprint()` | sync-by-work-item L466 | sync-publicaciones L331 | Different hash structure |
| `getProviderOrder()` | sync-by-work-item L214 | sync-by-radicado L100 | Same logic, duplicated |
| `isValidRadicado()` | sync-by-work-item L452 | sync-by-radicado L138 | Same logic |
| `normalizeRadicado()` | Multiple locations | Multiple locations | Same logic |
| `joinUrl()` | sync-by-work-item L522 | debug-external-provider L183 | Same logic |
| `isHtmlCannotGet()` | sync-by-work-item L535 | integration-health L151 | Same logic |

### Recommended Consolidation

Create shared modules in `supabase/functions/_shared/`:
- `radicado-utils.ts` - validation, normalization
- `date-utils.ts` - Colombian date parsing
- `provider-config.ts` - workflow→provider mapping
- `fingerprint.ts` - hash generation
- `url-utils.ts` - URL joining

---

## TASK 9: Recommended Fix Priority

### Phase 1: Critical Fixes (Do First)

#### 1. Fix SAMAI Response Parsing
- **Files to modify:**
  - `supabase/functions/sync-by-radicado/index.ts` (L428-487)
  - `supabase/functions/sync-by-work-item/index.ts` (L852-1008)
- **Changes:**
  ```typescript
  // Handle both field name variants
  const sujetos = proceso.sujetos_procesales || proceso.sujetos || [];
  const actuaciones = (proceso.actuaciones || []).map(act => ({
    fecha: act.fechaActuacion || act.fecha || act.fecha_registro || '',
    actuacion: act.actuacion || '',
    anotacion: act.anotacion || '',
    indice: act.indice || '',
  }));
  ```
- **Estimated complexity:** Medium
- **Risk:** Low (only affects SAMAI path)

#### 2. Add SAMAI Party Extraction Debugging
- Add detailed logging to see exact SAMAI response structure
- Use `debug-external-provider` to capture raw response
- **Estimated complexity:** Low

---

### Phase 2: High Priority

#### 3. Test TUTELAS API End-to-End
- Create test case with known tutela_code
- Verify endpoint paths are correct
- **Estimated complexity:** Low

#### 4. Add Missing Date Confidence Logic
- Set `date_confidence` based on `date_source` value
- **Files:** Edge functions that insert to `work_item_acts`

---

### Phase 3: Medium Priority

#### 5. Refactor Large Edge Functions
- Extract shared utilities to `_shared/` folder
- Split `sync-by-work-item` into provider-specific modules
- **Estimated complexity:** High
- **Risk:** Medium (could break working code)

#### 6. Add Integration Tests
- Create test suite for each edge function
- Test with mock responses
- **Estimated complexity:** High

---

### DO NOT TOUCH (Working, leave alone)

- ✅ CPNU actuaciones parsing for CGP workflows
- ✅ Publicaciones v3 API integration (working well)
- ✅ `work_item_publicaciones` table structure
- ✅ Append-only protection triggers
- ✅ Login sync rate limiting (3/day)
- ✅ Daily sync ledger idempotency

---

## APPENDIX: File Line References

### Critical Code Sections

| Description | File | Lines |
|-------------|------|-------|
| Provider order config | sync-by-work-item | 214-238 |
| CPNU polling loop | sync-by-work-item | 628-694 |
| SAMAI cached data extraction | sync-by-work-item | 907-1008 |
| Fingerprint generation | sync-by-work-item | 466-482 |
| Stage inference patterns | sync-by-work-item | 310-407 |
| Publicaciones fetch (v3 sync) | sync-publicaciones | 227-296 |
| Date extraction from title | sync-publicaciones | 179-216 |
| Login sync hook | useLoginSync | 46-243 |
| Daily sync orchestration | scheduled-daily-sync | 80-149 |
| Per-org sync with ledger | scheduled-daily-sync | 155-343 |

---

**END OF AUDIT DOCUMENT**
