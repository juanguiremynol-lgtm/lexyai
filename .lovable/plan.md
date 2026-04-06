

## Plan: Edge Function `sync-pp-by-work-item` + integración cron

### 1. Migración de base de datos
Agregar columnas de tracking PP a `work_items`:
```sql
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS pp_ultima_sync timestamptz;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS pp_estado text DEFAULT 'pending';
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS pp_novedades_pendientes integer DEFAULT 0;
```

### 2. Crear `supabase/functions/sync-pp-by-work-item/index.ts`
Edge Function simplificada (sin jobs asíncronos):

1. Recibe `{ work_item_id, _scheduled? }` con CORS y health check estándar
2. Lee work_item de Supabase → obtiene `pp_id`, `radicado`, `owner_id`
3. Si no tiene `pp_id`: POST `PP_API_BASE/work-items` con `{ radicado }` → guarda `item.id` como `pp_id`
4. GET `PP_API_BASE/work-items/{pp_id}/actuaciones` → array de actuaciones
5. Mapea cada actuación a `work_item_acts`:
   - `hash_fingerprint`: `pp_act_{workItemId.slice(0,8)}_{ppActuacionId}`
   - `act_date`: parsea DD/MM/YYYY → YYYY-MM-DD
   - `description`: `descripcion` (o `actuacion` como fallback)
   - `source`: `"pp"`, `act_type`: `"publicacion_pp"`
   - `raw_data`: objeto completo de la API
6. Upsert con `onConflict: 'work_item_id,hash_fingerprint'` (índice único ya existe)
7. Calcula novedades pendientes (inserted_count) y actualiza work_item: `pp_ultima_sync`, `pp_estado`, `pp_novedades_pendientes`
8. Retorna `{ ok, inserted_count, skipped_count }`

Auth: `_scheduled=true` usa service role (cron), sino valida JWT.

### 3. Integrar en `scheduled-daily-sync`
En `syncSingleItem` (~línea 1213), después del bloque de publicaciones, agregar invocación de `sync-pp-by-work-item` para items con radicado de 23 dígitos:

```typescript
// Sync PP actuaciones
if (syncOk && item.radicado?.replace(/\D/g, '').length === 23) {
  try {
    await supabase.functions.invoke("sync-pp-by-work-item", {
      body: { work_item_id: item.id, _scheduled: true },
    });
  } catch (_ppErr) { /* non-blocking */ }
}
```

No se necesita nuevo pg_cron — PP corre dentro del daily-sync existente.

### Archivos afectados
- **Nuevo**: `supabase/functions/sync-pp-by-work-item/index.ts`
- **Editado**: `supabase/functions/scheduled-daily-sync/index.ts` (agregar invocación PP)
- **Migración**: 3 columnas nuevas en `work_items`

