

## Plan: Eliminar duplicados SAMAI en el tab de Estados

### Causa raíz
El tab de Estados muestra datos de **3 fuentes** que se solapan:

1. `work_item_publicaciones` — 23 registros (15 samai_estados + 8 publicaciones)
2. `work_item_acts` WHERE source='SAMAI_ESTADOS' — 2 registros directos
3. `work_item_acts` confirmados por provenance SAMAI_ESTADOS — ~14 registros adicionales

Total antes de dedup: ~39. El dedup por `hash_fingerprint` reduce a ~31, pero los registros de `work_item_publicaciones` y `work_item_acts` tienen fingerprints distintos (tablas diferentes, IDs diferentes), así que no se eliminan entre sí.

**En resumen**: los mismos estados SAMAI están duplicados entre `work_item_publicaciones` (donde ahora se persisten correctamente) y `work_item_acts` (donde existían antes por provenance).

### Solución propuesta

Dado que los SAMAI estados ya se guardan correctamente en `work_item_publicaciones` con `source = 'samai_estados'`, la fuente `work_item_acts` es redundante para estos datos. El fix más limpio:

**Archivo**: `src/pages/WorkItemDetail/tabs/EstadosTab.tsx`

1. **Eliminar las queries a `work_item_acts`** — ya no buscar ni los directos (source='SAMAI_ESTADOS') ni los de provenance
2. **Simplificar el query** a solo `work_item_publicaciones` para este work item
3. **Mantener el dedup por hash_fingerprint** como safety net

### Cambio concreto

Simplificar el `queryFn` (~líneas 139-290):
- Eliminar la query a `provider_instances` / `provider_connectors`
- Eliminar la query a `work_item_acts` (ambas: directa y provenance)
- Eliminar la lógica de merge de `fromSamaiEstados` y `fromProvenance`
- Dejar solo la query a `work_item_publicaciones` + el dedup existente

Resultado esperado: el tab mostrará exactamente los 23 registros de `work_item_publicaciones` (15 SAMAI + 8 Publicaciones).

### Riesgo
Si hay work items donde los estados SAMAI **solo** existen en `work_item_acts` (nunca se sincronizaron a `work_item_publicaciones`), se perderían del tab. Esto solo afectaría a work items que no se hayan re-sincronizado después del fix de persistencia.

### Alternativa conservadora
En vez de eliminar las queries a `work_item_acts`, podríamos mejorar el dedup comparando por contenido (fecha + descripción normalizada) en vez de solo `hash_fingerprint`. Esto es más complejo pero no perdería datos.

### Recomendación
Ir con la **solución principal** (eliminar queries a `work_item_acts`) ya que los 9 work items CPACA ya fueron re-sincronizados. Si algún work item falta datos, se puede re-sincronizar.

