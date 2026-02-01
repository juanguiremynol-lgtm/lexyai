# ATENIA - Complete Architecture Audit Document
**Generated:** 2026-02-01
**Version:** 1.0

---

## PART 1: DATABASE SCHEMA

### 1.1 Complete Table Inventory

| Table Name | Purpose | Key Columns | Foreign Keys | RLS | Dedup Key | Used By |
|------------|---------|-------------|--------------|-----|-----------|---------|
| **work_items** | Canonical entity for all judicial matters | id, owner_id, organization_id, workflow_type, radicado, stage | owner_id→profiles, organization_id→organizations, client_id→clients, matter_id→matters | Yes | radicado+owner_id | All work item components |
| **work_item_acts** | Actuaciones (court clerk registry entries) | id, work_item_id, description, act_date, source_platform, hash_fingerprint | work_item_id→work_items | Yes | hash_fingerprint | ActsTab.tsx, sync-by-work-item |
| **work_item_publicaciones** | Estados/Publicaciones (legal notifications) | id, work_item_id, title, pdf_url, fecha_fijacion, fecha_desfijacion | work_item_id→work_items | Yes | hash_fingerprint | EstadosTab.tsx, sync-publicaciones-by-work-item |
| **alert_instances** | Modern alert system | id, owner_id, entity_type, entity_id, severity, status, title, message | owner_id→profiles, organization_id→organizations | Yes | fingerprint | AlertsTasksTab.tsx |
| **alert_rules** | Configurable alert rules | id, owner_id, entity_type, entity_id, rule_kind | owner_id→profiles, organization_id→organizations | Yes | - | Alert system |
| **email_outbox** | Email queue for notifications | id, organization_id, status, recipient_email, subject | organization_id→organizations | Yes | - | process-email-outbox edge function |
| **hearings** | Scheduled hearings | id, owner_id, work_item_id, hearing_date, hearing_type | work_item_id→work_items | Yes | - | HearingsTab.tsx, hearing-reminders |
| **clients** | Client entities | id, owner_id, organization_id, name, id_number, email | organization_id→organizations | Yes | - | Clients.tsx, work_items |
| **matters** | Legal matters | id, owner_id, client_name, matter_name | owner_id→profiles | Yes | - | work_items |
| **profiles** | User profiles | id, full_name, organization_id, timezone | id→auth.users | Yes | - | All authenticated queries |
| **organizations** | Multi-tenant organizations | id, name, metadata | - | Yes | - | All tenant-scoped queries |
| **organization_memberships** | Org membership pivot | organization_id, user_id, role | organization_id→organizations | Yes | org_id+user_id | TenantRouteGuard |
| **subscriptions** | Billing subscriptions | id, organization_id, plan_id, status | organization_id→organizations, plan_id→subscription_plans | Yes | - | SubscriptionProvider |
| **subscription_plans** | Available plans | id, name, price, max_items | - | Yes | - | Billing |
| **audit_logs** | Audit trail | id, organization_id, action, entity_type, actor_user_id | organization_id→organizations | Yes | - | PlatformAuditPage |
| **sync_traces** | Sync debugging traces | id, trace_id, work_item_id, step, provider | work_item_id→work_items | Yes | - | SyncDebugDrawer |
| **work_item_stage_suggestions** | Stage inference suggestions | id, work_item_id, suggested_stage, confidence, status | work_item_id→work_items | Yes | - | StageSuggestionBannerDB |
| **work_item_stage_audit** | Stage change audit trail | id, work_item_id, previous_stage, new_stage, actor_user_id, change_source | work_item_id→work_items | Yes | - | StageAuditHistory |
| **cgp_milestones** | CGP workflow milestones | id, work_item_id, milestone_type, event_date | work_item_id→work_items | Yes | - | MilestonesChecklist |
| **cgp_term_instances** | Legal term tracking | id, work_item_id, term_name, due_date, status | work_item_id→work_items | Yes | - | DeadlinesTab |
| **cgp_term_templates** | Term definition templates | id, code, name, duration_value | - | Yes | - | Term engine |
| **colombian_holidays** | Holiday calendar | id, holiday_date, name | - | Yes | - | Term calculation |
| **auto_sync_daily_ledger** | Daily sync tracking | id, organization_id, run_date, status | organization_id→organizations | Yes | org_id+run_date | scheduled-daily-sync |
| **auto_sync_login_runs** | Login sync rate limiting | id, user_id, organization_id, run_date, run_count | organization_id→organizations | Yes | user_id+org_id+run_date | useLoginSync |
| **job_runs** | Background job logging | id, job_name, status, started_at, finished_at | - | Yes | - | Platform console |
| **platform_admins** | Platform admin users | user_id | user_id→auth.users | Yes | - | PlatformRouteGuard |
| **platform_vouchers** | Courtesy vouchers | id, code, token_hash, status | - | Yes | token_hash | VoucherRedeemPage |
| **billing_subscription_state** | Subscription state | organization_id, plan_code, comped_until_at | organization_id→organizations | Yes | organization_id | Billing |
| **actuaciones** | **[LEGACY - DO NOT USE]** Old actuaciones table | id, filing_id, monitored_process_id, raw_text, hash_fingerprint | work_item_id→work_items | Yes | hash_fingerprint | ⚠️ scraping-service.ts still references for legacy compat |
| **filings** | **[LEGACY - DO NOT USE]** Old filings table | id, matter_id, status, radicado | matter_id→matters | Yes | - | ⚠️ WorkItemDetail legacy resolution |
| **monitored_processes** | **[LEGACY - DO NOT USE]** Old processes table | id, radicado, monitoring_enabled | client_id→clients | Yes | - | ⚠️ WorkItemDetail legacy resolution |
| **cgp_items** | **[LEGACY - DO NOT USE]** Old CGP items table | id, owner_id, phase, radicado | - | Yes | - | ⚠️ WorkItemDetail legacy resolution |
| **peticiones** | **[LEGACY - DO NOT USE]** Old petitions table | id, owner_id, phase | client_id→clients | Yes | - | ⚠️ WorkItemDetail legacy resolution |
| **cpaca_processes** | **[LEGACY - DO NOT USE]** Old CPACA table | id, owner_id, phase, radicado | client_id→clients | Yes | - | ⚠️ WorkItemDetail legacy resolution |
| **process_events** | **[LEGACY - DO NOT USE]** Old events table | id, filing_id, monitored_process_id | work_item_id→work_items | Yes | - | ⚠️ Legacy ingestion |

