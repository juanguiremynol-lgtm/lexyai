

## Plan: Consolidado de alertas por portal en `/app/alerts`

### Objetivo
Cada fila de la pestaña Alertas debe mostrar: badge de **portal** (PP / CPNU / SAMAI / SAMAI_ESTADOS), demandante vs demandado, despacho, tipo de actuación/estado y fecha del auto.

### Estado actual (hallazgos)
- `alert_instances.alert_source` existe pero está **vacío en 100% de los registros** generados por triggers de actuaciones/estados (solo se rellena en alertas operativas: watchdog, sync auth, hearings).
- Triggers responsables (en `notify_new_actuacion`, `notify_new_estado`, `handle_publicacion_notifiability`): NO escriben `alert_source` y guardan un `payload` mínimo (sin despacho ni partes).
- `work_items` ya tiene: `demandantes`, `demandados`, `authority_name`. `work_item_acts` tiene `source`, `act_type`, `act_date`. `work_item_publicaciones` tiene `source`, `tipo_publicacion`, `fecha_fijacion`.
- Valores actuales de `source`: `cpnu`, `CPNU`, `samai`, `SAMAI_ESTADOS`, `publicaciones`, `samai_estados`, `icarus_import`, `manual`.

### Cambio 1 — Migración SQL: normalización de portal + enriquecimiento de payload

Crear una migración con cuatro piezas:

**1.1 Helper `normalize_alert_source(raw text)`** → devuelve canónico:
```
'cpnu'|'CPNU' → 'CPNU'
'samai' → 'SAMAI'
'samai_estados'|'SAMAI_ESTADOS' → 'SAMAI_ESTADOS'
'publicaciones' → 'PP'
'icarus_import' → 'ICARUS'
'manual' → 'MANUAL'
NULL/otro → 'UNKNOWN'
```

**1.2 Reemplazar `notify_new_actuacion()`** (en migración nueva, manteniendo el patrón TRIGGER_SAFE actual):
- Cargar `radicado, owner_id, organization_id, demandantes, demandados, authority_name` desde `work_items`.
- Computar `v_portal := normalize_alert_source(NEW.source)`.
- Insertar directo en `alert_instances` (no vía `insert_notification`) con:
  - `alert_source = v_portal`
  - `alert_type = 'ACTUACION_NUEVA'`
  - `payload = jsonb_build_object('radicado', v_radicado, 'portal', v_portal, 'despacho', authority_name, 'demandante', demandantes, 'demandado', demandados, 'tipo_actuacion', NEW.act_type, 'fecha_auto', NEW.act_date, 'fingerprint', NEW.hash_fingerprint, 'source', NEW.source)`
  - `fingerprint = build_dedupe_key('actuacion_new', NEW.work_item_id::text, hour_bucket)` (idéntico al actual).
- Mantener la llamada a `insert_notification` para el sistema de notificaciones legacy (no romper emails).

**1.3 Reemplazar `handle_publicacion_notifiability()` y `notify_new_estado()`**: mismo patrón. `tipo_actuacion` ← `NEW.tipo_publicacion`, `fecha_auto` ← `NEW.fecha_fijacion`, `portal` ← `normalize_alert_source(NEW.source)`.

**1.4 Backfill de filas existentes** (idempotente, single statement):
```sql
UPDATE alert_instances ai SET
  alert_source = normalize_alert_source(COALESCE(wia.source, wip.source)),
  payload = COALESCE(ai.payload,'{}'::jsonb) || jsonb_build_object(
    'portal', normalize_alert_source(COALESCE(wia.source, wip.source)),
    'despacho', wi.authority_name,
    'demandante', wi.demandantes,
    'demandado', wi.demandados,
    'tipo_actuacion', COALESCE(wia.act_type, wip.tipo_publicacion),
    'fecha_auto', COALESCE(wia.act_date::text, wip.fecha_fijacion::text)
  )
FROM work_items wi
LEFT JOIN work_item_acts wia ON wia.id = (ai.payload->>'act_id')::uuid
LEFT JOIN work_item_publicaciones wip ON wip.id = (ai.payload->>'pub_id')::uuid
WHERE ai.entity_id = wi.id
  AND ai.alert_type IN ('ACTUACION_NUEVA','ACTUACION_MODIFIED','PUBLICACION_NEW','PUBLICACION_MODIFIED','ESTADO_NUEVO')
  AND (ai.alert_source IS NULL OR ai.alert_source = '');
```
Filas sin act/pub identificable se quedan con `alert_source = 'UNKNOWN'`.

### Cambio 2 — `src/lib/alerts/portal-badge.ts` (nuevo)

