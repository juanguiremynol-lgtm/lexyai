# Auditoría (resultado del diagnóstico previo)

**Estado actual por superficie:**

| Superficie | Componente | Acciones actuales | Diagnóstico |
|---|---|---|---|
| Dashboard (Kanban CGP/Laboral/Penal/Admin) | `WorkItemPipelineCard` → `DropdownMenu` | Reclasificar · Marcar bandera · **Eliminar** | ⚠️ No hay Pausar/Reactivar en el menú. Nunca sale "Activar" para un activo desde este menú — pero cuando el ítem está pausado tampoco aparece cómo reactivar sin abrir el detalle. |
| Lista de procesos | La app **no tiene lista tabular independiente** — la "lista" son los mismos pipelines. `src/pages/Matters.tsx` es otra entidad (matters legales, no work_items). | — | Confirmar con el Doctor si "lista" se refiere a algo distinto. |
| Detalle (`WorkItemDetail`) | `WorkItemMonitoringControls` | Pausar · Reactivar · Cerrar · **Eliminar** | ✅ Funcional. Botón Eliminar invoca `softDeleteWorkItem` → `set_work_item_lifecycle` RPC → outbox GCP. |

**Divergencias detectadas:**
- CGP `WorkItemPipeline.tsx` invoca `useSoftDeleteWorkItems` + `ArchiveWorkItemDialog` (dice "Archivar", color ámbar).
- Laboral/Penal/Admin pipelines invocan `useDeleteWorkItems` + `DeleteWorkItemDialog` (dice "Eliminar", color destructive, exige tipear DELETE).
- Los dos flujos hacen exactamente lo mismo en DB (soft delete) pero la UI dice cosas distintas. Esto es la raíz de la confusión "Archivar vs Eliminar".

**Política soft/hard delete (recap del código):**
- **Soft-delete usuario**: `set_work_item_lifecycle('DELETED')` marca `deleted_at`, `purge_after = now + 10 días`, apaga `monitoring_enabled/scraping_enabled`, cancela scrape jobs pendientes, escribe outbox GCP, `atenia_ai_actions` y `work_item_soft_deletes`. Recuperable con Andro IA por 10 días.
- **Hard-delete** (`useHardPurgeWorkItems`): sólo Recycle Bin / Admin lifecycle / Master delete. No expuesto en dashboard/detalle.
- Cascadas: `work_item_acts`, `work_item_publicaciones`, `work_item_deadlines`, `alert_instances`, `work_item_tasks`, `work_item_sources`, etc. quedan intactas 10 días; se purgan por `cron_purge_expired_soft_deletes`.

**Causa raíz del error "no se pudo eliminar"** (más probable, por confirmar reproduciendo en Playwright post-fix):
1. `checkWorkItemRetention` bloquea la eliminación si hay documentos finalizados dentro del periodo de retención legal — devuelve un mensaje específico que estamos mostrando como toast, pero el usuario lo lee como "error genérico".
2. `canActOnWorkItem` — MEMBER intentando borrar WI de otro MEMBER de la misma org sin ser ADMIN → devuelve "No tienes permiso". Verificaremos con el rol real del Doctor.
3. Fallo silencioso en `set_work_item_lifecycle` cuando el estado destino = actual (`no_op`) — el helper ya retorna `ok:true` en ese caso, no debería fallar.

# Plan de implementación

## 1. Hook centralizado `useWorkItemActions(workItem)`

Nuevo archivo `src/hooks/use-work-item-actions.ts`. Retorna:
```ts
{
  available: Array<'pausar' | 'reactivar' | 'cerrar' | 'eliminar' | 'restaurar' | 'eliminar_definitivo'>,
  actions: { pausar, reactivar, cerrar, eliminar, restaurar, eliminarDefinitivo }, // fns
  isPending: boolean,
  state: 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'DELETED',
}
```

Reglas por `lifecycle_state`:
- **ACTIVE** → `[pausar, cerrar, eliminar]`
- **PAUSED** → `[reactivar, cerrar, eliminar]`
- **CLOSED** → `[reactivar, eliminar]`
- **DELETED** (dentro de purge_after) → `[restaurar, eliminar_definitivo]`

Fallback derivado cuando `lifecycle_state` es NULL: usar `deleted_at`/`monitoring_enabled` como en `isActive()` de `src/lib/lifecycle.ts`.

## 2. Unificar componente de acciones

Nuevo `src/components/work-items/WorkItemActionsMenu.tsx` (dropdown lifecycle-aware). Sustituye la sección de acciones actual en:
- `WorkItemPipelineCard` (mantiene Reclasificar/Bandera arriba + `<WorkItemActionsMenu />` para lifecycle abajo)
- `WorkItemMonitoringControls` (detalle) — renderiza el mismo menú/botones
- Cualquier `WorkItemCard` de listas futuras