---

### 1.2 The `work_items` Table — Full Column Listing

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| owner_id | uuid | NO | - | Owner (FK to profiles) |
| organization_id | uuid | YES | NULL | Multi-tenant org (FK to organizations) |
| workflow_type | workflow_type enum | NO | 'CGP' | CGP/LABORAL/CPACA/TUTELA/PETICION/GOV_PROCEDURE/PENAL_906 |
| stage | text | YES | NULL | Current pipeline stage |
| status | item_status enum | NO | 'ACTIVE' | ACTIVE/INACTIVE/CLOSED/ARCHIVED |
| cgp_phase | cgp_phase enum | YES | NULL | FILING/PROCESS (CGP only) |
| cgp_phase_source | cgp_phase_source enum | YES | 'AUTO' | AUTO/MANUAL |
| source | item_source enum | YES | NULL | ICARUS_IMPORT/SCRAPE_API/MANUAL/EMAIL_IMPORT/MIGRATION |
| source_reference | text | YES | NULL | Import run ID or reference |
| source_payload | jsonb | YES | NULL | Raw source data |
| client_id | uuid | YES | NULL | FK to clients |
| matter_id | uuid | YES | NULL | FK to matters |
| radicado | text | YES | NULL | 23-digit case number |
| radicado_verified | boolean | NO | false | Whether radicado confirmed via API |
| tutela_code | text | YES | NULL | T+digits tutela code (TUTELA only) |
| authority_name | text | YES | NULL | Court/despacho name |
| authority_email | text | YES | NULL | Court email |
| authority_city | text | YES | NULL | Court city |
| authority_department | text | YES | NULL | Court department |
| demandantes | text | YES | NULL | Plaintiff(s) names |
| demandados | text | YES | NULL | Defendant(s) names |
| title | text | YES | NULL | Display title |
| description | text | YES | NULL | Description |
| notes | text | YES | NULL | User notes |
| auto_admisorio_date | date | YES | NULL | Date of admission order |
| filing_date | date | YES | NULL | Date filed |
| last_action_date | date | YES | NULL | Last actuación date |
| last_action_description | text | YES | NULL | Last actuación summary |
| is_flagged | boolean | NO | false | User flag |
| monitoring_enabled | boolean | NO | true | Enable auto-sync |
| email_linking_enabled | boolean | NO | false | Link emails to case |
| expediente_url | text | YES | NULL | Electronic file URL |
| sharepoint_url | text | YES | NULL | SharePoint/OneDrive link |
| scrape_status | text | YES | 'NOT_ATTEMPTED' | NOT_ATTEMPTED/IN_PROGRESS/SUCCESS/FAILED |
| last_checked_at | timestamptz | YES | NULL | Last sync check time |
| last_crawled_at | timestamptz | YES | NULL | Last successful crawl |
| last_synced_at | timestamptz | YES | NULL | Last sync timestamp |
| last_inference_date | date | YES | NULL | Rate limit: last stage inference date |
| stage_inference_enabled | boolean | NO | true | Enable stage inference |
| scraped_fields | jsonb | YES | NULL | Metadata from API |
| source_links | jsonb | YES | NULL | Source URLs array |
| total_actuaciones | integer | NO | 0 | Count of actuaciones |
| legacy_filing_id | uuid | YES | NULL | Migration: old filings.id |
| legacy_process_id | uuid | YES | NULL | Migration: old monitored_processes.id |
| legacy_cgp_item_id | uuid | YES | NULL | Migration: old cgp_items.id |
| legacy_peticion_id | uuid | YES | NULL | Migration: old peticiones.id |
| legacy_cpaca_id | uuid | YES | NULL | Migration: old cpaca_processes.id |
| legacy_admin_process_id | uuid | YES | NULL | Migration: old admin_processes.id |
| created_at | timestamptz | NO | now() | Created timestamp |
| updated_at | timestamptz | NO | now() | Updated timestamp |
| deleted_at | timestamptz | YES | NULL | Soft delete timestamp |

