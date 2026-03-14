

## Plan: Corregir CSP y error 42P10

### Problema 1: CSP bloquea llamadas a la API CPNU
La directiva `connect-src` en `index.html` (línea 18) solo permite `'self'` y `*.supabase.co`. Las llamadas `fetch` a `https://cpnu-read-api-486431576619.us-central1.run.app` son bloqueadas por el navegador.

**Solución**: Agregar el dominio de la API CPNU a `connect-src`:
```
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cpnu-read-api-486431576619.us-central1.run.app;
```

**Archivo**: `index.html` línea 18.

---

### Problema 2: Error 42P10 en `work_item_acts`
En `src/hooks/use-create-work-item.ts` línea 182, el `upsert` usa `onConflict: 'hash_fingerprint'`, pero no existe un índice único sobre `hash_fingerprint` solo — el único índice único es sobre `(work_item_id, hash_fingerprint)`.

PostgreSQL error 42P10 = "there is no unique or exclusion constraint matching the ON CONFLICT specification".

**Solución**: Cambiar el `onConflict` a `'work_item_id,hash_fingerprint'`:
```typescript
.upsert(actsToInsert as any, { 
  onConflict: 'work_item_id,hash_fingerprint',
  ignoreDuplicates: true 
});
```

**Archivo**: `src/hooks/use-create-work-item.ts` línea 182.

---

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `index.html` | Agregar dominio CPNU a `connect-src` |
| `src/hooks/use-create-work-item.ts` | Corregir `onConflict` de `'hash_fingerprint'` a `'work_item_id,hash_fingerprint'` |

