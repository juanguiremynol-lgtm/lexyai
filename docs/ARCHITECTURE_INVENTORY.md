# ATENIA Architecture Inventory
## Ingestion, Monitoring, and Kanban Update System

**Generated:** 2026-01-26
**Purpose:** Complete system map explaining how each `workflow_type` receives updates, data flows, and integration points.

---

## 1. Overview: The 7 Workflow Types

ATENIA manages legal matters using the `work_items` table with 7 distinct `workflow_type` values:

| Workflow Type | Description | Uses Radicado | External Source | Stage Inference |
|---------------|-------------|---------------|-----------------|-----------------|
| `CGP` | Civil/Commercial (Código General del Proceso) | ✅ 23-digit | CPNU + External API | ✅ Full |
| `LABORAL` | Labor Law (CPTSS) | ✅ 23-digit | CPNU + External API | ✅ Full |
| `CPACA` | Administrative Litigation (Ley 1437) | ✅ 23-digit | CPNU + External API | ✅ Full |
| `TUTELA` | Constitutional Protection Actions | ✅ 23-digit | CPNU + External API | ✅ Full |
| `PENAL_906` | Criminal (Ley 906 de 2004) | ✅ 23-digit | External API only | ✅ Specialized (14 phases) |
| `PETICION` | Right of Petition (Art. 23 C.P.) | ❌ | None | ❌ Manual only |
| `GOV_PROCEDURE` | Administrative / Vía Gubernativa | ❌ | None | ❌ Manual only |

---

## 2. Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA INGESTION SOURCES                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐│
│  │ ICARUS Excel │  │ CPNU (Rama  │  │ External API│  │ Manual Entry│  │ Inbound Email ││
│  │ (Estados)    │  │ Judicial)   │  │ (Render)    │  │ (UI Forms)  │  │ (Webhook)    ││
│  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘│
│         │                 │                │                │                │        │
│         ▼                 │                │                │                │        │
│  ┌──────────────┐         │                │                │                │        │
│  │ EstadosImport│         │                │                │                │        │
│  │ Component    │         │                │                │                │        │
│  └──────┬───────┘         │                │                │                │        │
│         │                 │                │                │                │        │
│         ▼                 ▼                ▼                ▼                │        │
│  ┌──────────────────────────────────────────────────────────────────────────┐│        │
│  │                    EDGE FUNCTIONS (Supabase)                             ││        │
│  ├──────────────────────────────────────────────────────────────────────────┤│        │
│  │ • sync-by-radicado (CGP, CPACA, LABORAL, TUTELA)                        ││        │
│  │ • sync-penal906-by-radicado (PENAL_906 only)                            ││        │
│  │ • adapter-cpnu (CPNU API wrapper)                                        ││        │
│  │ • adapter-historico, adapter-publicaciones                               ││        │
│  │ • scheduled-crawler (batch processing)                                   ││        │
│  │ • normalize-actuaciones                                                  ││        │
│  └──────────────────────────────────┬───────────────────────────────────────┘│        │
│                                     │                                         │        │
│                                     ▼                                         ▼        │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐│
│  │                        INGESTION SERVICES (Frontend Lib)                          ││
│  ├───────────────────────────────────────────────────────────────────────────────────┤│
│  │ • ingestion-service.ts (generic NormalizedProcessSnapshot → work_items)           ││
│  │ • estados-ingestion-service.ts (Estados → work_item_acts + stage inference)       ││
│  │ • icarus-converter.ts (Excel rows → NormalizedProcessSnapshot)                    ││
│  │ • estados-converter.ts (Estados → process_events)                                 ││
│  │ • penal906-ingestion.ts (External API → work_item_acts + phase update)            ││
│  │ • web-scrape-ingestion.ts (CPACA/PENAL actuaciones → work_item_acts)              ││
│  └────────────────────────────────────┬──────────────────────────────────────────────┘│
│                                       │                                               │
│                                       ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐│
│  │                         STAGE INFERENCE ENGINES                                   ││
│  ├───────────────────────────────────────────────────────────────────────────────────┤│
│  │ • estado-stage-inference.ts (CGP, CPACA, TUTELA, LABORAL patterns)                ││
│  │ • cpaca-stage-inference.ts (CPACA-specific CPACA Ley 1437 patterns)               ││
│  │ • penal906-classifier.ts (Penal 906 phase classification 0-13)                    ││
│  │ • stage-suggestion-engine.ts (User review flow)                                   ││
│  └────────────────────────────────────┬──────────────────────────────────────────────┘│
│                                       │                                               │
│                                       ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐│
│  │                           DATABASE TABLES                                          ││
│  ├───────────────────────────────────────────────────────────────────────────────────┤│
│  │ PRIMARY:                                                                           ││
│  │ • work_items (canonical entity - 7 workflow types)                                 ││
│  │ • work_item_acts (actuaciones/events per work_item)                                ││
│  │ • process_events (timeline events, milestones)                                     ││
│  │ • alert_instances (notifications, reminders)                                       ││
│  │                                                                                    ││
│  │ LEGACY (still referenced):                                                         ││
│  │ • actuaciones (linked to filings/monitored_processes)                              ││
│  │ • cgp_items, peticiones, cpaca_processes (deprecated)                              ││
│  │ • filings, monitored_processes (deprecated)                                        ││
│  └────────────────────────────────────┬──────────────────────────────────────────────┘│
│                                       │                                               │
│                                       ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐│
│  │                              UI COMPONENTS                                         ││
│  ├───────────────────────────────────────────────────────────────────────────────────┤│
│  │ • UnifiedKanbanBoard.tsx (drag-drop engine)                                        ││
│  │ • Workflow-specific pipelines: CGP, CPACA, Laboral, Tutela, Peticiones, Penal      ││
│  │ • WorkItemDetail page (rich detail view)                                           ││
│  │ • EstadosImport (Excel upload for CGP/CPACA/LABORAL/TUTELA)                        ││
│  │ • StageSuggestionReviewModal (user approval flow)                                  ││
│  │ • CreateWorkItemWizard (radicado lookup + creation)                                ││
│  └───────────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Workflow-by-Workflow Inventory