## 3. Consolidar diálogos de eliminación

- **Descartar `ArchiveWorkItemDialog` en CGP pipeline** — reemplazar por `DeleteWorkItemDialog` (mismo componente que Laboral/Penal/Admin). La palabra "Archivar" desaparece de esta superficie porque confunde al usuario respecto de "Eliminar".
- Cambiar `useSoftDeleteWorkItems` → `useDeleteWorkItems` en `WorkItemPipeline.tsx` (idénticos por dentro, uniforma naming).
- `DeleteWorkItemDialog` ya muestra radicado/título + aviso de "10 días con Andro IA". Ajustar copy para dejar claro "papelera" y quitar el requisito de tipear DELETE (fricción excesiva para un soft-delete recuperable — mantener sólo el checkbox de confirmación).

## 4. Prompt "cliente huérfano"

Después de confirmar el borrado del WI, antes de ejecutar:
```ts
const { count } = await supabase
  .from('work_items')
  .select('id', { count: 'exact', head: true })
  .eq('client_id', workItem.client_id)
  .neq('id', workItem.id)
  .is('deleted_at', null)
  .in('lifecycle_state', ['ACTIVE','PAUSED','CLOSED']);
```
Si `count === 0` y hay `client_id`: mostrar segundo modal `OrphanClientDialog` con opciones **Sí, eliminar cliente** / **No, conservar**. El soft-delete del WI procede en paralelo. Si el usuario elige eliminar cliente: `DELETE FROM clients WHERE id = ?` (respetando RLS de owner).

## 5. Estado post-eliminación en detalle

En `WorkItemDetail/index.tsx`, si `lifecycle_state === 'DELETED'`:
- Mostrar banner de página completa "Expediente en papelera — recuperable hasta {purge_after}" con botones **Restaurar** (via `useRestoreWorkItems`) y **Eliminar definitivamente** (via `useHardPurgeWorkItems`, sólo si el usuario es owner+admin).
- Ocultar todos los tabs de datos vivos.
- Si el usuario no tiene permisos → mostrar sólo la info de solo-lectura.

## 6. Toast con "Deshacer"

Al soft-delete exitoso, `toast.success(..., { action: { label: 'Deshacer', onClick: () => restore(id) } })`. Ventana visual 30s; el registro en DB ya existe, el "Deshacer" simplemente llama `useRestoreWorkItems`.

## 7. Invalidación de queries

Después de cualquier acción lifecycle, invalidar en un solo lugar (dentro del hook): `work-items`, `work-items-cgp-pipeline`, `work-items-laboral-pipeline`, `work-items-penal-pipeline`, `gov-procedure-work-items`, `cpaca-processes`, `dashboard-stats`, `work-item-detail`, `archived-work-items`. El hook llama esto internamente para eliminar el copy-paste actual.

## 8. Diagnóstico y corrección del error real

Instrumentar el toast de error con el mensaje textual del RPC/service (ya lo hace `WorkItemMonitoringControls`, verificar que `useSoftDeleteWorkItems` no lo esté genericando). Reproducir con Playwright autenticado sobre un WI del Doctor para capturar el error exacto y corregir la causa (retención de docs, permisos, o RLS).

# Verificación al final

- `tsgo` verde
- Pipeline card muestra: ACTIVO → Pausar/Cerrar/Eliminar; PAUSADO → Reactivar/Cerrar/Eliminar
- Diálogo único "Eliminar" en las 4 pipelines (CGP/Laboral/Penal/Admin)
- Playwright: soft-delete de un WI de prueba → desaparece de la lista → navegar a URL de detalle → ver banner "en papelera" → Deshacer → reaparece

# Detalles técnicos

- **No tocar** `src/lib/lifecycle.ts` ni `set_work_item_lifecycle` RPC (contrato ya establecido).
- **No introducir** nueva ruta ni migración. Todo es UI + hook + reutilización de RPCs existentes.
- Preservar `WorkItemBulkDeleteDialog` para acciones masivas (ya usa lenguaje "Eliminar"/"archivar").
- La lógica del hook debe funcionar tanto con work items del pipeline (donde `WorkItemPipelineItem` no trae `lifecycle_state`) — se añadirá el campo al `select` de las queries de pipeline.

# Puntos de aclaración

1. **"Lista de procesos"** — ¿te refieres a los mismos pipelines (Dashboard) o hay otra vista tabular que estás viendo? No encontré una lista tabular separada de work_items.
2. **Purga definitiva desde detalle** — ¿el usuario final debe poder disparar hard-delete desde el banner "en papelera", o eso queda sólo para el Recycle Bin / admin?
3. **Cliente huérfano** — cuando el WI está compartido dentro de una org, ¿verificamos huerfanía a nivel de owner o de organization?
