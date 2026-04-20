

## Plan: Replicar diseño de EstadosHoy en ActuacionesHoy con fuentes CPNU + SAMAI

### Cambio único — `src/pages/ActuacionesHoy.tsx`

Reescribir la página alineándola con `EstadosHoy.tsx`, conservando solo lo específico de "actuaciones".

**1. queryFn**
- Llamar `fetchNovedadesWithFallback(window, ["CPNU", "SAMAI"], debouncedSearch || undefined)`.
- Eliminar `mapNovedadToActuacion`, `groupByWorkItem`, `ActuacionHoyItem`, `ActuacionGroupCard`, `ActuacionLine`.
- Ordenar por `creado_en` DESC con `localeCompare`.
- Devolver `{ items: NovedadItem[], total, isFallback, fallbackRange }`.

**2. Render**
- Mantener selector de ventana (`Hoy / 3 Días / Semana`) y banner de fallback existente.
- Listado plano: `data.items.map((n, idx) => <NovedadRow key={...} n={n} />)`.
- Componente `NovedadRow` idéntico al de `EstadosHoy.tsx`: radicado + workflow badge + clase_proceso badge, despacho con `Building2`, `demandante vs demandado` con `Users`, descripción, fecha + humanizado, badge fuente coloreado por `fuenteBadgeClass`, botón "Ver Auto" si hay `gcs_url_auto`.

**3. Diferencias respecto a Estados conservadas en Actuaciones**
- Header con `Scale` icon y título "Actuaciones de Hoy".
- Selector de ventana (`HoyWindow`).
- **Sin** banner verde de "ejecutoria" ni borde verde (concepto exclusivo de estados). Borde izquierdo siempre `border-l-primary/30`.
- **Sin** export a Excel ni query de `sync-health` (no existían en Actuaciones).

**4. `fuenteBadgeClass`**
Se copia la misma función local (CPNU → púrpura, SAMAI → azul, otras → muted).

**5. Limpieza de imports**
Quitar: `groupByWorkItem`, `ActuacionHoyItem`, `GroupedActuaciones`, `detectActuacionSeverity`, `TickerItemSource`, `formatActDate`, `ACT_TYPE_COLORS`, `guessActType`, `mapSource`, `mapNovedadToActuacion`. Añadir: `Building2`, `Users`, `ExternalLink`.

### Fuera de alcance
- No se toca `andromeda-novedades.ts` ni `actuaciones-hoy-service.ts` (queda sin usar pero no se borra para no romper otros imports).
- No se modifica `EstadosHoy.tsx`.

