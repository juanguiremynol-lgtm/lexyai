

## Plan: Agregar alias legacy al set `PROCEDURAL_ALERT_TYPES`

### Cambio único — añadir `'ACTUACION_NEW'` al set en dos archivos

`'PUBLICACION_NEW'` ya está en el set actual, así que solo falta `'ACTUACION_NEW'` (alias legacy de `ACTUACION_NUEVA`).

**Archivos**:
- `src/pages/Alerts.tsx`
- `src/components/alerts/NotificationsAlertTab.tsx`

**Set resultante** (idéntico en ambos):
```ts
const PROCEDURAL_ALERT_TYPES = new Set([
  "ACTUACION_NUEVA",
  "ACTUACION_NEW",        // alias legacy
  "ACTUACION_MODIFIED",
  "PUBLICACION_NEW",
  "PUBLICACION_MODIFIED",
  "ESTADO_NUEVO",
]);
```

El helper `isProcedural` no cambia — el fallback por `payload` ya implementado se mantiene como segunda línea de defensa.

### Fuera de alcance
- No se renombran alertas existentes en BD (alias en cliente es suficiente).
- No se tocan triggers ni edge functions que emitan `ACTUACION_NEW`.
- No se modifica `AlertConsolidatedRow` ni hooks.

