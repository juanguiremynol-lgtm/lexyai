

## Plan: Fallback a últimas novedades disponibles cuando no hay resultados recientes

### Comportamiento
Cuando el API devuelve `total: 0` para el rango seleccionado (Hoy/3 Días/Semana), automáticamente reintentar con un rango ampliado (últimos 30 días) y mostrar un banner amarillo informativo.

### Cambios

#### 1. `src/lib/services/andromeda-novedades.ts`
- Agregar función `fetchNovedadesWithFallback(window, fuentes, search)` que:
  1. Llama a `fetchNovedades` con el rango normal.
  2. Si `total === 0`, reintenta con rango ampliado: `desde = ayer - 30 días`, `hasta = ayer`.
  3. Retorna `{ items, total, isFallback: boolean, fallbackRange?: {desde, hasta} }`.
- Exportar nueva función `getAndromedaFallbackRange()` (30 días hacia atrás desde ayer).

#### 2. `src/pages/EstadosHoy.tsx`
- Reemplazar la llamada a `fetchNovedades` por `fetchNovedadesWithFallback` (fuentes `PP`, `SAMAI_ESTADOS`).
- Cuando `isFallback === true`, renderizar arriba del listado un `<Alert variant="warning">` (amarillo) con el texto:
  > "No hay novedades recientes. Mostrando las últimas disponibles."
- Mostrar el rango de fechas usado como sub-texto pequeño.

#### 3. `src/pages/ActuacionesHoy.tsx`
- Mismo patrón con fuentes `CPNU` y `SAMAI`.
- Banner amarillo idéntico encima del grupo de cards.

### Detalle técnico
- El banner solo aparece cuando el rango original retornó 0 y el fallback retornó >0. Si el fallback también retorna 0, mostrar el empty state habitual sin banner.
- Se reutiliza el componente `Alert` de `@/components/ui/alert` con clases tailwind amarillas (`border-yellow-500/50 bg-yellow-50 text-yellow-900`) para mantener consistencia visual.
- El search client-side se aplica después del fallback (sobre los items retornados).
- Se conserva el polling/refetch de react-query existente.

