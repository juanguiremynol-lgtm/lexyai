

## Plan: Backfill `alert_source` en `alert_instances`

### Cambio único — UPDATE de datos vía insert tool

Ejecutar el UPDATE provisto sobre `alert_instances`. Es operación de datos (no schema), por lo tanto va por el insert tool, no por migración.

```sql
UPDATE alert_instances ai SET
  alert_source = CASE 
    WHEN EXISTS (SELECT 1 FROM work_item_acts wia WHERE wia.work_item_id = ai.entity_id AND wia.source ILIKE '%cpnu%') THEN 'CPNU'
    WHEN EXISTS (SELECT 1 FROM work_item_acts wia WHERE wia.work_item_id = ai.entity_id AND wia.source ILIKE '%samai_estados%') THEN 'SAMAI_ESTADOS'
    WHEN EXISTS (SELECT 1 FROM work_item_acts wia WHERE wia.work_item_id = ai.entity_id AND wia.source ILIKE '%samai%') THEN 'SAMAI'
    WHEN EXISTS (SELECT 1 FROM work_item_publicaciones wip WHERE wip.work_item_id = ai.entity_id) THEN 'PP'
    ELSE 'UNKNOWN'
  END
WHERE (ai.alert_source IS NULL OR ai.alert_source = '' OR ai.alert_source = 'UNKNOWN')
AND ai.alert_type IN ('ACTUACION_NEW', 'ACTUACION_NUEVA', 'ACTUACION_MODIFIED', 'PUBLICACION_NEW', 'ESTADO_NUEVO');
```

### Verificación post-UPDATE
Query de control para confirmar la nueva distribución:
```sql
SELECT alert_source, COUNT(*) 
FROM alert_instances 
WHERE alert_type IN ('ACTUACION_NEW','ACTUACION_NUEVA','ACTUACION_MODIFIED','PUBLICACION_NEW','ESTADO_NUEVO')
GROUP BY alert_source ORDER BY 2 DESC;
```

### Detalles técnicos
- **Prioridad del CASE**: CPNU → SAMAI_ESTADOS → SAMAI → PP → UNKNOWN. El orden importa porque `samai_estados` contiene `samai` como substring, por eso va antes.
- **Filtro WHERE**: solo toca filas con `alert_source` faltante o `'UNKNOWN'`, no sobrescribe valores ya correctos.
- **`entity_id`**: se asume que para alertas procesales mapea a `work_item_id`. Coherente con la relación usada por el resto de queries de alerts.
- **Sin efecto en UI hasta refresh**: las alertas existentes en pantalla no se re-renderizan hasta que el usuario recargue o React Query invalide el cache de `alert_instances`.

### Fuera de alcance
- No se modifica el trigger que asigna `alert_source` en nuevas alertas.
- No se backfillea `payload` (ya hecho en backfill previo).
- No se cambia `normalizePortal` ni `PORTAL_LABEL`.

