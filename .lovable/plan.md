

## Plan: Migrar ActsTab para leer actuaciones CGP desde Google Cloud API

### Cambios

**1. Nuevo hook: `src/hooks/use-cpnu-actuaciones.ts`**
- Fetch de `GET ${CPNU_API_BASE}/work-items/${workItemId}/actuaciones`
- Mapea cada item del API al tipo `WorkItemAct`:

```text
API field          →  WorkItemAct field
─────────────────────────────────────────
id                 →  id
actuacion          →  description
anotacion          →  event_summary
fecha_actuacion    →  act_date
fecha_registro     →  fecha_registro_source
fecha_inicial      →  inicia_termino
despacho           →  despacho
instancia          →  instancia
con_documentos     →  (store in raw_data)
cons_actuacion     →  source_reference
llave_proceso      →  (store in raw_data)
```

- Campos sin equivalencia API se rellenan con defaults (`source: "cpnu"`, `hash_fingerprint: id`, `owner_id: ""`, etc.)
- Ordena por `fecha_actuacion DESC`, luego `fecha_registro DESC`
- Query key: `["cpnu-actuaciones", workItemId]`

**2. Modificar `src/pages/WorkItemDetail/tabs/ActsTab.tsx`**
- Importar `useCpnuActuaciones` y el tipo `WorkflowType`
- Añadir prop `workflowType` al componente (o leerlo de `workItem.workflow_type`)
- Branching condicional:
  - Si `workflow_type === 'CGP'` → usar `useCpnuActuaciones(workItem.id)`
  - Else → usar query Supabase existente (sin cambios)
- El botón "Re-sync" para CGP llamará a `POST ${CPNU_API_BASE}/work-items/${workItem.id}/sync` en vez de la edge function `resync-actuaciones`
- Todo lo demás (filtros, cards, summary) opera sobre `WorkItemAct[]` sin cambios

**3. Sin cambios en:**
- `WorkItemActCard.tsx` — recibe `WorkItemAct` igual
- Otros consumidores de `work_item_acts` (hoy counts, export, etc.)

