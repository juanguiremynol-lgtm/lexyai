

## Plan: Backfill `payload` con datos del work_item en alertas procesales

### Cambio único — UPDATE de datos vía insert tool

Ejecutar el UPDATE provisto sobre `alert_instances`, enriqueciendo `payload` con `radicado`, `despacho`, `demandante`, `demandado` desde `work_items`. Operación de datos (no schema) → va por insert tool.

```sql
UPDATE alert_instances ai SET
  payload = COALESCE(ai.payload, '{}'::jsonb) || jsonb_build_object(
    'radicado', wi.radicado,
    'despacho', COALESCE(ai.payload->>'despacho', wi.authority_name),
    'demandante', COALESCE(ai.payload->>'demandante', wi.demandantes),
    'demandado', COALESCE(ai.payload->>'demandado', wi.demandados)
  )
FROM work_items wi
WHERE ai.entity_id = wi.id
AND ai.alert_type IN ('ACTUACION_NEW', 'ACTUACION_NUEVA', 'ACTUACION_MODIFIED', 'PUBLICACION_NEW', 'ESTADO_NUEVO');
```

### Verificación post-UPDATE

```sql
SELECT 
  COUNT(*) FILTER (WHERE payload ? 'radicado') AS con_radicado,
  COUNT(*) FILTER (WHERE payload ? 'despacho') AS con_despacho,
  COUNT(*) FILTER (WHERE payload ? 'demandante') AS con_demandante,
  COUNT(*) AS total
FROM alert_instances
WHERE alert_type IN ('ACTUACION_NEW','ACTUACION_NUEVA','ACTUACION_MODIFIED','PUBLICACION_NEW','ESTADO_NUEVO');
```

### Detalles técnicos
- **Merge no destructivo**: el operador `||` hace shallow merge sobre el JSONB existente; los `COALESCE(payload->>'campo', wi.campo)` preservan valores ya presentes y solo rellenan los faltantes.
- **`radicado` siempre se sobrescribe**: no hay `COALESCE` en ese campo, asumiendo que `work_items.radicado` es la fuente canónica. Si el payload tuviera un radicado distinto previamente, será reemplazado (esperado: alinear con la entidad).
- **Filtro por `alert_type`**: solo alertas procesales canónicas + alias legacy `ACTUACION_NEW` / `PUBLICACION_NEW`.
- **Mapeo `entity_id → work_items.id`**: coherente con el resto del sistema (work-item-centric governance).
- **Sin efecto inmediato en UI**: las alertas en pantalla no se re-renderizan hasta que React Query invalide el cache de `alert_instances` (refresh manual o navegación).

### Fuera de alcance
- No se modifica el trigger que crea alertas (futuras alertas se asume que ya incluyen el payload completo, o se manejan vía fallback ANDROMEDA en cliente).
- No se backfillea `alert_source` (ya hecho previamente).
- No se cambia el hook `useAndromedaRadicado` ni `AlertConsolidatedRow` — el fallback ANDROMEDA se mantiene como segunda línea.

