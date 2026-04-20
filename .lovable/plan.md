

## Plan: Mostrar todas las novedades sin agrupar en EstadosHoy.tsx

### Cambio en `src/pages/EstadosHoy.tsx` (queryFn)

1. **Eliminar el filtro de fuentes**: quitar el `Set` `allowed` y la línea `novedades = raw.filter(n => allowed.has(...))`. Aceptar todas las fuentes que devuelva la API.

2. **Eliminar cualquier deduplicación por radicado**: cada novedad es una fila independiente, incluso si comparte radicado con otras.

3. **Ordenar por `creado_en` DESC**:
   ```ts
   raw.sort((a, b) => (b.creado_en || "").localeCompare(a.creado_en || ""));
   ```

4. **Mantener** el buscador de texto existente (`debouncedSearch`) sobre el array completo.

5. **Remover los `console.log` temporales** del paso de diagnóstico anterior.

### Cambio en el render (tabla/lista de filas)

Asegurar que cada fila muestre exactamente cuatro columnas, sin agrupar por radicado:

| Radicado | Fuente (badge) | Descripción | Fecha |

- **Radicado**: `n.radicado` (texto plano, monoespaciado).
- **Fuente**: badge con `n.fuente` tal cual lo devuelve la API (ya hay soporte de badges para `PP`; las demás fuentes usan estilo neutro por defecto).
- **Descripción**: `n.descripcion` (truncar con `line-clamp-2` si es muy larga).
- **Fecha**: `n.creado_en` formateado a fecha+hora COT corto.

Si el render actual usa `mapNovedadToEstado` para convertir a un tipo intermedio que agrupa o reordena, **se reemplaza por un render directo** sobre el array de `NovedadItem` para evitar pérdida de filas duplicadas por radicado.

`key` de cada fila: `${n.radicado}-${n.creado_en}-${idx}` para garantizar unicidad incluso con duplicados.

### Contadores

El contador del header pasa a mostrar el total de novedades crudas (no procesos únicos): `novedades.length`.

### Fuera de alcance
- No se toca `andromeda-novedades.ts` (la ventana de 30 días sigue resuelta por `getAndromedaFallbackRange`).
- No se modifica el segundo query (`sync-health-estados`).
- No se cambia `ActuacionesHoy.tsx`.
- No se ajustan estilos globales de badges; se reutilizan los existentes.

