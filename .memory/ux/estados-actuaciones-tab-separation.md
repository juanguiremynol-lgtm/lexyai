# Memory: ux/estados-actuaciones-tab-separation
Updated: 2026-02-01

## CRITICAL ARCHITECTURE RULE

**Actuaciones** and **Estados/Publicaciones** are two completely different legal concepts and MUST NEVER be mixed in the same UI tab.

### Actuaciones (Actuaciones Tab)
- **Definition**: Court clerk registry entries (libro del juzgado)
- **Data Source**: `work_item_acts` table ONLY
- **API Providers**: CPNU (CGP/LABORAL/PENAL/TUTELA), SAMAI (CPACA)
- **Sync Button**: "Actualizar ahora" (`SyncWorkItemButton`)
- **Edge Function**: `sync-by-work-item`
- **Legal Impact**: Informational only, NOT legal obligations

### Estados/Publicaciones Procesales (Estados Tab)
- **Definition**: Legally binding court notifications
- **Data Source**: `work_item_publicaciones` table ONLY
- **API Provider**: Publicaciones Procesales API (Rama Judicial)
- **Sync Button**: "Buscar Estados"
- **Edge Function**: `sync-publicaciones-by-work-item`
- **Legal Impact**: LEGAL OBLIGATIONS with deadlines (términos)

### Key Fields for Publicaciones
- `fecha_fijacion`: When the notification was posted
- `fecha_desfijacion`: When the notification was removed (CRITICAL for deadline calculation)
- `términos_inician`: Business day after fecha_desfijacion (when legal terms start)

### Code Implementation

```typescript
// EstadosTab.tsx - ONLY queries work_item_publicaciones
const { data: estados } = useQuery({
  queryKey: ["work-item-publicaciones", workItem.id],
  queryFn: async () => {
    const { data } = await supabase
      .from("work_item_publicaciones")
      .select("*")
      .eq("work_item_id", workItem.id);
    return data;
  },
});

// ActsTab.tsx - ONLY queries work_item_acts
const { data: acts } = useQuery({
  queryKey: ["work-item-actuaciones", workItem.id],
  queryFn: async () => {
    const { data } = await supabase
      .from("work_item_acts")
      .select("*")
      .eq("work_item_id", workItem.id);
    return data;
  },
});
```

### NEVER DO

1. ❌ Query both tables in EstadosTab
2. ❌ Call `sync-by-work-item` from "Buscar Estados" button
3. ❌ Mix actuaciones with publicaciones in any unified view
4. ❌ Use legacy `actuaciones` table for new code
