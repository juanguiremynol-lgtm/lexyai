
# Ciclo de vida canónico de work_items — Fase 1 (auditoría) + Fase 2 (diseño)

Sin cambios de datos ni de código todavía. Espero tu OK antes de Fase 3.

---

## FASE 1 — AUDITORÍA (evidencia verificada por SQL/grep)

### 1.1 Inventario de columnas de "vida / monitoreo / borrado" en `work_items`

| Columna | Tipo | Default | Semántica actual (observada) |
|---|---|---|---|
| `status` | enum `item_status` (ACTIVE/INACTIVE/CLOSED/ARCHIVED) | `ACTIVE` | **DEAD FIELD**. 69/69 filas = ACTIVE. Ningún path de código escribe este enum en `work_items` (grep confirma: solo se escribe en `provider_mappings` y `atenia_ai_conversations`). |
| `deleted_at` | timestamptz | NULL | Marca soft-delete. 30/69 filas puestas. |
| `deleted_by` | uuid | NULL | Auditoría del actor. |
| `delete_reason` | text | NULL | Razón texto libre. |
| `purge_after` | timestamptz | NULL | +10 días desde `deleted_at`. Consumido por purga. |
| `monitoring_enabled` | boolean | `true` | Flag principal usado por el sweeper. Escrito por ≥15 sitios. |
| `monitoring_mode` | text | `AUTO_SYNC` | 69/69 = AUTO_SYNC. Field prácticamente inerte. |
| `monitoring_suspended_at` | timestamptz | NULL | Pausa manual del usuario. |
| `monitoring_suspended_reason` | text | NULL | Razón de pausa. |
| `monitoring_disabled_at` / `_by` / `_reason` / `_meta` | | NULL | Set independiente (auto‑demonitor / AI). Duplica semántica con `_suspended_*`. |
| `demonitor_at` / `demonitor_reason` | | NULL | **Tercera** familia paralela a las dos anteriores. |
| `scraping_enabled` | boolean | (nullable) | Flag paralelo. **Nadie en Supabase lo escribe** (grep 0 writes). Solo lo lee/expone GCP scraper y el tipo TS. → Fuente de los "fantasmas". |
| `scrape_status` | enum | `NOT_ATTEMPTED` | Estado del último intento (NOT_ATTEMPTED/IN_PROGRESS/SUCCESS/FAILED/PARTIAL). Independiente de vida. |
| `last_scrape_at` / `last_scrape_initiated_at` / `last_synced_at` / `last_checked_at` | | | Telemetría, no lifecycle. |

**Escritor → columna → lector (resumen; matriz completa disponible bajo pedido).**

- `deleted_at` (escrito): `work-item-delete-service.softDeleteWorkItem`, `use-restore-work-items` (limpia a NULL), `delete-generated-document` (no aplica), `atenia-ai-supervisor` (bulk soft). **Leído por**: `sync-eligibility.ts`, `scheduled-daily-sync`, `sync-by-work-item`, `sync-publicaciones-by-work-item`, `use-work-items-list`, `use-restore-work-items`, `work-item-recovery-service`, docenas de queries de listing.
- `monitoring_enabled` (escrito): `use-create-work-item`, `use-bulk-import-work-item`, `sync-by-radicado` (crea true), `icarus-sync`/`icarus-import-excel` (true), `AddRadicadoInline` (true), `WorkItemMonitoringToggle`, `WorkItemMonitoringControls` (true/false + suspended_*), `SyncSettingsToggle`, `OverviewTab`, `scheduled-daily-sync` (false, auto‑demonitor), `atenia-ai-supervisor`/`atenia-ai-autopilot` (false), `atenia-cron-watchdog` (false), `work-item-delete-service` (false), `atenia-assistant` (bulk toggle). **Leído por**: `sync-eligibility`, todos los sync/scheduled edge functions, `Processes`, `WorkItemMonitoringBadge`, `CGPDetail`, filtros de UI.
- `monitoring_suspended_at`/`_reason` (escrito): sólo `WorkItemMonitoringControls`. **Leído por**: `WorkItemMonitoringControls`, `WorkItemDetail/index.tsx`.
- `monitoring_disabled_*` (escrito): auto‑demonitor en `scheduled-daily-sync` + `atenia-*`. **Leído por**: `WorkItemMonitoringBadge`, dashboards de salud.
- `demonitor_at`/`_reason` (escrito): watchdog. **Leído por**: SistemaSalud, ghost verification.
- `status` (escrito en `work_items`): **NADIE**. Enum muerto.
- `scraping_enabled`: **NADIE en Supabase** — lo escribe/lee sólo el GCP scraper.

### 1.2 Mapa de contradicciones (hoy, 69 WIs)

