

## Plan: Corregir body del POST a PP API

### Problema
La función `registerAndSyncPp` en `src/lib/cpnu/register-and-sync.ts` envía `{ work_item_id, radicado }` al endpoint PP, pero la API espera solo `{ radicado }`. Esto puede causar que el registro falle y no se asigne `pp_id` automáticamente.

### Cambio
**Archivo:** `src/lib/cpnu/register-and-sync.ts` (línea 41)

Cambiar:
```typescript
body: JSON.stringify({ work_item_id: workItemId, radicado }),
```
Por:
```typescript
body: JSON.stringify({ radicado }),
```

### Flujo resultante
1. Usuario crea work_item con radicado de 23 dígitos
2. `onSuccess` en `use-create-work-item.ts` llama `registerAndSyncPp(id, radicado)` (ya implementado)
3. POST a `PP_API_BASE/work-items` con `{ radicado }` → respuesta `{ ok: true, item: { id: NUMBER } }`
4. Se guarda `item.id` como `pp_id` en Supabase (ya implementado)
5. Se dispara sync con el `pp_id` (ya implementado)

Es un cambio de una sola línea.

