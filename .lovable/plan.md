

## Plan: Invalidar query CPNU tras registro exitoso

La query key del hook secundario CPNU en `useWorkItemsList` es `["cpnu-enrichment"]`. Hay que invalidarla después de que `registerAndSyncCpnu` se ejecute exitosamente.

### Cambios

#### 1. `src/lib/cpnu/register-and-sync.ts`
Cambiar la firma para que retorne `Promise<boolean>` indicando si el registro+sync fue exitoso, en vez de solo hacer log silencioso. Esto permite que los call sites sepan cuándo invalidar.

#### 2. `src/hooks/use-create-work-item.ts` (línea 212-214)
Después de `registerAndSyncCpnu`, invalidar `["cpnu-enrichment"]`:
```typescript
registerAndSyncCpnu(workItem.id, workItem.radicado!).then(ok => {
  if (ok) queryClient.invalidateQueries({ queryKey: ["cpnu-enrichment"] });
});
```

#### 3. `src/components/work-items/AddRadicadoInline.tsx` (línea 64-66)
Mismo patrón — invalidar `["cpnu-enrichment"]` tras registro exitoso:
```typescript
registerAndSyncCpnu(workItemId, radicado23).then(ok => {
  if (ok) queryClient.invalidateQueries({ queryKey: ["cpnu-enrichment"] });
});
```

### Archivos

| Archivo | Cambio |
|---------|--------|
| `src/lib/cpnu/register-and-sync.ts` | Retornar `boolean` de éxito |
| `src/hooks/use-create-work-item.ts` | Invalidar `["cpnu-enrichment"]` tras registro |
| `src/components/work-items/AddRadicadoInline.tsx` | Invalidar `["cpnu-enrichment"]` tras registro |

