# Refactor: radicado como identificador estable + Sync Status desde andromeda-read-api

Objetivo: dejar de depender del UUID local de Supabase para abrir el detalle de un proceso y leer el estado de sincronización directamente del nuevo endpoint `GET /radicados/:radicado` que ya devuelve `work_item_id` real, contadores y `sync.{cpnu,pp,samai,samai_estados}`.

## Alcance acotado (lo que sí hago)

1. **Ruta nueva** `/app/radicados/:radicado` que renderiza el mismo `WorkItemDetailPage`.
   - La ruta vieja `/app/work-items/:id` se mantiene **como redirect** hacia la nueva: el componente resuelve el `radicado` desde Supabase usando el UUID y hace `<Navigate to="/app/radicados/:radicado" replace />`. Así NO tenemos que tocar las ~30 llamadas a `navigate("/app/work-items/...")` desperdigadas por la app — siguen funcionando vía redirect.
   - Solo cambio explícitamente la lista principal `src/pages/Processes.tsx` para que sus links nuevos apunten ya a `/app/radicados/:radicado`.

2. **`useWorkItemDetail(radicado)`** se reescribe para:
   - Recibir `radicado` (string) en vez de UUID.
   - Llamar `GET ${ANDROMEDA_API_BASE}/radicados/:radicado` (fuente de verdad para `work_item_id`, `sync.*`, `total_actuaciones`, `last_sync_at`, `ultima_actuacion`, `novedades_pendientes`, banderas `en_cpnu/en_pp/en_samai/en_samai_estados`).
   - Cargar la fila local de Supabase con `work_items.radicado = :radicado` (join key = radicado, no UUID) para los campos que viven solo en frontend: `client_id`, `clients(name)`, `matters`, `notes`, `authority_city`, `authority_department`, `is_flagged`, `monitoring_enabled`, `cgp_phase`, `stage`, `status`, `title`, `description`, `tutela_code`, etc.
   - El objeto resultante mergea ambos: campos de Supabase + un nuevo `sync` proveniente de la API. El `id` expuesto al resto de la UI es el `work_item_id` del API (8c7866...) si existe, si no el UUID local.
   - Documents/tasks/hearings/process_events siguen consultándose contra Supabase usando el `work_item_id` resuelto.

3. **Panel "Estado de Sincronización"** (`SyncStatusBadge` y/o nuevo `SyncStatusPanel`):
   - Acepta el objeto `sync` (cpnu, pp, samai, samai_estados) directamente del hook.
   - Renderiza un sub-bloque por fuente con `status`, `total_actuaciones`, `ultima_actuacion`, `novedades_pendientes`, y `last_sync_at` formateado con `formatDistanceToNow`.
   - Ya **no** consulta `external_sync_runs` de Supabase — ese atajo queda eliminado.

4. **Header del detalle** (`WorkItemDetail/index.tsx`):
   - "Última sync" usa `sync.cpnu.last_sync_at` (o el más reciente de las 4 fuentes), no `workItem.last_synced_at` de Supabase.
   - Conserva el resto del layout actual.

5. **Sin cambios en la lista** (`useWorkItemsList`): sigue leyendo de Supabase para cliente/ciudad/demandantes/etc. Solo se cambia el `to=` del Link en `Processes.tsx`.

## Fuera de alcance (intencional)

- No reescribo las ~30 navegaciones desde Alerts/Kanban/Tasks/Documents/Hearings/etc. Esas seguirán pasando UUID y el redirect del paso 1 las resuelve. Se pueden migrar gradualmente después.
- No toco `/radicados/:radicado/actuaciones` (ya funciona).
- No toco `/estados` ni hooks de novedades.
- No borro `external_sync_runs` ni `last_synced_at` de Supabase — solo dejan de consumirse para este panel.

## Archivos a editar

- `src/App.tsx` — agregar `<Route path="radicados/:radicado">`.
- `src/pages/WorkItemDetail/index.tsx` — aceptar `:radicado` o `:id`; si entra UUID, hace redirect; mostrar `sync.cpnu.last_sync_at`.
- `src/hooks/use-work-item-detail.ts` — reescribir para entrar por radicado, hacer fetch al API y mergear con Supabase por radicado.
- `src/components/work-items/SyncStatusBadge.tsx` — nueva prop opcional `sync` y sub-paneles por fuente; deprecar consulta a `external_sync_runs`.
- `src/pages/Processes.tsx` — cambiar `to={`/app/work-items/${item.id}`}` por `to={`/app/radicados/${item.radicado}`}` cuando hay radicado (fallback al UUID si no).
- `src/hooks/useAndromedaRadicado.ts` — extender el tipo de respuesta para exponer `sync` y `work_item_id`.

## Verificación

Abrir `/app/radicados/05001400301520240193000` y confirmar:
- Network: `GET /radicados/05001400301520240193000` → 200 con `sync.cpnu`.
- Network: `GET /radicados/05001400301520240193000/actuaciones` → 200 con 42 filas.
- Header: "Última sync: hace ~X minutos/horas" basado en `2026-05-11T00:05:56Z`.
- Panel sync CPNU: status `ERROR`, total 42, última actuación 2026-05-04, novedades pendientes 3.
- `work_item_id` interno en el cuerpo es `8c7866c2-...` (visible en debug).
- Abrir `/app/work-items/91edd371-...` redirige automáticamente a `/app/radicados/05001400301520240193000`.

¿Apruebas?
