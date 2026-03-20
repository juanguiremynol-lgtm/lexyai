

## Plan: Guardar PP ID numérico y usarlo en hooks/componentes PP

### Problema
La PP API usa IDs numéricos internos. Actualmente los hooks PP pasan el UUID de Supabase, pero la API espera `body.item.id` (numérico). Necesitamos capturar ese ID al registrar y usarlo en todas las llamadas PP.

---

### 1. Migración: agregar columna `pp_id` a `work_items`
```sql
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS pp_id INTEGER;
```

### 2. Modificar `src/lib/cpnu/register-and-sync.ts`
- En `registerAndSyncPp`: tras `POST /work-items`, extraer `body.item.id` y guardarlo en `work_items.pp_id` vía Supabase update
- Usar el `ppId` numérico para la llamada de sync: `POST /work-items/${ppId}/sync`
- Importar `supabase` client

### 3. Modificar `src/hooks/use-pp-actuaciones.ts`
- Cambiar firma: `usePpActuaciones(ppId: number | null, enabled?)`
- URL: `${PP_API_BASE}/work-items/${ppId}/actuaciones`
- `enabled` solo si `ppId != null`
- `resyncPpActuaciones(ppId: number)` usa `ppId` en URL

### 4. Modificar `src/hooks/use-pp-novedades.ts`
- Cambiar firma: `usePpNovedades(ppId: number | null)`
- URL: `${PP_API_BASE}/work-items/${ppId}/novedades` y `/revisar`
- `enabled` solo si `ppId != null`

### 5. Modificar `src/pages/WorkItemDetail/tabs/PublicacionesPpTab.tsx`
- Pasar `workItem.pp_id` al hook en lugar de `workItem.id`
- Resync usa `workItem.pp_id`
- Si `pp_id` es null pero radicado existe, mostrar mensaje "Registrando en PP..."

### 6. Modificar `src/components/work-items/NovedadesPpPanel.tsx`
- Recibir `ppId: number | null` en lugar de `workItemId: string`
- Pasar a `usePpNovedades(ppId)`

### 7. Actualizar `src/pages/WorkItemDetail/index.tsx`
- Pasar `workItem.pp_id` a `PublicacionesPpTab` y `NovedadesPpPanel`

### 8. Callers de `registerAndSyncPp`
- `use-create-work-item.ts`: tras registro exitoso, invalidar `["work-item-detail"]` para que `pp_id` aparezca
- `AddRadicadoInline.tsx`: igual

