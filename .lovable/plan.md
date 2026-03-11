

## Plan: Enriquecer work items CPNU con datos de API externa (enfoque híbrido)

### Estrategia

Supabase sigue siendo la **única fuente de verdad** para la lista de work items. La API externa solo **enriquece** los items CPNU con campos de monitoreo adicionales.

```text
┌─────────────────┐     ┌──────────────────────┐
│  Supabase DB    │     │  CPNU Read API       │
│  (all items)    │     │  (CPNU enrichment)   │
└────────┬────────┘     └──────────┬───────────┘
         │                         │
         ▼                         ▼
    workItems[]              cpnuMap{id→data}
         │                         │
         └────────┬────────────────┘
                  ▼
         merged WorkItem[] (CPNU items get extra fields)
```

### Cambios en `src/hooks/use-work-items-list.ts`

1. **Mantener la query a Supabase exactamente como está** — todos los work items siguen viniendo de la BD.

2. **Agregar un segundo `useQuery`** que llame a la API externa:
   - URL: `https://cpnu-read-api-486431576619.us-central1.run.app/work-items`
   - Solo se ejecuta si hay items con proveedor CPNU en los resultados
   - Retorna un `Map<work_item_id, CpnuEnrichment>` para lookup O(1)

3. **Merge en un `useMemo`**: para cada work item, si existe en el mapa CPNU, sobrescribir/agregar campos de monitoreo:
   - `last_checked_at` ← `cpnu_last_sync_at`
   - `total_actuaciones` ← `cpnu_total_actuaciones`
   - Campos nuevos pasados como propiedades extra: `cpnu_status`, `ultimo_run_status`, `ultimo_run_has_novedad`, `tipo_novedad`, `ultima_novedad_descripcion`, `ultima_novedad_fecha`, etc.

4. **Extender la interfaz `WorkItem`** en `src/types/work-item.ts` con campos opcionales de enriquecimiento CPNU para que los consumidores puedan accederlos sin casteos.

### Qué NO cambia

- La interfaz del hook (`UseWorkItemsListOptions`, filtros, return type)
- La query a Supabase y todos sus filtros server-side
- El filtro de búsqueda en memoria
- Items de SAMAI, TUTELA, CPACA, etc. — no se tocan

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/hooks/use-work-items-list.ts` | Agregar query CPNU + merge |
| `src/types/work-item.ts` | Agregar campos opcionales CPNU |

