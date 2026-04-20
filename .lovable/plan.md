

## Plan: Reconectar EstadosHoy.tsx a la API Andromeda (30 días fijo)

Con CORS corregido, vuelvo a conectar `EstadosHoy.tsx` a la API externa Andromeda directamente desde el navegador.

### Cambios en `src/pages/EstadosHoy.tsx`

1. **Fetch directo a Andromeda** vía `getAndromedaFallbackRange()` (ventana fija de 30 días hasta hoy COT).
2. **Filtrar fuentes** en cliente: solo `PP` y `SAMAI_ESTADOS` (case-insensitive).
3. **Ordenar** por `creado_en DESC`.
4. **Buscador de texto** sobre `radicado`, `descripcion`, `fuente`, `workflow_type` (mantener el debounce existente).
5. **Eliminar**:
   - Selector Hoy / 3 Días / Semana y estado `window`.
   - Banner amarillo de fallback y cualquier `Alert` relacionado.
   - Icono `Calendar` y referencias a `HoyWindow`.
6. **Mantener**: header, contadores, tabla/lista de estados, mapeo `mapNovedadToEstado` y badges de fuente (`PP` ya soportado).

### Resultado
La página `/app/estados-hoy` muestra siempre los últimos 30 días de novedades PP + SAMAI_ESTADOS ordenadas por fecha de creación descendente, con buscador de texto como único filtro.

### Fuera de alcance
- `ActuacionesHoy.tsx` no se toca.
- `andromeda-novedades.ts` no se toca.
- No se agrega Edge Function proxy (CORS ya resuelto).

