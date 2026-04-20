

## Plan: Mostrar campos adicionales de la API en EstadosHoy.tsx

### Contexto
La API `andromeda-read-api/novedades` ahora devuelve cuatro campos extra por novedad: `despacho`, `demandante`, `demandado`, `clase_proceso`. Hoy `NovedadItem` no los tipa, así que aunque vengan en el payload, TypeScript no los expone y el render los ignora.

### Cambio 1 — `src/lib/services/andromeda-novedades.ts`

Extender la interfaz `NovedadItem` con los cuatro campos opcionales:

```ts
export interface NovedadItem {
  fuente: string;
  radicado: string;
  workflow_type: string;
  fecha: string;
  descripcion: string;
  despacho?: string | null;
  demandante?: string | null;
  demandado?: string | null;
  clase_proceso?: string | null;
  gcs_url_auto?: string | null;
  gcs_url_tabla?: string | null;
  creado_en: string;
}
```

No se toca la lógica de fetch/filtros/fallback.

### Cambio 2 — `src/pages/EstadosHoy.tsx` (componente `NovedadRow`)

Reorganizar la fila para usar los nuevos campos:

1. **Bloque Radicado** (columna izquierda):
   - Línea 1: `radicado` (mono) + badge `workflow_type` (igual que hoy).
   - Línea 2 (nueva): `despacho` en `text-xs text-muted-foreground` con truncado a una línea. Si `despacho` está vacío, no se renderiza.
   - Línea 3 (si existe `clase_proceso`): badge pequeño outline con `clase_proceso`.

2. **Bloque Descripción** (columna central):
   - Línea 1 (nueva, solo si hay `demandante` o `demandado`): renderizar `Demandante vs Demandado` con formato:
     - `<span className="font-medium">{demandante || "—"}</span>` + separador ` vs ` (gris) + `<span className="font-medium">{demandado || "—"}</span>`.
     - Truncado a una línea con `truncate`.
   - Línea 2: `descripcion` con `line-clamp-2` (igual que hoy).
   - Si no hay ni demandante ni demandado, se omite la línea de partes y solo queda la descripción.

3. **Resto de la fila** (fecha, badge fuente, botón "Ver Auto", borde verde "En ejecutoria") permanece sin cambios.

### Cambio 3 — Export a Excel (`handleExport`)

Añadir las cuatro columnas nuevas al export para mantener paridad con la UI:

| Radicado | Despacho | Clase de Proceso | Demandante | Demandado | Fuente | Workflow | Descripción | Fecha | Detectado |

Insertar `Despacho`, `Clase de Proceso`, `Demandante`, `Demandado` después de `Radicado`.

### Fuera de alcance
- No se cambia el filtro de fuentes (`PP` + `SAMAI_ESTADOS`).
- No se cambia el orden por `creado_en` DESC.
- No se modifica `ActuacionesHoy.tsx` ni `andromeda-read-api`.
- No se añaden filtros nuevos por despacho o clase de proceso (puede ser una mejora posterior).

