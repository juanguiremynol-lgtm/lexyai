

## Plan: CPACA usa Supabase en vez de API externa

### Cambios en `src/pages/WorkItemDetail/tabs/ActsTab.tsx`

**1. Línea 82** — Quitar `isCPACA`:
```typescript
const useExternalApi = isCGP;
```

**2. Línea 89** — Deshabilitar samaiQuery:
```typescript
const samaiQuery = useSamaiActuaciones(workItem.id, workItem.radicado || "", false);
```

**3. Líneas 92-93** — Simplificar branching (CPACA cae en Supabase):
```typescript
const acts = isCGP ? cpnuQuery.data : supabaseQuery.data;
const isLoading = isCGP ? cpnuQuery.isLoading : supabaseQuery.isLoading;
```

**4. Línea 96** — Quitar label SAMAI:
```typescript
const apiLabel = isCGP ? "CPNU API" : null;
```

**5. Líneas 104-106** — Eliminar bloque `if (isCPACA)` en `mutationFn` (CPACA usará el edge function de Supabase).

**6. Líneas 127-136** — Eliminar bloque `if (isCPACA)` en `onSuccess` (CPACA usará el toast genérico de Supabase).

**7. Comentarios líneas 84-87** — Actualizar para reflejar que CPACA usa Supabase.

Un solo archivo. Las actuaciones ya almacenadas en `work_item_acts` aparecerán correctamente.

