

## Plan: Agregar integración SAMAI y SAMAI_ESTADOS al flujo de creación

### Archivos afectados

1. **`src/lib/api-urls.ts`** — Agregar `SAMAI_API_BASE`
2. **`src/lib/cpnu/register-and-sync.ts`** — Nueva función `registerAndSyncSamai()` que hace 4 POSTs (samai register + sync, samai-estados register + sync)
3. **`src/hooks/use-create-work-item.ts`** — Invocar `registerAndSyncSamai()` para `workflow_type === 'CPACA'` con radicado de 23 dígitos

### Detalle técnico

**Nueva URL:**
```typescript
export const SAMAI_API_BASE = "https://samai-read-api-486431576619.us-central1.run.app";
```

**Nueva función `registerAndSyncSamai()`** — sigue el patrón existente de fire-and-forget:
1. `POST ${SAMAI_API_BASE}/samai/work-items` con `{ work_item_id, radicado }`
2. `POST ${SAMAI_API_BASE}/samai/work-items/${workItemId}/sync`
3. `POST ${SAMAI_API_BASE}/samai-estados/work-items` con `{ work_item_id, radicado }`
4. `POST ${SAMAI_API_BASE}/samai-estados/work-items/${workItemId}/sync`
- Retorna `boolean` indicando si todos los pasos fueron exitosos
- Logs de consola con prefijos `[SAMAI register]`, `[SAMAI sync]`, `[SAMAI_ESTADOS register]`, `[SAMAI_ESTADOS sync]`

**Trigger en `use-create-work-item.ts`** — en `onSuccess`, después del bloque de PP:
```typescript
if (workItem.id && radicadoDigits.length === 23 && workItem.workflow_type === 'CPACA') {
  registerAndSyncSamai(workItem.id, workItem.radicado!).then(ok => {
    if (ok) queryClient.invalidateQueries({ queryKey: ["samai-enrichment"] });
  });
}
```

Sin migración de BD necesaria — SAMAI usa el UUID de Supabase como identificador (igual que CPNU).