| Regla que debería cumplirse | # WIs que la violan |
|---|---|
| `deleted_at IS NOT NULL` ⟹ `status <> 'ACTIVE'` | **30** (todos los borrados siguen ACTIVE) |
| `deleted_at IS NOT NULL` ⟹ `scraping_enabled = false` | **30** (fantasmas del Doctor) |
| `deleted_at IS NOT NULL` ⟹ `monitoring_enabled = false` | 0 ✓ (delete‑service lo pone bien) |
| `monitoring_suspended_at IS NOT NULL` ⟹ `monitoring_enabled = false` | 0 ✓ |
| `monitoring_enabled = false` ⟹ `monitoring_suspended_at` OR `monitoring_disabled_at` OR `demonitor_at` set | **4** (limbo: apagado sin motivo) |
| `monitoring_enabled = true` ⟺ elegible para sync | ambiguo por diseño |
| `status` refleja realidad | 69/69 = ACTIVE aunque 30 borrados y 6 suspendidos |

Tres contradicciones son estructurales; las demás son bugs puntuales.

### 1.3 Rutas de borrado / desactivación

| Ruta | Qué escribe en `work_items` | Notifica a GCP? |
|---|---|---|
| Botón dashboard / detail (soft) → `useDeleteWorkItems` → `useSoftDeleteWorkItems` → `work-item-delete-service.softDeleteWorkItem` | `deleted_at`, `deleted_by`, `purge_after`, `delete_reason`, `monitoring_enabled=false` | **Sí, solo CGP**: `syncCpnuEliminar` fire‑and‑forget. CPACA/LABORAL/PENAL/TUTELA: **NO** notifica. |
| Papelera / Admin / Master delete → `useHardPurgeWorkItems` → `delete-work-items` (edge, mode=HARD_DELETE) | `DELETE FROM work_items` | **NO**. |
| Purga org → `purge-organization-data` | DELETE físico | **NO**. |
| Atenia AI bulk / autopilot / supervisor | `monitoring_enabled=false` (a veces + `monitoring_disabled_*`) | **NO**. |
| Auto‑demonitor (`scheduled-daily-sync` línea 1427, watchdog) | `monitoring_enabled=false` | **NO**. |
| Pausa manual (`WorkItemMonitoringControls`) | `monitoring_enabled=false` + `monitoring_suspended_*` | **NO**. |
| Cerrar proceso (`WorkItemMonitoringControls`) | `monitoring_enabled=false` + `monitoring_suspended_reason` | **NO**. `status` NUNCA pasa a CLOSED. |

Ninguna ruta actualiza el enum `status`. Solo la soft‑delete de CGP intenta avisar upstream (y a un solo proveedor).

### 1.4 Lado GCP (evidencia interna Supabase; el fix upstream es tuyo con Cloud Shell)

- El scraper GCP mantiene su propio `en_pp` / `en_cpnu` / `en_samai` (visto en `SistemaSalud.tsx` y `useAndromedaRadicado`) y su propio flag de monitoreo.
- El único canal Supabase → GCP hoy es `syncCpnuEliminar(work_item_id, reason)` (POST a `cpnu-sync` proxy) desde soft‑delete de CGP. **No existe** equivalente para: hard‑delete, purge‑org, CPACA (SAMAI), TUTELA/LABORAL/PENAL, ni para pausas/reactivaciones.
- Consecuencia: los 30 fantasmas actuales son WIs borrados en Andromeda cuyo GCP nunca fue notificado → sigue con `en_scraper=true` y sigue scrapeando.
- **Señal que GCP necesita consumir** (propuesta): un único endpoint / webhook `lifecycle_state_changed(work_item_id, radicado, workflow_type, new_state, reason, actor, timestamp)` publicado por Supabase en cada transición. GCP lo materializa apagando su propio monitoreo. Enum idéntico al canónico de Supabase.

---

## FASE 2 — DISEÑO CANÓNICO PROPUESTO

Espera tu OK antes de tocar código o datos.

### 2.1 Enum canónico único: `work_item_lifecycle_state`

```text
ACTIVE      → vivo, monitoreado, elegible para sync
PAUSED      → usuario suspendió temporalmente; fila visible; NO sincroniza; recuperable con 1 clic
CLOSED      → proceso terminado jurídicamente (sentencia firme, desistimiento);
              visible en histórico; NO sincroniza; no se auto‑archiva
ARCHIVED    → oculto de UI operativa, sin sincronizar, sin borrar (uso: purga suave o "guardar sin ver")
DELETED     → soft‑delete recuperable 10 días; fila presente; oculta en UI;
              programada para purga física via purge_after
[HARD DELETE] = fila físicamente ausente. Reservado a papelera admin y purga org.
```

Columna nueva: `lifecycle_state work_item_lifecycle_state NOT NULL DEFAULT 'ACTIVE'`.

