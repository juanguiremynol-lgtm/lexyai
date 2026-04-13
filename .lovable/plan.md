

## Plan: Cambiar useSamaiActuaciones para usar radicado en vez de UUID

El hook actual usa el UUID de Supabase en la URL de la API, pero SAMAI espera el radicado (ej: `05001333300320190025200`).

### Cambios

**1. `src/hooks/use-samai-actuaciones.ts`**
- Cambiar la firma de `useSamaiActuaciones(workItemId, enabled)` a `useSamaiActuaciones(workItemId, radicado, enabled)`
- Usar `radicado` en las URLs de fetch: `${SAMAI_API_BASE}/samai/work-items/${radicado}/actuaciones`
- Seguir usando `workItemId` en el mapeo interno (para `work_item_id` del `WorkItemAct`)
- Actualizar `queryKey` para incluir radicado
- Habilitar solo si `radicado` existe

**2. `src/pages/WorkItemDetail/tabs/ActsTab.tsx`**
- Cambiar la llamada de `useSamaiActuaciones(workItem.id, isCPACA)` a `useSamaiActuaciones(workItem.id, workItem.radicado || "", isCPACA)`

**3. `resyncSamaiActuaciones`**
- También cambiar para recibir `radicado` y usarlo en las URLs de sync

Son cambios mínimos — solo se modifica qué valor va en la URL.

