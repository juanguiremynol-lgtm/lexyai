

## Plan: Unificar pestaña "Notificaciones" sobre `alert_instances`

### Objetivo
Reemplazar `NotificationsAlertTab` para que consuma `alert_instances` (misma fuente que las pestañas "Todas" y "Por portal") y renderice cada fila con `AlertConsolidatedRow`. Elimina la divergencia entre la tabla legacy `notifications` y el sistema canónico de alertas.

### Cambio único — `src/pages/WorkItemDetail/tabs/NotificationsAlertTab.tsx`

Reescribir el componente conservando su shape externa (mismas props, misma ubicación en el detalle del work item) pero cambiando origen de datos y render:

**Query**:
```ts
supabase
  .from("alert_instances")
  .select("*")
  .eq("entity_id", workItemId)
  .order("fired_at", { ascending: false })
  .limit(100);
```
Sin filtros adicionales — la pestaña muestra todas las alertas asociadas al expediente (procedurales y operativas).

**Render**:
- Usar `AlertConsolidatedRow` para alertas procedurales (mismo helper `isProcedural` que `Alerts.tsx`: `ACTUACION_*`, `PUBLICACION_*`, `ESTADO_*`).
- Para alertas no procedurales (TAREA_VENCIDA, HEARING_*, TERMINO_*, WATCHDOG_*), mantener un render simple inline (título + mensaje + severidad + fecha) sin badge de portal — esas alertas no tienen `payload.portal`.
- Conservar handlers existentes (`onAcknowledge`, `onDismiss`) cableados a las mutaciones que ya usa `Alerts.tsx` (reutilizar `useAlertActions` si existe, o duplicar la lógica mínima de `update alert_instances set status='ACKNOWLEDGED'/'DISMISSED'`).
- Estados: loading skeleton, empty state ("Sin notificaciones para este expediente"), error.

**KPIs / header opcional**: mantener el contador "N notificaciones" si la versión actual lo tenía; calcular desde el array.

**Realtime (opcional)**: suscribirse a `postgres_changes` en `alert_instances` filtrado por `entity_id=eq.${workItemId}` para refresco en vivo (mismo patrón que `Alerts.tsx` si ya lo aplica). Si el componente actual no tiene realtime, no añadirlo en este paso.

### Limpieza

- **No tocar la tabla `notifications`** ni `insert_notification()`. El sistema legacy de email sigue intacto (ver "Fuera de alcance").
- Eliminar imports muertos hacia `notifications` en este componente.
- Si quedan utilidades exclusivas del antiguo render (mappers de `notifications.metadata`), borrarlas del archivo.

### Detalles técnicos

- `AlertConsolidatedRow` ya tolera payloads incompletos (renderiza "—" para campos faltantes) → alertas viejas sin enriquecer no rompen UI.
- RLS: `alert_instances` filtra por `owner_id`/`organization_id` igual que en `Alerts.tsx`; el query devolverá solo lo permitido.
- Tipos: extender la interfaz local `AlertInstance` igual que en `Alerts.tsx` para incluir `alert_source`, `payload`, `read_at`.
- Sin migración SQL, sin cambios en otros archivos.

### Fuera de alcance

- No se elimina la tabla `notifications` ni los triggers que la alimentan (sigue siendo fuente para `dispatch-update-emails-5min`).
- No se modifica `Alerts.tsx`, `AlertConsolidatedRow.tsx` ni `portal-badge.ts`.
- No se cambia el orden/visibilidad de pestañas en el detalle del work item.
- No se backfillea nada — `alert_instances` ya está poblada y enriquecida.