### 3.1 CGP (Código General del Proceso)

**Pipeline Stages (12 total):**
- **FILING Phase (stages 0-6):** DRAFTED → SENT_TO_REPARTO → ACTA_PENDING → ACTA_RECEIVED → RADICADO_PENDING → RADICADO_CONFIRMED → PENDING_AUTO_ADMISORIO
- **PROCESS Phase (stages 0-8):** AUTO_ADMISORIO → NOTIFICACION_PERSONAL → NOTIFICACION_AVISO → EXCEPCIONES_PREVIAS → PRONUNCIARSE_EXCEPCIONES → AUDIENCIA_INICIAL → AUDIENCIA_INSTRUCCION → ALEGATOS_SENTENCIA → APELACION

**Data Sources:**
| Source | Status | Entry Point |
|--------|--------|-------------|
| ICARUS Excel (Estados) | ✅ Active | `EstadosImport.tsx` → `estados-ingestion-service.ts` |
| CPNU API | ✅ Active | `adapter-cpnu` → `sync-by-radicado` |
| External API (Render) | ✅ Active | `sync-by-radicado` (fallback) |
| Manual Entry | ✅ Active | `CreateWorkItemWizard` |

**Ingestion Flow:**
1. `sync-by-radicado` fetches from CPNU + External API concurrently
2. Merges data (prioritizes source with more actuaciones)
3. Detects Auto Admisorio → sets `cgp_phase` = PROCESS
4. Creates `work_item_acts` with fingerprint deduplication
5. Runs `estado-stage-inference` for stage suggestions
6. Updates `work_items.stage` if HIGH confidence

**Stage Inference Patterns (from `estado-stage-inference.ts`):**
- AUTO_ADMISORIO: `auto admisorio`, `admite demanda`, `admite la demanda`
- NOTIFICACION_PERSONAL: `notificación personal`
- AUDIENCIA_INICIAL: `audiencia inicial`, `fija fecha para audiencia inicial`
- SENTENCIA: `sentencia`, `fallo`

**Alerts/Deadlines:** Via `cgp_deadlines` table + `alert_instances`

---

### 3.2 LABORAL (Procesos Laborales - CPTSS)

**Pipeline Stages (10 total):**
BORRADOR → RADICACION → REPARTO → ADMISION_PENDIENTE → AUDIENCIA_INICIAL → AUDIENCIA_JUZGAMIENTO → SENTENCIA_1A_INSTANCIA → APELACION → EJECUCION → ARCHIVADO

