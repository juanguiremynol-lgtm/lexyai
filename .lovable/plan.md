## Diagnóstico confirmado

Los 16 work_items se saltan en silencio por dos bugs combinados:

1. **Bug de paginación en `selectEligibleWorkItems`**: el filtro `excludeIds` se aplica en JS *después* del `LIMIT 5` del SQL. Las primeras 7 posiciones por `id ASC` son todas dead-lettered → el SQL trae 5 dead-letter → JS las filtra → `pageItems = []` → `break` inmediato → 16 skipped sin razón registrada.
2. **Dead-letters obsoletos**: 12 items con `dead_lettered=true` que se marcaron durante la era de la URL anterior de CPNU; varios tienen `scrape_status=SUCCESS` y `consecutive_failures=0`.

CPNU funciona (los logs lo confirman: `Provider cpnu returned 48 actuaciones`).

## Cambios a aplicar

### Fix #1 — `supabase/functions/_shared/sync-eligibility.ts`

Mover `excludeIds` al WHERE del SQL (antes del `limit`) y eliminar el filtro JS post-fetch:

```ts
if (options?.excludeIds && options.excludeIds.length > 0) {
  const list = options.excludeIds.map(id => `"${id}"`).join(",");
  query = query.not("id", "in", `(${list})`);
}
// luego limit, order, etc.
```

### Fix #2 — `supabase/functions/scheduled-daily-sync/index.ts` (línea ~827)

Endurecer el `break` de paginación para detectar el caso "página vacía pero quedan items por procesar":

```ts
if (pageItems.length === 0) {
  if (processedCount < expectedTotal) {
    failureReason = "PAGINATION_GAP";
    console.warn(`[daily-sync] PAGINATION_GAP org=${orgId} processed=${processedCount}/${expectedTotal}`);
  }
  break;
}
```

Esto deja el incidente observable si el bug volviera a aparecer por otra causa.

### Reset de dead-letter (Opción B — agresiva)

Vía `supabase--insert`:

```sql
UPDATE sync_item_failure_tracker
SET dead_lettered = false,
    consecutive_failures = 0,
    last_dead_lettered_at = NULL
WHERE organization_id = 'a0000000-0000-0000-0000-000000000001'
  AND dead_lettered = true;
```

Si vuelven a fallar 5 veces consecutivas, el sistema los re-marcará automáticamente.

### Re-disparar y verificar

1. Desplegar las 2 edge functions modificadas (`scheduled-daily-sync`, y cualquiera que importe `_shared/sync-eligibility.ts` se redeploya solo).
2. `POST /scheduled-daily-sync` con `{"scope":"MONITORING_ONLY","_scheduled":true}`.
3. Consultar `auto_sync_daily_ledger` del último `run_id` y validar:
   - `items_targeted` ≈ 28
   - `items_succeeded > 0`
   - status `SUCCESS` o `PARTIAL` (no `FAILED` con 0 procesados)

## Detalles técnicos

**Archivos editados**: 2 (`sync-eligibility.ts`, `scheduled-daily-sync/index.ts`)
**Operaciones de datos**: 1 UPDATE en `sync_item_failure_tracker`
**Sin cambios en**: schema, URLs de proveedores, orquestador, cron schedules.