Helper compartido:
```ts
export type PortalKey = 'CPNU' | 'PP' | 'SAMAI' | 'SAMAI_ESTADOS' | 'ICARUS' | 'MANUAL' | 'UNKNOWN';

export const PORTAL_LABEL: Record<PortalKey, string> = {
  CPNU: 'CPNU', PP: 'PP', SAMAI: 'SAMAI', SAMAI_ESTADOS: 'SAMAI Estados',
  ICARUS: 'Importado', MANUAL: 'Manual', UNKNOWN: 'Origen N/D',
};

export const PORTAL_BADGE_CLASS: Record<PortalKey, string> = {
  CPNU:          'bg-blue-500/15 text-blue-700 border-blue-300',
  PP:            'bg-purple-500/15 text-purple-700 border-purple-300',
  SAMAI:         'bg-emerald-500/15 text-emerald-700 border-emerald-300',
  SAMAI_ESTADOS: 'bg-teal-500/15 text-teal-700 border-teal-300',
  ICARUS:        'bg-amber-500/15 text-amber-700 border-amber-300',
  MANUAL:        'bg-slate-500/15 text-slate-700 border-slate-300',
  UNKNOWN:       'bg-muted text-muted-foreground border-border',
};

export function normalizePortal(raw?: string | null): PortalKey { /* uppercase + match */ }
```

### Cambio 3 — `src/components/alerts/AlertConsolidatedRow.tsx` (nuevo)

Tarjeta compacta usada en `Alerts.tsx` para alertas de tipo `ACTUACION_*` / `PUBLICACION_*` / `ESTADO_NUEVO`. Layout:

```
┌─────────────────────────────────────────────────────────┐
│ [Portal CPNU] [severity] [tipo_actuacion]  fecha_auto │  ← header
│ Radicado: 1100131030012023…                            │
│ 🏛 Juzgado 12 Civil del Circuito de Bogotá             │
│ 👥 Juan Pérez vs Banco XYZ                              │
│ "Auto admite demanda…"  (message truncado 2 líneas)    │
│ [Marcar leído] [Resolver] [Snooze]   detected 2h ago   │
└─────────────────────────────────────────────────────────┘
```

Lee `payload.portal`, `payload.despacho`, `payload.demandante`, `payload.demandado`, `payload.tipo_actuacion`, `payload.fecha_auto`. Fallback a `alert.alert_source` para portal y a "—" para campos vacíos.

### Cambio 4 — `src/pages/Alerts.tsx`

1. Extender la interfaz `AlertInstance` con `alert_source?: string` y enriquecer el `select` de la query (`*` ya lo trae).
2. **Nueva tab "Por portal"** dentro del `<Tabs>` existente (junto a las actuales). Render:
   - Sub-grupos colapsables por portal: CPNU / PP / SAMAI / SAMAI_ESTADOS / Otros (UNKNOWN+ICARUS+MANUAL).
   - Cada grupo muestra contador y se ordena por `fired_at` desc.
   - Items renderizados con `<AlertConsolidatedRow>`.
3. En la vista "Todas" actual, reemplazar la fila de actuaciones/estados por `<AlertConsolidatedRow>` (mantiene bulk-selection). Otros tipos (TAREA_VENCIDA, HEARING_*, TERMINO_*, WATCHDOG_*) siguen con su render actual.
4. KPI superior: añadir 4 mini-chips de conteo por portal (CPNU N · PP N · SAMAI N · SAMAI_ESTADOS N) calculados client-side.

### Cambio 5 — `AlertsTasksTab.tsx` (work item detail)

Sustituir el badge `alert.alert_source` raw por `<Badge className={PORTAL_BADGE_CLASS[normalizePortal(alert.alert_source)]}>{PORTAL_LABEL[…]}</Badge>` para consistencia visual cross-página.

### Detalles técnicos

- **No se toca `insert_notification()`** — sigue alimentando emails por `notifications`. Las alertas en `alert_instances` ahora llevan datos canónicos.
- **Idempotencia preservada**: `fingerprint` no cambia, así que reejecuciones del trigger no duplican.
- **Nuevos campos en payload son aditivos** — alertas viejas backfilleadas; alertas nuevas ya nacen completas.
- **RLS**: no cambia. `alert_instances` filtra por `owner_id` igual que hoy.
- **Sin migración de schema** — `alert_source` y `payload jsonb` ya existen.

### Fuera de alcance
- No se cambia el sistema de emails ni `dispatch-update-emails-5min`.
- No se agregan filtros server-side por portal (el dataset es chico, filtro client-side basta; si crece, se evaluará índice GIN sobre `alert_source`).
- No se tocan alertas operativas (watchdog/auth/hearings) — su `alert_source` ya está poblado con su propio convenio.
- No se modifica `TerminoCard` ni `EstadosHoy.tsx`.