---

### 1.3 The `work_item_acts` Table — Full Column Listing

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| owner_id | uuid | NO | - | FK to profiles |
| organization_id | uuid | YES | NULL | FK to organizations |
| work_item_id | uuid | NO | - | FK to work_items |
| workflow_type | text | YES | 'CGP' | Workflow type |
| description | text | NO | - | Full actuación + anotación text |
| event_summary | text | YES | NULL | Truncated summary (500 chars) |
| act_date | date | YES | NULL | Parsed actuación date |
| act_date_raw | text | YES | NULL | Original date string |
| event_date | date | YES | NULL | Event date (fallback) |
| act_type | text | YES | NULL | AUTO_ADMISORIO, SENTENCIA, etc. |
| source | text | YES | 'RAMA_JUDICIAL' | Data source |
| source_platform | text | YES | NULL | CPNU, SAMAI, TUTELAS |
| source_url | text | YES | NULL | API URL |
| source_reference | text | YES | NULL | Run/trace ID |
| despacho | text | YES | NULL | Court name |
| hash_fingerprint | text | NO | - | Dedup key: work_item_id+date+text_hash |
| scrape_date | date | YES | NULL | When scraped |
| raw_data | jsonb | YES | NULL | Full API response |
| created_at | timestamptz | NO | now() | Created timestamp |

**Unique Index:** `(work_item_id, hash_fingerprint)`

---

### 1.4 The `work_item_publicaciones` Table — Full Column Listing

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| id | uuid | NO | gen_random_uuid() | Primary key |
| owner_id | uuid | NO | - | FK to profiles |
| organization_id | uuid | YES | NULL | FK to organizations |
| work_item_id | uuid | NO | - | FK to work_items |
| title | text | NO | - | Publication title |
| annotation | text | YES | NULL | Additional notes |
| pdf_url | text | YES | NULL | PDF download URL |
| entry_url | text | YES | NULL | Portal entry URL |
| pdf_available | boolean | NO | true | Whether PDF exists |
| published_at | date | YES | NULL | Publication date |
| **fecha_fijacion** | date | YES | NULL | **CRITICAL:** When posted to bulletin |
| **fecha_desfijacion** | date | YES | NULL | **CRITICAL:** When removed (términos start next business day!) |
| despacho | text | YES | NULL | Court name |
| tipo_publicacion | text | YES | NULL | Publication type |
| terminos_inician | date | YES | NULL | Calculated: next business day after desfijación |
| source | text | YES | 'PUBLICACIONES_API' | Data source |
| source_id | text | YES | NULL | External ID |
| hash_fingerprint | text | NO | - | Dedup key |
| raw_data | jsonb | YES | NULL | Full API response |
| created_at | timestamptz | NO | now() | Created timestamp |

**Unique Index:** `(work_item_id, hash_fingerprint)`

---

### 1.5 Legacy Tables Still Referenced

#### `actuaciones` — **[LEGACY]**
- **Still referenced by:** `src/lib/scraping/scraping-service.ts` (lines 264-269) for legacy compatibility check
- **Should be migrated to:** `work_item_acts`
- **Status:** Can be deprecated once all legacy paths removed

#### `filings` — **[LEGACY]**
- **Still referenced by:** `src/pages/WorkItemDetail/index.tsx` polymorphic resolution
- **Should be migrated to:** `work_items` with `legacy_filing_id` link
- **Status:** Keep for read-only backwards compat

#### `monitored_processes` — **[LEGACY]**
- **Still referenced by:** `src/pages/WorkItemDetail/index.tsx` polymorphic resolution
- **Should be migrated to:** `work_items` with `legacy_process_id` link
- **Status:** Keep for read-only backwards compat

---

## PART 2: EDGE FUNCTIONS — COMPLETE INVENTORY

