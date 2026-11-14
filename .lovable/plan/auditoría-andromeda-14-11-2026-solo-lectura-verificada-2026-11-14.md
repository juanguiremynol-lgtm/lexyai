# Auditoría Andromeda, 14/11/2026 (solo lectura, verificada)

## 1. REDIRGE
Busqué `redirge|redirg|redirige` sin distinguir mayúsculas en todo el repositorio, incluidos los archivos ocultos y sin node_modules. No hay ninguna coincidencia. No supongo que exista un equivalente.

## 2. Mapa
- Parte visible: React/Vite en `src/`. La lógica MCP fuente está en `src/lib/mcp/` (`index.ts` y 52 archivos en `tools/`).
- Paquete MCP generado: `supabase/functions/mcp/index.ts`. Lo genera `scripts/build-mcp.mjs` y no se edita a mano. Solo se despliega cuando se publica la app.
- Adaptadores: `adapter-cpnu`, `cpnu-sync`, `cpnu-job-poller`, `sync-by-work-item` (CPNU y SAMAI), `sync-publicaciones-by-work-item` y `sync-pp-by-work-item` (PP), `scheduled-samai-estados-monitor` y `scheduled-publicaciones-monitor`.
- La API de PP en Cloud Run (`publicaciones-procesales-api-…run.app`) solo aparece en los registros como algo externo.
- En el repositorio no hay manifiestos de Cloud Run ni de Scheduler. Esa infraestructura no fue observada.
- Hay AGENTS.md solo en la raíz y en `src/lib/` (los dos leídos). También en `supabase/functions/_shared/`, que llegó como contexto.

## 3. 83 frente a 81 asuntos (causa confirmada)
- Base de datos del titular c64c2ca1: 68 ACTIVE vigilados + 13 ACTIVE sin vigilar + 2 ARCHIVED con `deleted_at` nulo = 83. Hay además 36 DELETED. Total: 119.
- `src/lib/mcp/tools/get-user-context.ts:18` filtra solo `deleted_at is null` (con tope de 1000) y la línea 31 llama "activos" a todos. Así cuenta los 2 archivados como activos.
- `list-work-items.ts:23` aplica el mismo filtro, con lo que mezcla archivados. Además no tiene cursor ni offset (máximo 100) ni filtro de ciclo de vida.
- No existe ninguna prueba para estas dos herramientas.

## 4. Fallos de sincronización
- **b2f9f64e, CPNU PERSISTENCE_FAILED (12:05):** según `sync_persist_buckets`, ERROR "canceling statement due to statement timeout" (57014) sobre `wi_b2f9f64e_742092e2534c5178`. Se abortó a propósito (`sync-by-work-item/index.ts:3228`). A las 18:01 el intento quedó deduplicado por el tope diario (DAILY_UPDATE_ALREADY_STARTED). La causa es un statement timeout al enriquecer el act; falta identificar cuál consulta.
- **SAMAI 154b4c7d / 6153c00f / 8dedc53e, PERSISTENCE_FAILED (12:01–12:03):** no hay ninguna fila de bucket ACTS de samai en esa ventana. El código venía de `:3709` (ledger incompleto) o `:4674` (57014 antes de escribir el bucket). Causa sin confirmar. Antes, 8dedc53e tuvo SAMAI_SOURCE_OBSERVATION_STALE. A las 12:20 samai_estados terminó en success en los tres.
- **7b038fac, POST_INGEST_EFFECTS_PENDING (17:00, cpnu):** la fuente estaba completa pero un efecto posterior quedó pendiente (`:4401`, `:943`). Hay pruebas en `hearingReviewOutcome_test.ts` y `workerRegression_test.ts`.
- **PP_STORED_READ_INCOMPLETE** (`sync-publicaciones-by-work-item/index.ts:2081`) y **PP_NATIVE_DATE_CONFLICT** (`:2964`): son estados fail-closed a propósito. Hay pruebas en `syncTimelineVerdict_test.ts` y `ppRoleDateHandler_test.ts`.
- No modifiqué ninguna evidencia.

## 5. Brechas MCP
- Sin paginación: `list_work_items`, y `get_user_context` está topada en 1000 filas.
- Las escrituras de clientes y las demás RPC nuevas siguen detrás del gate `supabase/release/mcp_write_rpcs_enable.sql`. El fix de clientes 20261113 no está aplicado.
- La lista completa de funciones de la interfaz sin herramienta MCP requiere cruzar `src/pages` con `tools/`. Es el paso 3 de abajo.

## Correcciones propuestas (no ejecutadas)
1. `get_user_context`: contar por `lifecycle_state` con `{active, archived, by_workflow_type}`, sin tope de 1000. Prueba: titular con 81 activos y 2 archivados, el resultado debe ser 81 activos y 2 archivados.
2. `list_work_items`: añadir `lifecycle_state` (por defecto ACTIVE) y un cursor keyset `updated_at,id`. Debe devolver `lifecycle_state`.
3. Inventario de la interfaz frente a MCP, solo lectura.
4. SAMAI: leer los registros de `sync-by-work-item` de 12:01–12:04 buscando `persistence_summary` y 57014, para confirmar la causa antes de tocar código.
5. CPNU 57014: con `supabase--slow_queries`, identificar la consulta del enriquecimiento. Optimizar índice o consulta sin cambiar instancia (Tiny).
6. Después regenerar el paquete MCP, publicar y subir la revisión del marcador.

## Comandos de prueba
- `bunx vitest run src/lib/mcp/__tests__`
- `bun run check:mcp:source && bun run check:mcp:artifact`
- `deno test supabase/functions/_shared/syncTimelineVerdict_test.ts supabase/functions/_shared/ppRoleDateHandler_test.ts supabase/functions/_shared/hearingReviewOutcome_test.ts supabase/functions/_shared/actBatchState_test.ts`
