

## Plan: Ampliar CpacaDetailModule con campos SAMAI

### Contexto
- Los campos `ponente`, `clase_proceso`, `etapa`, `ubicacion_expediente`, `tipo_proceso`, `formato_expediente`, `fecha_radicado`, `fecha_sentencia`, `origen`, `total_sujetos_procesales` ya existen en la tabla `work_items` y se traen con `SELECT *` en el hook
- La interfaz `WorkItemDetail` no los declara explícitamente pero llegan al componente vía `as unknown`
- `CpacaDetailModule.tsx` existe pero no se usa en `index.tsx`
- El detalle general ya muestra radicado, autoridad, ciudad, departamento, demandantes, demandados en una Card "Información General"

### Cambios

**1. `src/types/work-item.ts`** — Agregar campos SAMAI al tipo `WorkItem`:
```typescript
ponente?: string | null;
origen?: string | null;
clase_proceso?: string | null;
etapa?: string | null;
ubicacion_expediente?: string | null;
formato_expediente?: string | null;
tipo_proceso?: string | null;
fecha_radicado?: string | null;
fecha_sentencia?: string | null;
total_sujetos_procesales?: number | null;
subclase_proceso?: string | null;
```

**2. `src/hooks/use-work-item-detail.ts`** — Agregar los mismos campos a la interfaz `WorkItemDetail` para que TypeScript los reconozca.

**3. `src/pages/WorkItemDetail/CpacaDetailModule.tsx`** — Reescribir completamente:

- **Sección primaria** (grid 2 cols): Ponente, Clase de Proceso, Etapa, Ubicación del Expediente
- **Sección secundaria** (grid 2-3 cols, texto más pequeño o colapsable): Tipo de Proceso, Formato del Expediente, Fecha de Radicado, Fecha de Sentencia, Origen
- **Sección sujetos procesales**: Demandantes y Demandados en lista, con el total de sujetos
- Usa los mismos componentes `Card`, `CardHeader`, `CardContent` y estilo visual (label `text-sm text-muted-foreground` + valor `font-medium`) del resto del detalle
- Quitar la navegación/header propio (ya lo maneja `index.tsx`)

**4. `src/pages/WorkItemDetail/index.tsx`** — Para workflow CPACA, insertar `<CpacaDetailModule>` justo después de la Card "Información General" y antes de `RadicadoAnalyzer`:

```tsx
{workItem.workflow_type === 'CPACA' && (
  <CpacaDetailModule workItem={extendedWorkItem} />
)}
```

### Resultado
Para radicados CPACA se mostrará una card adicional con todos los datos enriquecidos de SAMAI, con el mismo estilo visual que el resto del detalle.

