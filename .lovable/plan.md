

## Plan: Backfill enriquecimiento de payload + verificar build

### Cambio 1 — Ejecutar UPDATE de datos sobre `alert_instances`

Usar el **insert tool** (no migración SQL — es UPDATE de datos, no cambio de schema) para correr:

```sql
UPDATE alert_instances ai SET
  payload = COALESCE(ai.payload, '{}'::jsonb) || jsonb_build_object(
    'despacho', wi.authority_name,
    'demandante', wi.demandantes,
    'demandado', wi.demandados
  )
FROM work_items wi
WHERE ai.entity_id = wi.id
  AND (ai.payload->>'despacho' IS NULL OR ai.payload->>'despacho' = '')
  AND ai.alert_type IN ('ACTUACION_NUEVA','ACTUACION_MODIFIED','PUBLICACION_NEW','ESTADO_NUEVO');
```

Idempotente: solo afecta filas con `despacho` vacío. No toca `portal`, `tipo_actuacion` ni `fecha_auto` (ya backfilleados en migración previa).

Tras ejecutar, validar con un `SELECT COUNT(*)` de filas con `despacho` no nulo y un sample de 3 filas para confirmar que `AlertConsolidatedRow` ahora tiene datos visibles.

### Cambio 2 — Errores de build (stale, no requieren código)

Verifiqué `src/components/alerts/NotificationsAlertTab.tsx` (423 líneas):
- `ALERT_TYPE_LABELS` está definido localmente en línea 49.
- No hay referencias a `UserNotification`, `UserAlertType` ni `ALERT_TYPE_BADGE_STYLES` en el archivo.
- Las líneas que el error cita (96, 243, 244, 298, 299) corresponden hoy a código válido (query a `alert_instances`, badge "sin leer", JSX de filtros).

Los errores son de una versión anterior del archivo (snapshot stale del compilador). Al ejecutar cualquier cambio el build se re-evaluará y desaparecerán. No requiere edición de código.

### Fuera de alcance
- No se modifican triggers ni schema.
- No se cambia `AlertConsolidatedRow`, `Alerts.tsx` ni `NotificationsAlertTab.tsx`.
- No se backfillea `portal`, `tipo_actuacion` ni `fecha_auto` (ya hecho).

