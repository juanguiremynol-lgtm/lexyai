

## Plan: Ajustes mínimos de rango y filtro

### 1. `src/lib/services/andromeda-novedades.ts`
En `getAndromedaDateRange`, cambiar `hasta` para que sea **hoy COT** en lugar de **ayer COT** en las tres ventanas:

```ts
export function getAndromedaDateRange(window: HoyWindow): { desde: string; hasta: string } {
  const hasta = getColombiaToday();
  const daysBack = window === "today" ? 0 : window === "three_days" ? 2 : 6;
  const desde = getColombiaDate(-1 - daysBack);
  return { desde, hasta };
}
```

`desde` se mantiene igual (ayer, ayer-2, ayer-6) para preservar la ventana "incluye ayer" tras el cron de las 2 AM COT.

### 2. `src/pages/ActuacionesHoy.tsx`
**Sin cambios.** Se mantiene el filtro `["CPNU", "SAMAI"]` tal como está.

### 3. `src/pages/EstadosHoy.tsx`
Cambiar el array de fuentes pasado a `fetchNovedadesWithFallback` a `["PP", "SAMAI_ESTADOS"]`. Si `mapSource()` no reconoce `"PP"`, agregar el mapeo correspondiente para que el badge se renderice correctamente.

### Fuera de alcance
- No se toca `getAndromedaFallbackRange()` (ya quedó con `hasta = hoy COT` en el cambio anterior).
- No se modifica la lógica de fallback ni el banner amarillo.
- No se ajusta el parseo de fechas `DD/MM/YYYY` para sort.

