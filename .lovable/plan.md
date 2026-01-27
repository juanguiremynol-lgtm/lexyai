
# Plan de Desmantelamiento Legacy: Migración work_item_id

## Resumen Ejecutivo

Este plan completa la migración canónica a `work_items`, eliminando dependencias de tablas legacy (`filings`, `monitored_processes`) en Edge Functions y frontend, mientras preserva la funcionalidad polimórfica para resolución de IDs legacy existentes.

---

## Estado Actual del Sistema

### Columnas work_item_id (Ya Implementadas)
- `actuaciones.work_item_id` ✅
- `process_events.work_item_id` ✅  
- `cgp_milestones.work_item_id` ✅
- `work_item_acts.work_item_id` ✅ (ya es NOT NULL)

### Datos Operacionales
Las tablas de eventos están vacías (0 registros en actuaciones, process_events, cgp_milestones), por lo que no hay migración de datos pendiente.

### Dependencias Legacy Identificadas

| Componente | Referencias Legacy | Estado |
|------------|-------------------|--------|
| `normalize-actuaciones` | filing_id, monitored_process_id | ❌ Crítico |
| `scheduled-crawler` | filing_id, monitored_process_id | ❌ Crítico |
| `crawl-rama-judicial` | filing_id | ❌ Legacy |
| `sync-by-radicado` | Ya usa work_item_id | ✅ OK |
| `sync-penal906-by-radicado` | Ya es work_item-native | ✅ OK |
| Frontend (~40 archivos) | Queries a filings/monitored_processes | 🔶 Parcial |

---

## Parte 1: Edge Functions — Refactor a work_item-native

### 1.1 `normalize-actuaciones` (Prioridad Alta)

**Problema actual:**
- Requiere `filing_id` o `monitored_process_id` como entrada
- Crea registros en `filings` cuando no existe (líneas 340-405)
- No soporta `work_item_id` como entrada primaria

**Cambios:**
```text
1. Aceptar work_item_id como parámetro primario
2. Fallback: resolver work_item_id desde legacy IDs si se proveen
3. Escribir actuaciones normalizadas con work_item_id
4. Eliminar creación automática de filings placeholder
5. Deduplicar por UNIQUE(work_item_id, hash_fingerprint)
```

### 1.2 `scheduled-crawler` (Prioridad Alta)

**Problema actual:**
- Itera tablas `filings` y `monitored_processes` directamente
- Escribe actuaciones con `filing_id`/`monitored_process_id`
- Genera alertas con rutas legacy (`/filings/:id`, `/processes/:id`)

**Cambios:**
```text
1. Reemplazar fetch de filings/monitored_processes por:
   SELECT * FROM work_items 
   WHERE monitoring_enabled = true 
   AND workflow_type IN ('CGP', 'CPACA', 'TUTELA', 'LABORAL')
   AND radicado IS NOT NULL

2. Escribir actuaciones con work_item_id
3. Actualizar alertas para usar rutas /work-items/:id
4. Actualizar last_checked_at en work_items directamente
```

### 1.3 `crawl-rama-judicial` (Deprecar o Migrar)

Este Edge Function usa `filing_id` explícitamente. Dado que su funcionalidad se superpone con `sync-by-radicado`, se puede:
- **Opción A**: Refactorizar para aceptar `work_item_id`
- **Opción B**: Deprecar y redirigir llamadas a `sync-by-radicado`

**Recomendación**: Opción A (mantener separación de responsabilidades)

### 1.4 Otros Edge Functions a Revisar

| Function | Cambios Necesarios |
|----------|-------------------|
| `adapter-publicaciones` | Cambiar `monitored_process_id` → `work_item_id` |
| `adapter-historico` | Cambiar `monitored_process_id` → `work_item_id` |
| `icarus-sync` | Cambiar `filing_id` → `work_item_id` |
| `hearing-reminders` | Ya parcialmente migrado, completar |
| `delete-work-items` | Ya usa work_item_id ✅ |
| `purge-organization-data` | Agregar limpieza por work_item_id |

---

## Parte 2: Frontend — Consolidar a work_items

### 2.1 Hook `useWorkItemDetail` (Archivo: `src/hooks/use-work-item-detail.ts`)

**Estado actual**: Usa resolución polimórfica (work_items → cgp_items → peticiones → monitored_processes → cpaca_processes)

**Cambios:**
```text
1. Mantener resolución polimórfica para IDs legacy (compatibilidad hacia atrás)
2. Priorizar work_items como fuente primaria
3. Actualizar fetchActuaciones para usar work_item_id primero:
   - Intentar: .eq("work_item_id", id)
   - Fallback legacy: .eq("filing_id", legacyFilingId) o .eq("monitored_process_id", legacyProcessId)
4. Mismo patrón para fetchProcessEvents, fetchHearings, etc.
```

### 2.2 Componentes con Referencias Legacy Directas

Los siguientes archivos requieren cambios:

**Alta prioridad (pipelines/kanban):**
- `src/pages/Filings.tsx` — Usar work_items con filtro workflow_type
- `src/pages/CGPDetail.tsx` — Mantener fallback polimórfico
- `src/pages/WorkItemDetail/*` — Actualizar tabs para usar work_item_id

**Media prioridad (settings/admin):**
- `src/components/settings/MasterDeleteSection.tsx` — Usar delete-work-items
- `src/components/settings/PurgeLegacyDataSection.tsx` — Mantener para purga explícita

**Baja prioridad (features específicas):**
- `src/components/filings/NewFilingDialog.tsx` — Crear en work_items directamente
- `src/components/email/EmailLinkDialog.tsx` — Filtrar desde work_items
- `src/components/tutelas/*` — Migrar a work_items

