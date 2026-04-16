

## Plan: Migrar Estados de Hoy y Actuaciones de Hoy a Andromeda Read API

### Resumen
Reemplazar las queries directas a Supabase en ambas páginas por llamadas a `GET /novedades` del Andromeda Read API. Las fechas se calculan hacia atrás desde **ayer** (el cron corre a las 2am COT).

### Cambios

#### 1. `src/lib/api-urls.ts`
Agregar:
```typescript
export const ANDROMEDA_API_BASE = "https://andromeda-read-api-486431576619.us-central1.run.app";
```

#### 2. Crear `src/lib/services/andromeda-novedades.ts`
Servicio compartido que:
- Llama a `GET ${ANDROMEDA_API_BASE}/novedades?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`
- Calcula fechas: "Hoy" = ayer→ayer, "3 Días" = hace 3 días→ayer, "Semana" = hace 7 días→ayer (todo relativo a **ayer** en COT)
- Filtra por `fuente` en el cliente (PP+SAMAI_ESTADOS para Estados, CPNU+SAMAI para Actuaciones)
- Tipado del response: `{ ok, total, novedades: NovedadItem[] }`

#### 3. `src/pages/EstadosHoy.tsx`
- Eliminar la función `fetchEstadosHoy` (queries a `work_item_publicaciones`, `work_item_acts`, `act_provenance`)
- Eliminar constantes `PUB_SELECT`, `SAMAI_ESTADOS_SELECT`, `mapPubRow`, `mapSamaiEstadoRow`
- Reemplazar `queryFn` por llamada al servicio andromeda filtrando fuentes `PP` y `SAMAI_ESTADOS`
- Mapear `NovedadItem` → `EstadoHoyItemWithMeta` para mantener la UI existente (cards, badges, export)
- Los modos "detected"/"court_date" se simplifican: solo se usa el rango de fechas del API

#### 4. `src/pages/ActuacionesHoy.tsx`
- Reemplazar `getActuacionesHoy` por llamada al servicio andromeda filtrando fuentes `CPNU` y `SAMAI`
- Mapear `NovedadItem` → `ActuacionHoyItem` para mantener la UI (grouped cards)
- Conservar `groupByWorkItem` del servicio existente para agrupar en UI

#### 5. `src/lib/services/actuaciones-hoy-service.ts`
- Conservar tipos e interfaces exportados (`ActuacionHoyItem`, `GroupedActuaciones`, `groupByWorkItem`)
- Eliminar o deprecar `getActuacionesHoy` (la lógica se mueve al nuevo servicio)

### Formato de respuesta del API
```json
{
  "ok": true,
  "total": 5,
  "novedades": [
    {
      "fuente": "CPNU",
      "radicado": "05001233300020240115300",
      "workflow_type": "CPACA",
      "fecha": "2026-04-15",
      "descripcion": "Auto que ordena...",
      "gcs_url_auto": "https://...",
      "gcs_url_tabla": "https://...",
      "creado_en": "2026-04-16T07:00:00Z"
    }
  ]
}
```

### Cálculo de fechas
- **Hoy**: desde=ayer, hasta=ayer
- **3 Días**: desde=anteayer-2, hasta=ayer  
- **Semana**: desde=ayer-6, hasta=ayer

"Ayer" = fecha Colombia (COT, UTC-5) menos 1 día.

### Detalle técnico
- Se elimina toda dependencia de `work_item_publicaciones`, `work_item_acts` y `act_provenance` en estas dos páginas
- La búsqueda client-side se mantiene (filtro sobre los resultados del API)
- El sync health check de `atenia_ai_reports` en EstadosHoy se conserva (es independiente)
- El sidebar badge count (`use-hoy-counts.ts`) no se modifica en este cambio