| Function Name | File Path | Auth | External APIs | Tables READ | Tables WRITTEN | Triggered By | Status |
|---------------|-----------|------|---------------|-------------|----------------|--------------|--------|
| sync-by-work-item | supabase/functions/sync-by-work-item/ | JWT | CPNU, SAMAI, TUTELAS | work_items, work_item_acts | work_item_acts, work_items, alert_instances, sync_traces | SyncWorkItemButton | ✅ Active |
| sync-publicaciones-by-work-item | supabase/functions/sync-publicaciones-by-work-item/ | JWT | Publicaciones API | work_items, work_item_publicaciones | work_item_publicaciones, work_items, alert_instances | EstadosTab "Buscar Estados" | ✅ Active |
| sync-by-radicado | supabase/functions/sync-by-radicado/ | JWT | CPNU, SAMAI, TUTELAS | work_items | work_items, work_item_acts | CreateWorkItemWizard | ✅ Active |
| sync-penal906-by-radicado | supabase/functions/sync-penal906-by-radicado/ | JWT | CPNU | work_items | work_items, work_item_acts | PENAL_906 sync | ⚠️ Stub |
| scheduled-crawler | supabase/functions/scheduled-crawler/ | Service | CPNU (direct) | work_items | work_item_acts, work_items, alert_instances | pg_cron (daily) | ✅ Active |
| scheduled-daily-sync | supabase/functions/scheduled-daily-sync/ | Service | - | work_items, auto_sync_daily_ledger | auto_sync_daily_ledger | pg_cron 0 12 * * * | ✅ Active |
| fallback-sync-check | supabase/functions/fallback-sync-check/ | Service | - | auto_sync_daily_ledger, work_items | - | pg_cron (4-hourly) | ✅ Active |
| hearing-reminders | supabase/functions/hearing-reminders/ | Service | - | hearings, profiles | email_outbox | pg_cron | ✅ Active |
| peticion-reminders | supabase/functions/peticion-reminders/ | Service | - | work_items | email_outbox, alert_instances | pg_cron | ✅ Active |
| send-reminder | supabase/functions/send-reminder/ | Service | Resend API | profiles | email_outbox | Internal calls | ✅ Active |
| process-email-outbox | supabase/functions/process-email-outbox/ | Service | Email Gateway | email_outbox | email_outbox | pg_cron | ✅ Active |
| resend-webhook | supabase/functions/resend-webhook/ | Webhook | - | email_outbox | email_outbox, audit_logs | Resend webhooks | ✅ Active |
| debug-external-provider | supabase/functions/debug-external-provider/ | JWT+Admin | CPNU, SAMAI, TUTELAS, Publicaciones | - | - | PlatformApiDebugPage | ✅ Active |
| integration-health | supabase/functions/integration-health/ | JWT | All providers | - | - | Platform console | ✅ Active |
| adapter-cpnu | supabase/functions/adapter-cpnu/ | JWT | CPNU | - | - | sync-by-radicado | ✅ Active |
| adapter-publicaciones | supabase/functions/adapter-publicaciones/ | JWT | Publicaciones | - | - | Internal | ✅ Active |
| adapter-historico | supabase/functions/adapter-historico/ | JWT | Historico | - | - | Internal | ⚠️ Limited |
| icarus-sync | supabase/functions/icarus-sync/ | JWT | ICARUS | work_items, integrations | work_items | IcarusTest | ⚠️ Legacy |
| icarus-import-excel | supabase/functions/icarus-import-excel/ | JWT | - | - | work_items | Excel import | ✅ Active |
| purge-old-audit-logs | supabase/functions/purge-old-audit-logs/ | Service | - | audit_logs | audit_logs, job_runs | pg_cron | ✅ Active |
| log-audit | supabase/functions/log-audit/ | JWT | - | - | audit_logs | Internal | ✅ Active |
| delete-work-items | supabase/functions/delete-work-items/ | JWT | - | work_items | work_items (soft delete) | DeleteWorkItemDialog | ✅ Active |
| billing-* | supabase/functions/billing-*/ | JWT | Stripe | subscriptions | billing tables | Billing flows | ✅ Active |
| whoami | supabase/functions/whoami/ | JWT | - | profiles | - | Debug | ✅ Active |

---

### 2.1 sync-by-work-item — Complete Data Flow

**File:** `supabase/functions/sync-by-work-item/index.ts` (3181 lines)

**Input:**
```typescript
{ work_item_id: string; force_refresh?: boolean }
```

**Headers:** `Authorization: Bearer <jwt>`, `X-Trace-Id: <optional>`

**Provider Order Logic (lines 214-238):**
```typescript
function getProviderOrder(workflowType: string): ProviderOrderConfig {
  switch (workflowType) {
    case 'CPACA': return { primary: 'samai', fallback: 'cpnu', fallbackEnabled: false };
    case 'TUTELA': return { primary: 'cpnu', fallback: 'samai', fallbackEnabled: true };
    case 'PENAL_906': return { primary: 'cpnu', fallback: 'samai', fallbackEnabled: true };
    case 'CGP':
    case 'LABORAL': return { primary: 'cpnu', fallback: null, fallbackEnabled: false };
    default: return { primary: 'cpnu', fallback: null, fallbackEnabled: false };
  }
}
```

**External API Calls:**
- **CPNU:** `${CPNU_BASE_URL}/snapshot?numero_radicacion=${radicado}`
- **SAMAI:** `${SAMAI_BASE_URL}/proceso/${radicado}` (no /snapshot!)
- **Headers:** `x-api-key: ${CPNU_X_API_KEY || EXTERNAL_X_API_KEY}`