**Data Sources:**
| Source | Status | Entry Point |
|--------|--------|-------------|
| ICARUS Excel (Estados) | ✅ Active | Same as CGP |
| CPNU API | ✅ Active | `adapter-cpnu` → `sync-by-radicado` |
| External API | ✅ Active | Fallback |
| Manual Entry | ✅ Active | `CreateWorkItemWizard` |

**Stage Inference Patterns (LABORAL-specific in `estado-stage-inference.ts`):**
- AUDIENCIA_INICIAL: `audiencia de conciliación`, `saneamiento del proceso`, `fijación del litigio`
- AUDIENCIA_JUZGAMIENTO: `audiencia de trámite y juzgamiento`, `practica de pruebas laborales`, `fallo oral`
- CASACION: `recurso de casación`, `sala de casación laboral`

**Workflow Detection (from `icarus-workflow-detection.ts`):**
- Keywords: `LABORAL`, `SALA LABORAL`, `JUZGADO LABORAL`, `SEGURIDAD SOCIAL`

---

### 3.3 CPACA (Contencioso Administrativo)

**Pipeline Stages (14 total):**
PRECONTENCIOSO → DEMANDA_POR_RADICAR → DEMANDA_RADICADA → AUTO_ADMISORIO → NOTIFICACION_TRASLADOS → TRASLADO_DEMANDA → REFORMA_DEMANDA → TRASLADO_EXCEPCIONES → AUDIENCIA_INICIAL → AUDIENCIA_PRUEBAS → ALEGATOS_SENTENCIA → RECURSOS → EJECUCION_CUMPLIMIENTO → ARCHIVADO

**Data Sources:**
| Source | Status | Entry Point |
|--------|--------|-------------|
| ICARUS Excel | ✅ Active | Same as CGP |
| CPNU API | ✅ Active | `adapter-cpnu` |
| External API | ✅ Active | Fallback |
| Manual | ✅ Active | CreateWorkItemWizard |

**Specialized Engine:** `cpaca-stage-inference.ts`
- Uses CPACA-specific terminology (Ley 1437)
- Pattern priority system (100 = terminal, 40 = precontencioso)
- Art. 199 notification detection

**Deadline System:** `cpaca-deadline-service.ts`
- Colombian business days calculation
- Judicial suspension awareness
- Automatic deadline creation for Traslado Demanda (30+15 days)

---

### 3.4 TUTELA (Acciones de Tutela)

**Pipeline Stages (5 total):**
TUTELA_RADICADA → TUTELA_ADMITIDA → FALLO_PRIMERA_INSTANCIA → FALLO_SEGUNDA_INSTANCIA → ARCHIVADO

**Data Sources:**
| Source | Status | Entry Point |
|--------|--------|-------------|
| ICARUS Excel | ✅ Active | Same as CGP |
| CPNU API | ✅ Active | `sync-by-radicado` |
| External API | ✅ Active | Fallback |
| Manual | ✅ Active | CreateWorkItemWizard |

**Stage Inference:** Uses shared `estado-stage-inference.ts`
- TUTELA_ADMITIDA: `auto admisorio`, `admite tutela`
- FALLO: `sentencia`, `fallo de primera instancia`
- IMPUGNACION: `impugnación` → FALLO_SEGUNDA_INSTANCIA

**Desacato Flow:** `DesacatoPipeline` handles compliance monitoring after favorable rulings

---

### 3.5 PENAL_906 (Ley 906 de 2004)

**Pipeline Phases (14 numeric phases, 0-13):**
| ID | Key | Description |
|----|-----|-------------|
| 0 | PENDIENTE_CLASIFICACION | Pending initial classification |
| 1 | NOTICIA_CRIMINAL_INDAGACION | Investigation phase |
| 2 | IMPUTACION_INVESTIGACION | Charges formulated |
| 3 | PRECLUSION_TRAMITE | Preclusión pending |
| 4 | ACUSACION | Formal accusation |
| 5 | PREPARATORIA | Preparatory hearing |
| 6 | JUICIO_ORAL | Oral trial |
| 7 | SENTENCIA_TRAMITE | Sentence pending |
| 8 | SEGUNDA_INSTANCIA | Appeal |
| 9 | EJECUTORIA | Execution of sentence |
| 10 | PRECLUIDO_ARCHIVADO | **Terminal** |
| 11 | FINALIZADO_ABSUELTO | **Terminal** |
| 12 | FINALIZADO_CONDENADO | **Terminal** |
| 13 | SUSPENDIDO_INACTIVO | Suspended |

