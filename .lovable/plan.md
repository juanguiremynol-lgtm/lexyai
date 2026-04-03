

# Plan: Sincronizar acciones de gestión CGP con Google Cloud SQL

## Resumen

Crear un servicio centralizado que llame los endpoints CPNU cuando un work item es CGP, e integrarlo en los 4 puntos de la UI que actualmente solo actualizan Supabase. Las llamadas son fire-and-forget (no bloquean el flujo).

## Cambios

### 1. Nuevo servicio: `src/lib/services/cpnu-sync-service.ts`

Función utilitaria que hace PATCH fire-and-forget a los endpoints CPNU:

- `syncCpnuPausar(workItemId, razon)` → PATCH `/work-items/:id/pausar`
- `syncCpnuReactivar(workItemId)` → PATCH `/work-items/:id/reactivar`
- `syncCpnuEliminar(workItemId, razon)` → PATCH `/work-items/:id/eliminar`

Cada función usa `CPNU_API_BASE` de `api-urls.ts`, hace fetch sin await en el caller (fire-and-forget), y loguea errores a console.warn sin interrumpir el flujo.

### 2. `WorkItemMonitoringControls.tsx` — Suspender/Reactivar

- Importar `syncCpnuPausar` y `syncCpnuReactivar`
- Añadir `workflowType` al prop `workItem`
- En `suspendMutation.onSuccess`: si `workflowType === "CGP"`, llamar `syncCpnuPausar`
- En `reactivateMutation.onSuccess`: si CGP, llamar `syncCpnuReactivar`
- Actualizar el caller en `index.tsx` para pasar `workflow_type`

### 3. `WorkItemMonitoringToggle.tsx` — Switch enable/disable

- Importar sync functions
- Añadir prop `workflowType`
- En `disable()` tras éxito: si CGP, `syncCpnuPausar`
- En `enable()` tras éxito: si CGP, `syncCpnuReactivar`
- Actualizar callers que usen este componente para pasar workflow_type

### 4. `OverviewTab.tsx` — toggleMonitoringMutation

- En `onSuccess`: si `workItem.workflow_type === "CGP"`, llamar `syncCpnuPausar` o `syncCpnuReactivar` según el valor de `enabled`

### 5. `work-item-delete-service.ts` — Soft delete

- Importar `syncCpnuEliminar`
- Después de las operaciones exitosas de Supabase, si `item.workflow_type === "CGP"`, llamar `syncCpnuEliminar(workItemId, reason)` fire-and-forget

## Notas técnicas

- Fire-and-forget: se invoca la función pero no se espera (`void syncCpnuPausar(...)` o `.catch(console.warn)`)
- No se altera el flujo existente ni se muestra error al usuario si el CPNU API falla
- Se reutiliza `CPNU_API_BASE` del archivo centralizado `api-urls.ts`