**INSERT Target (CORRECT):** `work_item_acts` table
```typescript
const { error } = await supabase.from('work_item_acts').insert({
  owner_id,
  organization_id,
  work_item_id,
  workflow_type,
  description: `${act.actuacion}${act.anotacion ? ' - ' + act.anotacion : ''}`,
  event_summary: description.slice(0, 500),
  act_date: parseColombianDate(act.fecha),
  source_platform: provider === 'cpnu' ? 'CPNU' : 'SAMAI',
  hash_fingerprint: generateFingerprint(work_item_id, actDate, text),
  scrape_date: new Date().toISOString().split('T')[0],
  raw_data: { ...act }
});
```

**Stage Inference:** Creates `PENDING` suggestions in `work_item_stage_suggestions` (never auto-applies)

**Alert Creation:** Detects significant events (sentencia, auto admisorio) → inserts to `alert_instances`

---

### 2.2 sync-publicaciones-by-work-item — Complete Data Flow

**File:** `supabase/functions/sync-publicaciones-by-work-item/index.ts` (808 lines)

**Input:**
```typescript
{ work_item_id: string; _scheduled?: boolean }
```

**API Flow (POLLING STRATEGY - lines 219-415):**
1. `GET ${PUBLICACIONES_BASE_URL}/buscar?radicado=${radicado}` → returns `job_id`
2. Poll `GET ${PUBLICACIONES_BASE_URL}/resultado/${job_id}` every 5s for 60s max
3. Parse results when `status === 'done'`

**INSERT Target (CORRECT):** `work_item_publicaciones` table
```typescript
await supabase.from('work_item_publicaciones').insert({
  owner_id: workItem.owner_id,
  organization_id: workItem.organization_id,
  work_item_id: workItem.id,
  title: pub.title,
  annotation: pub.annotation,
  pdf_url: pub.pdf_url,
  entry_url: pub.entry_url,
  published_at: parseDate(pub.published_at),
  fecha_fijacion: parseDate(pub.fecha_fijacion),
  fecha_desfijacion: parseDate(pub.fecha_desfijacion),
  terminos_inician: calculateNextBusinessDay(pub.fecha_desfijacion),
  despacho: pub.despacho,
  tipo_publicacion: pub.tipo_publicacion,
  hash_fingerprint: generatePublicacionFingerprint(...),
  source: 'PUBLICACIONES_API',
  raw_data: pub.raw
});
```

---

## PART 3: EXTERNAL API INTEGRATION

### 3.1 Cloud Run Services

#### CPNU (cpnu-https-jobs)
- **Base URL Secret:** `CPNU_BASE_URL`
- **API Key Secret:** `CPNU_X_API_KEY` (fallback: `EXTERNAL_X_API_KEY`)
- **Endpoints:**
  - `GET /health` - Health check
  - `GET /snapshot?numero_radicacion={id}` - Direct lookup
  - `GET /buscar?numero_radicacion={id}` - Trigger scraping, returns job_id
  - `GET /resultado/{jobId}` - Poll for results
- **Used by:** CGP, LABORAL, PENAL_906, TUTELA workflows

#### SAMAI (samai-https-jobs)
- **Base URL Secret:** `SAMAI_BASE_URL`
- **API Key Secret:** `SAMAI_X_API_KEY` (fallback: `EXTERNAL_X_API_KEY`)
- **Endpoints:**
  - `GET /health` - Health check
  - `GET /proceso/{radicado}` - Direct lookup (NOT /snapshot!)
  - `GET /buscar?numero_radicacion={id}` - Trigger scraping
  - `GET /resultado/{jobId}` - Poll for results
- **Used by:** CPACA workflow (primary)

#### Publicaciones Procesales
- **Base URL Secret:** `PUBLICACIONES_BASE_URL`
- **API Key Secret:** `PUBLICACIONES_X_API_KEY` (fallback: `EXTERNAL_X_API_KEY`)
- **Endpoints:**
  - `GET /publicaciones?radicado={id}` - Query param, NOT path!
  - `GET /buscar?radicado={id}` - Trigger scraping
  - `GET /resultado/{jobId}` - Poll for results
- **⚠️ NO /snapshot endpoint exists!**
- **Used by:** Estados tab for all judicial workflows

#### Tutelas API
- **Base URL Secret:** `TUTELAS_BASE_URL`
- **API Key Secret:** `TUTELAS_X_API_KEY` (fallback: `EXTERNAL_X_API_KEY`)
- **Endpoints:**
  - `GET /expediente/{id}` - Path-based lookup
  - `POST /search` with body `{radicado: tutelaCode}` - Async search
- **Used by:** TUTELA workflow fallback

### 3.2 Authentication Pattern

All external calls use lowercase header:
```typescript
headers: {
  'x-api-key': Deno.env.get('PROVIDER_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY'),
  'Content-Type': 'application/json',
}
```

### 3.3 Auto-Scraping / Polling Pattern

When provider returns 404 RECORD_NOT_FOUND:
1. Call `/buscar?radicado={id}` to trigger scraping
2. Return HTTP 202 with `{scraping_initiated: true, job_id: '...'}`
3. Frontend enters 60s countdown → auto-retry
4. If still scraping, poll every 10s (max 5 attempts)

