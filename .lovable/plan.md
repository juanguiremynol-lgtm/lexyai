

## Plan: Centralizar URLs + Soporte completo PP (Publicaciones Procesales)

### Resumen
Centralizar las URLs de APIs externas en un solo archivo, luego agregar soporte PP para **todos** los work items: nuevo tab "Publicaciones Procesales", panel de novedades PP, y registro automático en pp-read-api al crear radicados.

---

### 1. Nuevo archivo: `src/lib/api-urls.ts`
```typescript
export const CPNU_API_BASE = "https://cpnu-read-api-486431576619.us-central1.run.app";
export const PP_API_BASE = "https://pp-read-api-486431576619.us-central1.run.app";
```

### 2. Actualizar imports en 3 archivos existentes
- `src/hooks/use-cpnu-actuaciones.ts` — eliminar constante local, importar `CPNU_API_BASE` desde `@/lib/api-urls`
- `src/hooks/use-cpnu-novedades.ts` — igual
- `src/lib/cpnu/register-and-sync.ts` — igual

### 3. Nuevo hook: `src/hooks/use-pp-actuaciones.ts`
- Igual que `use-cpnu-actuaciones.ts` pero usando `PP_API_BASE`
- Query key: `["pp-actuaciones", workItemId]`
- Mapea campos del API al tipo `WorkItemAct` (misma interfaz)
- Campos adicionales: `gcs_url_auto` y `gcs_url_tabla` se guardan en `raw_data`
- Enabled para **todos** los work items con radicado
- Función `resyncPpActuaciones` exportada

### 4. Nuevo hook: `src/hooks/use-pp-novedades.ts`
- Copia del patrón de `use-cpnu-novedades.ts` pero usando `PP_API_BASE`
- Query key: `["pp-novedades", workItemId]`
- Misma interfaz `Novedad`, misma mutación `markAsReviewed`

### 5. Nuevo componente: `src/components/work-items/NovedadesPpPanel.tsx`
- Copia de `NovedadesCpnuPanel.tsx` pero usando `usePpNovedades`
- Título: "Novedades PP"

### 6. Nuevo tab: `src/pages/WorkItemDetail/tabs/PublicacionesPpTab.tsx`
- Usa `usePpActuaciones(workItem.id)`
- Muestra lista de actuaciones con cards similares a `ActsTab`
- Cada actuación tiene botones condicionales:
  - "Ver Auto" → abre `raw_data.gcs_url_auto` en nueva pestaña (si existe)
  - "Ver Tabla" → abre `raw_data.gcs_url_tabla` en nueva pestaña (si existe)
- Botón Re-sync que llama a `resyncPpActuaciones`

### 7. Modificar `src/pages/WorkItemDetail/index.tsx`
- Agregar tab "Publicaciones" en el `TabsList` (expandir grid de 6 a 7 columnas)
- Importar y renderizar `<PublicacionesPpTab>` en su `TabsContent`
- Agregar `<NovedadesPpPanel>` en columna derecha para **todos** los work items con radicado (debajo del panel de novedades CPNU)

### 8. Modificar registro de radicados
- **`src/lib/cpnu/register-and-sync.ts`** → agregar función `registerAndSyncPp` que llama a `POST ${PP_API_BASE}/work-items` y `POST ${PP_API_BASE}/work-items/:id/sync`
- **`src/hooks/use-create-work-item.ts`** → después del bloque CGP, llamar `registerAndSyncPp` fire-and-forget para **todos** los work items con radicado de 23 dígitos
- **`src/components/work-items/AddRadicadoInline.tsx`** → igual, llamar `registerAndSyncPp` para todos los workflow types

### 9. CSP en `index.html`
- Verificar que `connect-src` incluya `pp-read-api-486431576619.us-central1.run.app` (probablemente necesite agregarse)

---

### Detalle técnico: campos PDF en actuaciones PP

El mapper de `use-pp-actuaciones.ts` guardará `gcs_url_auto` y `gcs_url_tabla` en `raw_data` del `WorkItemAct`, y `PublicacionesPpTab` los leerá de ahí para renderizar los botones de PDF.

