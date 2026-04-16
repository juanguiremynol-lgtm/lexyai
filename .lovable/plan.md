
Single change: update `getAndromedaFallbackRange()` in `src/lib/services/andromeda-novedades.ts` so `hasta = getColombiaToday()` (instead of `getColombiaDate(-1)`), keeping `desde = getColombiaDate(-30)`. No other files change; source filter OR-logic already works as intended.