**Data Sources:**
| Source | Status | Entry Point |
|--------|--------|-------------|
| ICARUS Excel | ❌ NOT USED | N/A |
| CPNU API | ❌ NOT USED | N/A |
| External API (Render) | ✅ **PRIMARY** | `sync-penal906-by-radicado` |
| Manual | ✅ Active | Manual phase updates |

**CRITICAL: PENAL_906 uses a SEPARATE sync function:**
- Edge function: `sync-penal906-by-radicado/index.ts`
- Uses `pipeline_stage` (numeric) instead of `stage` (string)
- Specialized classifier: `penal906-classifier.ts`
- Phase progression rules prevent regression (unless retroceso keywords detected)

**Classification Rules (from `sync-penal906-by-radicado`):**
- CRITICA priority: Sentencia condenatoria/absolutoria, Preclusión
- ALTA priority: Segunda instancia, Acusación, Imputación
- Retroceso patterns: `nulidad decreta`, `revoca auto`, `deja sin efecto`

---

### 3.6 PETICION (Derechos de Petición)

**Pipeline Stages (3 total):**
PETICION_RADICADA → CONSTANCIA_RADICACION → RESPUESTA

**Data Sources:**
| Source | Status | Entry Point |
|--------|--------|-------------|
| All external sources | ❌ NOT AVAILABLE | N/A |
| Manual Entry | ✅ ONLY SOURCE | UI forms |