---

## PART 4: FRONTEND ARCHITECTURE

### 4.1 Routing

**File:** `src/App.tsx`

| Path | Component | Purpose | Auth |
|------|-----------|---------|------|
| `/` | PublicLandingPage | Marketing landing | No |
| `/auth` | Auth | Login/Signup | No |
| `/pricing` | PublicPricingPage | Pricing page | No |
| `/app/dashboard` | Dashboard | Main dashboard | Yes |
| `/app/work-items/:id` | WorkItemDetailPage | Work item detail | Yes |
| `/app/processes` | Processes | Work item list | Yes |
| `/app/clients` | Clients | Client list | Yes |
| `/app/hearings` | Hearings | Hearing calendar | Yes |
| `/app/alerts` | Alerts | Alert list | Yes |
| `/app/settings` | Settings | User settings | Yes |
| `/app/new-process` | NewProcess | Create work item wizard | Yes |
| `/platform/*` | PlatformLayout | Admin console | Admin |

### 4.2 Work Item Detail Page

**File:** `src/pages/WorkItemDetail/index.tsx`

**Tab Structure:**

| Tab | Component | Data Source | Query Key | Sync Button | Edge Function |
|-----|-----------|-------------|-----------|-------------|---------------|
| Resumen | OverviewTab | work_items | work-item-detail | SyncWorkItemButton | sync-by-work-item |
| Notas | NotesTab | work_item_notes | work-item-notes | - | - |
| Estados | EstadosTab | **work_item_publicaciones ONLY** | work-item-publicaciones | "Buscar Estados" | sync-publicaciones-by-work-item |
| Línea de Tiempo | TimelineTab | work_item_acts, work_item_publicaciones | combined | - | - |
| Actuaciones | ActsTab | **work_item_acts ONLY** | work-item-actuaciones | (via SyncWorkItemButton) | sync-by-work-item |
| Términos | DeadlinesTab | cgp_term_instances | work-item-terms | - | - |
| Audiencias | HearingsTab | hearings | work-item-hearings | - | - |
| Alertas/Tareas | AlertsTasksTab | alert_instances | work-item-alerts | - | - |

### 4.3 EstadosTab.tsx — Complete Analysis

**File:** `src/pages/WorkItemDetail/tabs/EstadosTab.tsx` (468 lines)

**Query (CORRECT - publicaciones only):**
```typescript
const { data: estados } = useQuery({
  queryKey: ["work-item-publicaciones", workItem.id],
  queryFn: async () => {
    const { data: pubs } = await supabase
      .from("work_item_publicaciones")  // ONLY this table!
      .select("*")
      .eq("work_item_id", workItem.id)
      .order("published_at", { ascending: false });
    return pubs.map(pub => ({
      id: pub.id,
      fecha_fijacion: pub.fecha_fijacion,
      fecha_desfijacion: pub.fecha_desfijacion,
      // ...
    }));
  },
});
```

**"Buscar Estados" Button (CORRECT - publicaciones only):**
```typescript
const syncPublicacionesMutation = useMutation({
  mutationFn: async () => {
    const { data, error } = await supabase.functions.invoke(
      "sync-publicaciones-by-work-item",  // ONLY this function!
      { body: { work_item_id: workItem.id } }
    );
    if (error) throw error;
    return data;
  },
});
```

**Deadline Calculation:**
```typescript
function calculateNextBusinessDay(dateStr: string): Date {
  const date = new Date(dateStr);
  let nextDay = addDays(date, 1);
  while (isWeekend(nextDay)) {
    nextDay = addDays(nextDay, 1);
  }
  return nextDay;  // Términos start the next business day after desfijación
}
```

### 4.4 ActsTab.tsx — Complete Analysis

**File:** `src/pages/WorkItemDetail/tabs/ActsTab.tsx` (277 lines)

**Query (CORRECT - acts only):**
```typescript
const { data: acts } = useQuery({
  queryKey: ["work-item-actuaciones", workItem.id],
  queryFn: async () => {
    const { data: actuaciones } = await supabase
      .from("work_item_acts")  // ONLY this table!
      .select("*")
      .eq("work_item_id", workItem.id)
      .order("act_date", { ascending: false });
    return actuaciones;
  },
});
```

### 4.5 SyncWorkItemButton.tsx — Complete Analysis

**File:** `src/components/work-items/SyncWorkItemButton.tsx` (586 lines)

**Edge Function Called:** `sync-by-work-item`

**State Machine:**
- `idle` → `syncing` → `waiting` (60s countdown) → `polling` (5 attempts) → `success`/`error`

**202 SCRAPING_INITIATED Handler:**
```typescript
if (result.scraping_initiated || result.code === 'SCRAPING_INITIATED') {
  handleScrapingInitiated(result);  // Start 60s countdown, then auto-retry
}
```

---

## PART 5: ALERT & NOTIFICATION SYSTEM

### 5.1 Alert Creation

