

## Plan: Novedades CPNU en detalle de Work Item CGP

### Resumen
Crear un hook para fetchar/marcar novedades desde la API CPNU y un componente que las muestre en el detalle CGP con badge de conteo y botón "Marcar revisada".

### Archivos nuevos

**1. `src/hooks/use-cpnu-novedades.ts`**
- `useQuery` con key `["cpnu-novedades", workItemId]` que llama a `GET /work-items/:id/novedades`
- `useMutation` que llama a `PATCH /work-items/:id/novedades/:novedadId/revisar` y al completar invalida la query
- Retorna `{ novedades, isLoading, markAsReviewed, isMarking }`

**2. `src/components/work-items/NovedadesCpnuPanel.tsx`**
- Recibe `workItemId: string`
- Usa el hook anterior
- Muestra Card con título "Novedades" + Badge con conteo
- Lista cada novedad: tipo, descripción, valor anterior → nuevo, fecha
- Botón "Marcar revisada" por novedad (con loading state)
- Cuando se marca, desaparece de la lista (optimistic update via invalidation)
- Si no hay novedades, muestra mensaje "Sin novedades pendientes"

### Archivos a modificar

**3. `src/pages/WorkItemDetail/CGPDetailModule.tsx`**
- Importar y renderizar `<NovedadesCpnuPanel workItemId={workItem.id} />` en la columna izquierda (después de "Información del Caso"), solo si `workItem.radicado` existe.

### Interfaz de novedad
```typescript
interface Novedad {
  id: string;
  tipo_novedad: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  descripcion: string;
  revisada: boolean;
  created_at: string;
}
```

### API base URL
Reutiliza la constante `CPNU_API_URL` ya definida en `use-work-item-detail.ts`, o extrae una constante compartida: `https://cpnu-read-api-486431576619.us-central1.run.app`.

