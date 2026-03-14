

## Plan: Integración híbrida con API CPNU de Google Cloud

### Contexto

Tres puntos de integración con la API `https://cpnu-read-api-486431576619.us-central1.run.app`:

```text
Flujo 1: Creación de work item CGP con radicado
  Supabase INSERT → POST /work-items → POST /work-items/:id/sync

Flujo 2: Agregar/editar radicado en item existente
  Supabase UPDATE → POST /work-items → POST /work-items/:id/sync

Flujo 3: Detalle de work item CGP
  Supabase (datos base) + GET /work-items (enriquecimiento CPNU)
```

### Cambios

#### 1. Crear helper `src/lib/cpnu/register-and-sync.ts`
Función reutilizable que encapsula las dos llamadas a la API CPNU:
- `POST /work-items` con `{ work_item_id, radicado }`
- `POST /work-items/:id/sync` para disparar consulta inicial
- Fire-and-forget con logging, no bloquea el flujo principal
- Usado por ambos flujos (creación y edición de radicado)

#### 2. `src/hooks/use-create-work-item.ts`
En `onSuccess`, después del bloque existente de sync de Supabase edge functions, agregar llamada a `registerAndSyncCpnu()` para items CGP con radicado de 23 dígitos.

#### 3. `src/components/work-items/AddRadicadoInline.tsx`
En `onSuccess` del `saveMutation`, agregar llamada a `registerAndSyncCpnu()` pasando el `workItemId` y el radicado recién guardado. Necesita recibir `workflowType` como prop para solo ejecutar en CGP.

#### 4. `src/hooks/use-work-item-detail.ts`
Para items CGP, agregar un `useQuery` secundario que llame a `GET /work-items` (misma API que usa `useWorkItemsList`), busque el item por ID en el mapa, y enriquezca el `workItem` con campos CPNU (`cpnu_status`, `ultimo_run_status`, `tipo_novedad`, etc.). Merge en un `useMemo`.

### Archivos

| Archivo | Acción |
|---------|--------|
| `src/lib/cpnu/register-and-sync.ts` | **Crear** — helper reutilizable |
| `src/hooks/use-create-work-item.ts` | **Editar** — llamar helper en onSuccess |
| `src/components/work-items/AddRadicadoInline.tsx` | **Editar** — llamar helper + nueva prop `workflowType` |
| `src/pages/WorkItemDetail/index.tsx` | **Editar** — pasar `workflowType` a `AddRadicadoInline` |
| `src/hooks/use-work-item-detail.ts` | **Editar** — agregar query CPNU + merge para CGP |