**Entity Types:** `WORK_ITEM`, `CGP_CASE`, `CPACA`, `TUTELA`, `LABORAL`, `PENAL_906`, `GOV_PROCEDURE`

**Severity Levels:** `INFO`, `WARNING`, `CRITICAL`

**Alert Triggers:**
- New actuaciones detected → `INFO` (or `WARNING` if sentencia/auto admisorio)
- New publicaciones with fecha_desfijacion → `WARNING` (deadline trigger)
- Hearing reminders → `INFO`
- Deadline approaching → `WARNING`/`CRITICAL`

### 5.2 Email Flow

1. Alert created → Check user preferences
2. If `email_alerts_enabled` → Insert to `email_outbox`
3. `process-email-outbox` edge function (cron) → Call email gateway
4. `resend-webhook` → Update delivery status

---

## PART 6: STAGE INFERENCE ENGINE

### 6.1 Inference Entry Points

**Triggered from:** `sync-by-work-item` after inserting actuaciones

**Rate Limit:** Once per work item per day (America/Bogota timezone)
- Check: `SELECT check_inference_rate_limit(p_work_item_id, 'America/Bogota')`
- After: `SELECT record_inference_run(p_work_item_id)`

### 6.2 Pattern Rules (from sync-by-work-item lines 310-406)

| Pattern | Stages by Workflow | Confidence |
|---------|-------------------|------------|
| `auto admisorio`, `admite demanda` | CGP→AUTO_ADMISORIO, LABORAL→AUTO_ADMISORIO, TUTELA→TUTELA_ADMITIDA | 0.9 |
| `sentencia`, `fallo` | CGP→SENTENCIA, LABORAL→SENTENCIA_1A_INSTANCIA, TUTELA→FALLO_PRIMERA_INSTANCIA | 0.9 |
| `audiencia inicial` | CGP→AUDIENCIA_INICIAL | 0.85 |
| `notificación personal/estado/aviso` | CGP→NOTIFICACION | 0.8 |
| `contestación demanda` | CGP→CONTESTACION | 0.85 |
| `mandamiento de pago` | CGP→MANDAMIENTO_PAGO | 0.9 |

### 6.3 Stage Application

**CRITICAL:** Inference NEVER auto-applies stages. All suggestions are created as `PENDING`:
```typescript
await supabase.from('work_item_stage_suggestions').insert({
  work_item_id,
  suggested_stage,
  confidence,
  status: 'PENDING',  // Always PENDING, never auto-applied
  reason,
});
```

User must explicitly accept/reject via `StageSuggestionBannerDB` component.

---

## PART 7: WORKFLOW CONFIGURATION

**File:** `src/lib/workflow-constants.ts`

### 7.1 Workflow Types

| Workflow | Label | Color | Uses Radicado | External APIs | Stage Field |
|----------|-------|-------|---------------|---------------|-------------|
| CGP | Demandas CGP | emerald | Yes (23-digit) | CPNU | stage + cgp_phase |
| LABORAL | Procesos Laborales | rose | Yes (23-digit) | CPNU | stage |
| CPACA | CPACA | indigo | Yes (23-digit) | SAMAI | stage |
| TUTELA | Tutelas | purple | Yes + tutela_code | CPNU, TUTELAS | stage |
| PETICION | Peticiones | blue | No | None (manual) | stage |
| GOV_PROCEDURE | Vía Gubernativa | orange | No | None (manual) | stage |
| PENAL_906 | Penal (Ley 906) | red | Yes (23-digit) | CPNU | stage (phases 0-13) |

### 7.2 CGP Stages

**Filing Phase (FILING):**
- DRAFTED → SENT_TO_REPARTO → ACTA_PENDING → ACTA_RECEIVED → RADICADO_PENDING → RADICADO_CONFIRMED → PENDING_AUTO_ADMISORIO

**Process Phase (PROCESS):**
- AUTO_ADMISORIO → NOTIFICACION_PERSONAL → NOTIFICACION_AVISO → EXCEPCIONES_PREVIAS → PRONUNCIARSE_EXCEPCIONES → AUDIENCIA_INICIAL → AUDIENCIA_INSTRUCCION → ALEGATOS_SENTENCIA → APELACION

---

## PART 8: MULTI-TENANCY & SECURITY

### 8.1 RLS Policies

All major tables have RLS enabled with policies like:
```sql
CREATE POLICY "Users can view own org data"
ON work_items FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM organization_memberships 
    WHERE user_id = auth.uid()
  )
  OR owner_id = auth.uid()
);
```

### 8.2 Organization Scoping

**Edge Functions:** Validate org membership before operations:
```typescript
const { data: membership } = await supabase
  .from('organization_memberships')
  .select('id')
  .eq('organization_id', workItem.organization_id)
  .eq('user_id', userId)
  .maybeSingle();

if (!membership) {
  return errorResponse('FORBIDDEN', 'Not a member of this organization', 403);
}
```

---

## PART 9: DATA FLOW DIAGRAMS

### 9.1 Click "Actualizar ahora" for CGP Work Item