### 2.2 Regla de derivación (invariantes que la BD hará cumplir por CHECK/trigger)

| lifecycle_state | monitoring_enabled | scraping_enabled | deleted_at | Visible en UI operativa | Elegible sync |
|---|---|---|---|---|---|
| ACTIVE | true | true | NULL | sí | **sí** |
| PAUSED | false | false | NULL | sí (badge "Pausado") | no |
| CLOSED | false | false | NULL | sí (histórico) | no |
| ARCHIVED | false | false | NULL | no (solo búsqueda) | no |
| DELETED | false | false | NOT NULL | no (papelera) | no |

Los campos `status`, `monitoring_mode`, `monitoring_disabled_*`, `demonitor_*` quedan **derivados o deprecados** (fase 3.5). `monitoring_suspended_reason` se conserva como *metadata* solo cuando `lifecycle_state='PAUSED'`; se limpia en las demás transiciones.

### 2.3 Único punto de escritura: RPC `set_work_item_lifecycle`

```sql
set_work_item_lifecycle(
  p_work_item_id uuid,
  p_new_state    work_item_lifecycle_state,
  p_reason       text,
  p_actor        text,        -- 'USER' | 'AI' | 'SYSTEM' | 'ADMIN'
  p_actor_user   uuid,
  p_metadata     jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb  -- {ok, prev_state, new_state, side_effects}
SECURITY DEFINER
```

Responsabilidades atómicas (dentro de una sola transacción):
1. Validar transición permitida (matriz).
2. Actualizar `lifecycle_state` + `monitoring_enabled`, `scraping_enabled`, `deleted_at`, `purge_after`, `monitoring_suspended_*` derivados.
3. Cancelar `work_item_scrape_jobs` PENDING si el nuevo estado no es ACTIVE.
4. Insertar auditoría en `audit_logs` y en `atenia_ai_actions` (para reversibilidad).
5. Enviar señal a GCP via `pg_notify('gcp_lifecycle', json)` — un edge cron `gcp-lifecycle-broadcaster` la consume y llama al webhook GCP unificado. Esto reemplaza el actual `syncCpnuEliminar` puntual.

Trigger `BEFORE UPDATE` de guardia: cualquier UPDATE directo a `deleted_at`, `monitoring_enabled`, `scraping_enabled` fuera del RPC se rechaza (excepto la migración correctiva). Esto impide que un cron o edge nuevo re‑introduzca la deriva.

### 2.4 Helper canónico único

```ts
// src/lib/lifecycle.ts (y supabase/functions/_shared/lifecycle.ts idéntico)
export const isActive     = (wi) => wi.lifecycle_state === 'ACTIVE';
export const isSyncEligible = (wi) => wi.lifecycle_state === 'ACTIVE';
export const isVisibleInList = (wi) => ['ACTIVE','PAUSED','CLOSED'].includes(wi.lifecycle_state);
export const isRecoverable = (wi) => wi.lifecycle_state === 'DELETED' && wi.purge_after > now();
```

Todos los sitios (`sync-eligibility.ts`, filtros de listing, dispatchers, KPIs, badges) los consumen. Se eliminan chequeos ad‑hoc de `deleted_at IS NULL AND monitoring_enabled=true`.

### 2.5 Matriz de transiciones permitidas

```text
                       →ACTIVE  →PAUSED  →CLOSED  →ARCHIVED  →DELETED  →HARD
ACTIVE                    -       USER     USER     USER       USER      ADMIN
PAUSED                   USER      -       USER     USER       USER      ADMIN
CLOSED                   USER     USER      -       USER       USER      ADMIN
ARCHIVED                 USER      -        -        -         USER      ADMIN
DELETED (recuperable)    USER      -        -        -          -        ADMIN (purga)
DELETED (post‑purge)      -        -        -        -          -        SYSTEM (cron)
```

Cerrar auto por sync (`stage∈TERMINAL_STAGES`): SYSTEM puede ACTIVE→CLOSED. Auto‑demonitor por fallo N veces: SYSTEM ACTIVE→PAUSED con reason=AUTO_DEMONITOR (nunca DELETED).

### 2.6 Migración correctiva de los 69 WIs actuales