**Notes:**
- No radicado-based lookup (peticiones don't have 23-digit judicial radicados)
- No automated stage inference
- Deadline tracking via `peticion-reminders` edge function
- Escalation to Tutela via `EscalateToTutelaDialog`

---

### 3.7 GOV_PROCEDURE (Vía Gubernativa)

**Pipeline Stages (9 total):**
INICIO_APERTURA → REQUERIMIENTOS_TRASLADOS → DESCARGOS → PRUEBAS → ALEGATOS_INFORME → DECISION_PRIMERA → RECURSOS → EJECUCION_CUMPLIMIENTO → ARCHIVADO

**Data Sources:**
| Source | Status | Entry Point |
|--------|--------|-------------|
| All external sources | ❌ NOT AVAILABLE | N/A |
| Manual Entry | ✅ ONLY SOURCE | UI forms |

**Notes:**
- Covers: policivos, disciplinarios, SIC, superintendencias
- No 23-digit radicado (uses administrative reference numbers)
- No stage inference
- Uses `AdminPipeline.tsx` for Kanban rendering

---

## 4. Edge Functions Inventory

### 4.1 Sync/Ingestion Functions

| Function | Purpose | Workflows | Input | Output |
|----------|---------|-----------|-------|--------|
| `sync-by-radicado` | Unified lookup + sync | CGP, CPACA, LABORAL, TUTELA | radicado, mode, workflow_type | work_item_id, process_data |
| `sync-penal906-by-radicado` | Penal-specific sync | PENAL_906 only | work_item_id, radicado | phase update, acts created |
| `adapter-cpnu` | CPNU API wrapper | All judicial | radicado, action | SearchResult[], ProcessEvent[] |
| `adapter-historico` | Historical records | CGP, CPACA | radicado | Archived case data |
| `adapter-publicaciones` | Court publications | All judicial | filters | Publication events |
| `normalize-actuaciones` | Raw → normalized events | All | raw actuaciones | NormalizedEvent[] |

### 4.2 Scheduled/Background Functions

| Function | Purpose | Trigger |
|----------|---------|---------|
| `scheduled-crawler` | Batch process updates | Cron (configurable) |
| `check-estados-staleness` | Detect outdated data | Daily cron |
| `hearing-reminders` | Hearing notifications | Daily cron |
| `peticion-reminders` | Petición deadline alerts | Daily cron |
| `process-email-outbox` | Email delivery | Continuous |
| `purge-old-audit-logs` | Data retention | Scheduled |

### 4.3 ICARUS Integration

| Function | Purpose | Status |
|----------|---------|--------|
| `icarus-auth` | Authenticate to ICARUS | ⚠️ TLS blocked |
| `icarus-health` | Check ICARUS availability | ⚠️ TLS blocked |
| `icarus-import-excel` | Process Excel uploads | ✅ Active (client-side parsing) |
| `icarus-save-credentials` | Store encrypted credentials | ✅ Active |
| `icarus-sync` | Sync with ICARUS | ⚠️ Fallback to Firecrawl |

**TLS Constraint:** Direct HTTP to `icarus.com.co` fails from Edge Functions. Workaround: Excel export/import or Firecrawl browser automation.

---

## 5. Database Tables Reference

### 5.1 Primary Tables (Current Architecture)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `work_items` | Canonical case entity | id, workflow_type, stage, pipeline_stage, radicado, cgp_phase |
| `work_item_acts` | Events/actuaciones per case | work_item_id, act_date, description, hash_fingerprint |
| `process_events` | Timeline events, milestones | filing_id, event_type, event_date |
| `alert_instances` | Notifications, reminders | entity_id, entity_type, severity, status |
| `alert_rules` | Alert configuration | entity_id, rule_kind, channels |
| `hearings` | Scheduled court dates | work_item_id, hearing_date |
| `cgp_deadlines` | CGP term tracking | work_item_id, deadline_date |
| `cgp_milestones` | CGP milestone detection | process_id, milestone_type |

### 5.2 Legacy Tables (Deprecated but Referenced)

| Table | Status | Migration Path |
|-------|--------|----------------|
| `filings` | Deprecated | → work_items (legacy_filing_id) |
| `monitored_processes` | Deprecated | → work_items (legacy_process_id) |
| `cgp_items` | Deprecated | → work_items |
| `peticiones` | Deprecated | → work_items (legacy_peticion_id) |
| `cpaca_processes` | Deprecated | → work_items (legacy_cpaca_id) |
| `actuaciones` | Legacy events | → work_item_acts |

### 5.3 Import Tracking

| Table | Purpose |
|-------|---------|
| `estados_import_runs` | ICARUS Excel import history |
| `crawler_runs` | Scraper execution logs |
| `crawler_run_steps` | Diagnostic steps per crawl |

---

## 6. Frontend Components Map

### 6.1 Kanban Pipelines

| Component | Workflow | Table Queried |
|-----------|----------|---------------|
| `UnifiedPipeline.tsx` | CGP | work_items |
| `CpacaPipeline.tsx` | CPACA | work_items |
| `LaboralPipeline.tsx` | LABORAL | work_items |
| `TutelasPipeline.tsx` | TUTELA | work_items |
| `PeticionesPipeline.tsx` | PETICION | work_items |
| `PenalPipeline.tsx` | PENAL_906 | work_items |
| `AdminPipeline.tsx` | GOV_PROCEDURE | work_items |

### 6.2 Ingestion Components

| Component | Purpose | Workflows |
|-----------|---------|-----------|
| `EstadosImport.tsx` | Excel upload + preview | CGP, CPACA, LABORAL, TUTELA |
| `IcarusExcelImport.tsx` | ICARUS process list import | CGP, CPACA, LABORAL |
| `CreateWorkItemWizard.tsx` | Radicado lookup + creation | CGP, CPACA, LABORAL, TUTELA |
| `BuscarProceso.tsx` | Quick radicado search | All judicial |
| `StageSuggestionReviewModal.tsx` | User approval for stage changes | All |

### 6.3 Detail Views

| Route | Component | Data Source |
|-------|-----------|-------------|
| `/work-items/:id` | `WorkItemDetail/index.tsx` | work_items + polymorphic resolution |
| `/app/cgp/:id` | `CGPDetailModule.tsx` | work_items |
| `/app/cpaca/:id` | `CpacaDetailModule.tsx` | work_items |

---

## 7. Stage Inference Engine Details

### 7.1 Shared Engine: `estado-stage-inference.ts`

**Supports:** CGP, CPACA, TUTELA, LABORAL

**Pattern Structure:**
```typescript
interface PatternRule {
  patterns: string[];           // Text patterns to match
  category: EstadoCategory;     // RADICACION, ADMISSION, HEARING, etc.
  cgpStage?: string;            // Target stage for CGP
  cpacaStage?: string;          // Target stage for CPACA
  tutelaStage?: string;         // Target stage for TUTELA
  laboralStage?: string;        // Target stage for LABORAL
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  milestoneType?: string;       // e.g., 'AUTO_ADMISORIO'
  triggersMilestone?: boolean;
}
```

**Key Rules:**
1. **Never regress** stages automatically (only manual override)
2. **Auto-apply** only when confidence = HIGH
3. **Audit trail** stored in `work_item_acts.raw_data.inference_result`

### 7.2 CPACA-Specific: `cpaca-stage-inference.ts`

- Uses CPACA Ley 1437 terminology
- Priority-based pattern matching (100 = terminal → 40 = precontencioso)
- Extracts audiencia dates from text

### 7.3 Penal 906: `penal906-classifier.ts`

- Uses numeric phases (0-13)
- Priority levels: CRITICA, ALTA, MEDIA, BAJA
- Terminal phase detection (10, 11, 12)
- Retroceso keyword detection for backward transitions

---

## 8. Integration Points for New External Sources

### 8.1 Where to Plug New Data Sources

| Integration Type | Entry Point | Example |
|------------------|-------------|---------|
| New judicial API | Create `adapter-{source}/index.ts` | adapter-siproj |
| Excel format | Modify parser in `lib/{format}-parser.ts` | siproj-excel-parser |
| Real-time webhook | `inbound-email/index.ts` pattern | Court notification webhook |
| Batch processing | `scheduled-crawler` extension | Nightly sync job |

### 8.2 Required Interface for New Adapters

```typescript
interface NormalizedProcessSnapshot {
  radicado: string;                    // Required: 23 digits
  suggested_workflow_type: WorkflowType;
  authority: AuthorityInfo | null;
  parties: ProcessParty[];
  demandantes_text?: string;
  demandados_text?: string;
  last_action: LastActionInfo | null;
  last_notification: EstadoNotification | null;
  source: IngestionSource;
  source_run_id?: string;
  source_timestamp: string;
  source_payload?: Record<string, unknown>;
  is_valid: boolean;
  validation_errors: string[];
}
```

### 8.3 Fingerprinting for Deduplication

All ingestion uses deterministic fingerprints:
```typescript
// Format: {source}|{radicado}|{date}|{text_hash}
// Example: 'CPNU|12345678901234567890123|2024-01-15|a1b2c3d4'
```

---

## 9. Current Gaps and Missing Features

### 9.1 By Workflow Type

| Workflow | Gap | Severity |
|----------|-----|----------|
| PENAL_906 | No CPNU integration (uses External API only) | Medium |
| PETICION | No external data source | Low (by design) |
| GOV_PROCEDURE | No external data source | Low (by design) |
| All | ICARUS direct sync blocked by TLS | Medium |

### 9.2 System-Wide

| Gap | Description | Workaround |
|-----|-------------|------------|
| Real-time updates | No push notifications from courts | Polling via scheduled-crawler |
| Document parsing | PDF/image actuación extraction | Manual entry |
| Cross-workflow linking | Tutela → CGP, Petición → Tutela | Manual linking |

---

## 10. Summary: Data Flow by Workflow

| Workflow | Manual | Excel Import | CPNU | External API | Stage Inference | Deadline Engine |
|----------|--------|--------------|------|--------------|-----------------|-----------------|
| CGP | ✅ | ✅ | ✅ | ✅ | ✅ Full | ✅ cgp_deadlines |
| LABORAL | ✅ | ✅ | ✅ | ✅ | ✅ Full | ⚠️ Basic |
| CPACA | ✅ | ✅ | ✅ | ✅ | ✅ Full | ✅ cpaca-deadline-service |
| TUTELA | ✅ | ✅ | ✅ | ✅ | ✅ Full | ⚠️ Basic |
| PENAL_906 | ✅ | ❌ | ❌ | ✅ **ONLY** | ✅ Specialized | ⚠️ Basic |
| PETICION | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ peticion-reminders |
| GOV_PROCEDURE | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ Basic |

---

*End of Architecture Inventory*