### 2.3 Rutas y Redirects

**Estado actual**: `ItemRedirect.tsx` y `CGPRedirect.tsx` ya redirigen a `/work-items/:id`

**Sin cambios necesarios** — La resolución de IDs legacy ya está implementada.

---

## Parte 3: Limpieza de Código Muerto

### 3.1 Código a Eliminar

```text
Archivos potencialmente obsoletos:
- src/components/filings/ProcessTimeline.tsx (si usa filing_id exclusivamente)
- src/pages/ProcessStatus.tsx (si es wrapper legacy)
- Hooks que solo consultan tablas legacy sin fallback

Verificación necesaria:
- Buscar imports no utilizados
- Identificar componentes sin referencias
```

### 3.2 Tipos TypeScript a Consolidar

```text
- Actualizar src/types/work-item.ts si faltan campos
- Eliminar tipos duplicados para Filing/MonitoredProcess si no se usan
- Agregar tipos para work_item_id en interfaces de Edge Functions
```

---

## Parte 4: Base de Datos — Constraints y Cleanup

### 4.1 Agregar Índices Únicos (Si no existen)

```sql
-- Deduplicación canónica por work_item
CREATE UNIQUE INDEX IF NOT EXISTS idx_actuaciones_work_item_fingerprint_unique 
ON actuaciones(work_item_id, hash_fingerprint) 
WHERE work_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_process_events_work_item_fingerprint_unique 
ON process_events(work_item_id, hash_fingerprint) 
WHERE work_item_id IS NOT NULL;
```

### 4.2 Mantener Columnas Legacy (Fase Transicional)

**NO eliminar** `filing_id`, `monitored_process_id` todavía — se necesitan para:
1. Resolución polimórfica de IDs legacy
2. Datos históricos que puedan existir en producción de otros tenants

### 4.3 Helper Function para Resolución

Verificar que existe:
```sql
public.resolve_work_item_id(p_radicado text, p_owner_id uuid) → uuid
```

---

## Parte 5: Email Provider Abstraction

### 5.1 Crear Interface de Proveedor

```text
Archivo: src/lib/email/provider-interface.ts

interface EmailProvider {
  name: string;
  send(params: EmailParams): Promise<EmailResult>;
  getStatus(messageId: string): Promise<EmailStatus>;
  handleWebhook(payload: unknown): Promise<WebhookResult>;
}
```

### 5.2 Implementación Resend (Ya Configurada)

```text
Archivo: src/lib/email/providers/resend-provider.ts

Usar RESEND_API_KEY existente
Mapear a la interface común
```

### 5.3 Outbox Processing

```text
Edge Function: process-email-outbox (ya existe)
- Verificar que use la abstracción de proveedor
- Agregar idempotency keys
- Implementar retry con backoff exponencial
```

---

## Orden de Implementación

### Fase 1: Schema & Indexes (Si es necesario)
1. Verificar índices únicos existen
2. Verificar helper function `resolve_work_item_id`

### Fase 2: Edge Functions (Crítico)
1. Refactorizar `normalize-actuaciones`
2. Refactorizar `scheduled-crawler`
3. Actualizar `adapter-publicaciones`, `adapter-historico`
4. Deprecar o refactorizar `crawl-rama-judicial`

### Fase 3: Frontend Hooks
1. Actualizar `useWorkItemDetail` para priorizar work_item_id
2. Actualizar `useNormalizeActuaciones` para pasar work_item_id

### Fase 4: Componentes UI
1. Actualizar pipelines/kanbans
2. Actualizar dialogs de creación
3. Limpiar imports no usados

### Fase 5: Email Abstraction
1. Crear interface de proveedor
2. Implementar ResendProvider
3. Actualizar process-email-outbox

### Fase 6: Cleanup
1. Identificar código muerto
2. Eliminar imports no usados
3. Actualizar documentación

---

## Riesgos y Mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Romper flujo de crawling | Mantener dual-write durante transición |
| IDs legacy no resuelven | Mantener resolución polimórfica |
| Datos huérfanos | No eliminar columnas legacy todavía |
| Email delivery falla | Abstracción permite cambiar proveedor |

---

## Criterios de Aceptación

1. ✅ `normalize-actuaciones` acepta `work_item_id` como entrada primaria
2. ✅ `scheduled-crawler` itera `work_items` en lugar de tablas legacy
3. ✅ Frontend prioriza `work_item_id` en queries
4. ✅ Resolución polimórfica de IDs legacy sigue funcionando
5. ✅ Alertas y rutas usan `/work-items/:id`
6. ✅ Email outbox funciona con provider abstraction
7. ✅ Cero regresiones en Kanban/pipelines existentes

---

## Archivos a Modificar

### Edge Functions
- `supabase/functions/normalize-actuaciones/index.ts`
- `supabase/functions/scheduled-crawler/index.ts`
- `supabase/functions/crawl-rama-judicial/index.ts`
- `supabase/functions/adapter-publicaciones/index.ts`
- `supabase/functions/adapter-historico/index.ts`
- `supabase/functions/icarus-sync/index.ts`

### Frontend Hooks
- `src/hooks/use-work-item-detail.ts`
- `src/hooks/use-normalize-actuaciones.ts`

### Componentes
- `src/pages/CGPDetail.tsx`
- `src/pages/Filings.tsx`
- `src/components/filings/NewFilingDialog.tsx`

### Email (Nuevos)
- `src/lib/email/provider-interface.ts`
- `src/lib/email/providers/resend-provider.ts`