| Estado disperso actual (# filas) | → lifecycle_state canónico |
|---|---|
| deleted_at NOT NULL, monitoring_enabled=false, suspended=false (29) | **DELETED** (respetar `purge_after`; si NULL, +10d desde deleted_at; enviar señal GCP) |
| deleted_at NOT NULL, monitoring_enabled=false, suspended=true (1) | **DELETED** (limpiar suspended_* — dominado por delete) |
| deleted_at NULL, monitoring_enabled=true, suspended=false (27) | **ACTIVE** |
| deleted_at NULL, monitoring_enabled=true, suspended=true (6) | **PAUSED** (corregir contradicción; poner monitoring_enabled=false) |
| deleted_at NULL, monitoring_enabled=false, suspended=false (4) | **PAUSED** con reason='LEGACY_UNKNOWN' (limbo) — el Doctor revisa manualmente |
| deleted_at NULL, monitoring_enabled=false, suspended=true (2) | **PAUSED** |

En **todos** los casos: `scraping_enabled` se re‑deriva del nuevo `lifecycle_state`. Los 30 fantasmas quedan DELETED coherente y GCP recibe la señal.

### 2.7 Sitios a repuntar (mapa de blast radius)

- **BD**: nueva columna, enum, RPC, trigger de guardia, backfill.
- **Edge functions** (reemplazar filtros `.eq("monitoring_enabled", true).is("deleted_at", null)` por `.eq("lifecycle_state", "ACTIVE")`):
  - `_shared/sync-eligibility.ts`, `scheduled-daily-sync`, `scheduled-publicaciones-monitor`, `process-monitor`, `atenia-cron-watchdog`, `sync-by-radicado`, `sync-by-work-item`, `sync-publicaciones-by-work-item`, `icarus-sync`, `fallback-sync-check`, `provider-sync-external-provider`, `global-master-sync`, `atenia-ai-*`, `delete-work-items` (usar RPC).
- **src/**: `use-soft-delete-work-items`, `use-hard-purge-work-items`, `use-restore-work-items`, `use-create-work-item`, `use-bulk-import-work-item`, `WorkItemMonitoringToggle/Controls/Badge`, `SyncSettingsToggle`, `OverviewTab`, `Processes`, `CGPDetail`, `WorkItemDetail`, `CpacaPipeline`, `AddRadicadoInline`, `NewCGPFilingDialog`, `NewLaboralFilingDialog`, `IcarusExcelImport`, `SistemaSalud`, `work-item-delete-service`, `work-item-recovery-service`, `atenia-ai-*`. Todas las UPDATEs a los flags migran a `supabase.rpc('set_work_item_lifecycle', …)`.
- **Tipos**: `src/types/work-item.ts`, `src/lib/workflow-constants.ts`, `src/integrations/supabase/types.ts` (auto).

### 2.8 Señal a GCP (spec, para tu Cloud Shell)

Contrato único que GCP debe implementar:

```
POST https://<gcp>/lifecycle
{
  "work_item_id": "...",
  "radicado": "...",
  "workflow_type": "CGP|CPACA|LABORAL|PENAL_906|TUTELA",
  "prev_state": "ACTIVE",
  "new_state": "DELETED",
  "reason": "...",
  "actor": "USER|AI|SYSTEM|ADMIN",
  "actor_user_id": "...",
  "occurred_at": "2026-07-09T…Z"
}
```

Semántica GCP:
- `new_state ∈ {DELETED, ARCHIVED, PAUSED, CLOSED}` → apagar `en_scraper` / `en_pp` / `en_cpnu` / `en_samai` según proveedor de la categoría.
- `new_state = ACTIVE` viniendo de cualquier otro → re‑encender monitoreo del proveedor correspondiente.
- Idempotente por `(work_item_id, occurred_at)`.

Backfill inicial: al aprobar Fase 3, corremos una sola vez el broadcaster sobre los 30 DELETED existentes.

---

## FASE 3 — (pendiente de tu OK)

Alto nivel de la implementación posterior (no ejecutar aún):

1. Migración: enum + columna + RPC + trigger guardia + backfill de los 69.
2. Broadcaster GCP (cron cada 1 min consume `pg_notify` acumulado en tabla `gcp_lifecycle_outbox`).
3. Rewire de todos los writers/readers listados en 2.7.
4. Deprecación de `status`, `monitoring_mode`, `monitoring_disabled_*`, `demonitor_*` (marcar comentario, dejar de escribir, drop en migración posterior).
5. Gates:
   - **G1** 0 contradicciones tras backfill (query de 1.2 = todos 0).
   - **G2** 0 escrituras directas a `deleted_at`/`monitoring_enabled`/`scraping_enabled` fuera del RPC (grep + trigger guardia).
   - **G3** 30 señales GCP entregadas y confirmadas para los fantasmas.
   - **G4** un solo helper `isSyncEligible` importado por todos los dispatchers (grep).
   - **G5** transición ACTIVE→DELETED en un WI de prueba deja al scraper GCP con `en_scraper=false` end‑to‑end.

Guardrails respetados: no toco el resolver de routing CPACA/CGP, ni el fix novedad/detected_at, ni las 9 MISROUTED_CPACA_PP archivadas — el nuevo lifecycle se apoya en el resolver existente sin reescribirlo.

Dime OK (o ajustes) y pasamos a Fase 3.