```
1. User clicks SyncWorkItemButton
2. Button calls supabase.functions.invoke("sync-by-work-item", {work_item_id})
3. Edge function:
   a. Validates JWT and org membership
   b. Gets work_item from DB → workflow_type=CGP
   c. Determines provider: CPNU (primary), no fallback
   d. Calls CPNU: GET ${CPNU_BASE_URL}/snapshot?numero_radicacion=${radicado}
   e. If 404 → calls /buscar → returns 202 SCRAPING_INITIATED
   f. If 200 → parses actuaciones array
   g. For each actuación:
      - Generates hash_fingerprint
      - Checks for duplicate in work_item_acts
      - If new → INSERT into work_item_acts
   h. Runs stage inference → creates PENDING suggestions
   i. Updates work_items metadata (last_crawled_at, scraped_fields)
   j. Creates alert_instances for significant events
   k. Logs trace to sync_traces
4. Returns: {ok: true, inserted_count: N, provider_used: 'CPNU'}
5. Frontend invalidates queries:
   - work-item-detail
   - work-item-actuaciones
   - work-item-alerts
6. ActsTab re-renders with new data
```

### 9.2 Click "Buscar Estados"

```
1. User clicks "Buscar Estados" in EstadosTab
2. Button calls supabase.functions.invoke("sync-publicaciones-by-work-item", {work_item_id})
3. Edge function:
   a. Validates JWT and org membership
   b. Gets work_item radicado
   c. Calls Publicaciones API:
      - GET ${PUBLICACIONES_BASE_URL}/buscar?radicado=${radicado}
      - Returns job_id
   d. Polls GET /resultado/{job_id} every 5s for 60s
   e. When job completes:
      - Parses publicaciones array
      - Extracts fecha_fijacion, fecha_desfijacion
      - Calculates terminos_inician (next business day)
      - Generates hash_fingerprint
      - INSERT into work_item_publicaciones (not actuaciones!)
   f. Creates alert_instances for new estados
4. Returns: {ok: true, inserted_count: N}
5. Frontend invalidates query: work-item-publicaciones
6. EstadosTab re-renders with new data + deadline info
```

---

## PART 10: CURRENT STATE

### 10.1 Working Features ✅

- Work item CRUD for all 7 workflow types
- Actuaciones sync (CPNU) for CGP, LABORAL, TUTELA
- Publicaciones sync for all judicial workflows
- Stage inference with PENDING suggestions
- Alert system with email notifications
- Hearing reminders
- Multi-tenant organization support
- Subscription billing (Stripe)
- Platform admin console
- Audit logging

### 10.2 Partially Working ⚠️

- **SAMAI integration:** Works for CPACA but response parsing needs verification
- **TUTELAS API:** Fallback only, primary is CPNU
- **PENAL_906:** Edge function exists but limited testing
- **Excel import:** Works but stage detection limited

### 10.3 Known Issues 🔴

1. **Legacy table references:** `WorkItemDetail/index.tsx` still queries legacy tables (filings, monitored_processes, cgp_items) for polymorphic resolution
2. **scraping-service.ts:** References legacy `actuaciones` table for hash checking (should use work_item_acts)
3. **Publicaciones /snapshot:** Code comments warn about non-existent endpoint, but polling strategy is implemented correctly

### 10.4 Legacy Code to Migrate

| File | Legacy Reference | Migration Target |
|------|------------------|------------------|
| `src/lib/scraping/scraping-service.ts` | actuaciones table | work_item_acts |
| `src/pages/WorkItemDetail/index.tsx` | filings, monitored_processes, cgp_items, peticiones, cpaca_processes | work_items only |

---

## APPENDIX: CRITICAL ARCHITECTURE RULES

### A. Tab Data Separation (NEVER VIOLATE)

```
┌─────────────────────────────────────────────────────────┐
│                   ACTUACIONES TAB                        │
│  Data source: work_item_acts table ONLY                 │
│  Button: "Actualizar ahora" → sync-by-work-item         │
│  Edge function inserts into: work_item_acts              │
│  External APIs: CPNU, SAMAI                              │
│  Content: Court clerk registry entries (NOT obligations) │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              ESTADOS / PUBLICACIONES TAB                  │
│  Data source: work_item_publicaciones table ONLY         │
│  Button: "Buscar Estados" → sync-publicaciones-by-work-item │
│  Edge function inserts into: work_item_publicaciones     │
│  External API: Publicaciones Procesales API               │
│  Content: Legal notifications with deadlines (OBLIGATIONS)│
└─────────────────────────────────────────────────────────┘
```

### B. Stage Inference Rules

1. **NEVER auto-apply stages** - all suggestions are `PENDING`
2. **Rate limit:** Once per work_item per day (America/Bogota)
3. **Audit trail:** Every stage change logged to `work_item_stage_audit`
4. **User confirmation required** for any stage transition

### C. Deadline Calculation

`términos_inician = next_business_day(fecha_desfijacion)`

Skip weekends. TODO: Skip Colombian holidays from `colombian_holidays` table.

---

*End of Architecture Audit Document*
