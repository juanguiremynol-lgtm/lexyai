# Seguimiento vigilancia — 28/10/2026 19:15 UTC

## Causas demostradas
- PROVIDER_BREAKER_LEASE_LOST: fallo local. Con el freno CLOSED, permisos concurrentes comparten generación; dos 403 de sesión SAMAI reales abren el freno (generación+1) y los demás trabajadores pierden el sellado. El adaptador descartaba la respuesta real de la fuente. Corregido en samaiEstadosBreaker.ts (respuesta conservada, breakerSeal=LOST).
- Freno SAMAI Estados OPEN 18:57 (consecutive_transient=2): respuesta real de fuente (403 al iniciar sesión WEstados), no caída.
- PENDING_UPSTREAM PP: GET /historico responde 200 con run_status=LECTURA_PARCIAL (estados_analizados=200) y POST /procesar-radicado no responde en 60 s: 34/34 hoy, 1 respuesta 200 (25 s) en 10 días. Requiere cambio en Cloud Run.

## Parche requerido en Cloud Run (publicaciones-procesales-api)
- /procesar-radicado: responder 202 inmediato con {backend_run_id, trazabilidad_id} y exponer GET /runs/{backend_run_id}.
- /historico: incluir el motivo de LECTURA_PARCIAL (p. ej. tope de 200 estados) y consulta_completa explícita.

## Cola
- RETRY_ACTS DEAD_LETTER "non-2xx" 5 días: 225 filas / 66 asuntos, todos con CALLER_UNAUTHORIZED en la misma ventana, todos ACTIVE+vigilados.
  - 18 excluidos: consulta válida posterior.
  - 41 excluidos: RETRY_ACTS PENDING equivalente activo.
  - 6 excluidos: ACT_SCRAPE_RETRY activo (primera consulta, attempt 0).
  - 1 recuperado: 2a590db7-0330-4b8d-9403-5963e4bd15a1 → tarea eb48679d-f92b-4a76-83dc-d434aa6110c3 (recovered_from e9ddca98-9088-42d8-afc0-e3096fabc73b).
- Reparto justo: ACT y PUB alternan; antes los PUB envejecidos desde 26/10 ocupaban las 5 plazas por hora.

## Cierre 19:30 UTC

### Lote secuencial real (sync-by-work-item, x-cron-key, invoker manual-sequential-batch-20261028)
| work_item_id | Resultado | Insertadas/existentes | source_complete |
|---|---|---|---|
| daeab0a7-5ea9-443c-bcfd-4ee898155b90 | success (antes PERSISTENCE_FAILED) | 0/8 | true; last_synced_at 19:23:40 |
| f046908c-904e-40c4-9ef0-940d291a50e1 (Esfinge, primera consulta) | success | 3/20 | true |
| 853993b2-74ec-41fa-8fcc-7cf500d1ffe0 (nunca exitosa) | success | 0/1 | true |
| 1325d2c2-a58d-4c7e-991c-3f0b4271ac65 (nunca exitosa) | success | 0/4 | true |
| 5840084b-6d52-47f4-b138-87006ae87f6f (Martha) | success CPNU hoy | 0/3 | true |

Causa PERSISTENCE_FAILED: filas CPNU con huella nueva chocaban con `idx_acts_dedupe_structural` contra actuaciones guardadas con huella corta antigua. Ahora, ante ese choque, se busca la fila guardada con la misma fecha y título canónico (funciones de la base `canon_strip_title_noise`/`canon_normalize_title`); si hay exactamente una, se cuenta como duplicado y se relee por su huella. Huellas no se re-escriben. Fallos de guardado registran `persistence_summary` saneado.

### Cobertura de pares asunto-fuente elegibles (ACTIVE + vigilados + inscripción habilitada)
| Fuente | Pares | Nunca exitosa | Exitosa hoy (Bogotá) |
|---|---|---|---|
| cpnu ACTS | 53 | 0 (2 corregidos en este lote) | 12+ |
| samai ACTS | 15 | 0 | 8 |
| publicaciones PUBS | 53 | 18 | 3 |
| samai_estados PUBS | 15 | 4 | 0 |
Limitación: las filas de estados registran `provider=unknown`; PP y SAMAI Estados no se distinguen en el historial.

### Nicholls (db1b4198-b0ac-453d-98b5-44525f58bf23)
Estado N°39 del 22/10 ya está guardado (2 filas, actuación 21/10, fijación 22/10). El bloqueo para frescura de hoy: /historico devuelve LECTURA_PARCIAL, `estados_analizados=0`, `ultima_sync` 27/10 15:36.

### INCIDENT_AUTO_REMEDIATION (67 PENDING)
Producidas por src/lib/services/atenia-incident-policy.ts sin work_item_id; ningún consumidor las ejecuta (no están en la lista soportada del supervisor). No se ejecutaron ni modificaron.

### Servicio intermediario (Cloud Run)
- Destino efectivo: https://publicaciones-procesales-api-11974381924.us-central1.run.app (revisión declarada 00082-xez, fuente 96b6cbb según contrato 26/10; no verificable desde aquí). Repo no accesible desde Lovable.
- Contrato actual observado: POST /procesar-radicado síncrono, 34/34 abortos a 60 s hoy; GET /historico/{radicado} 200 con `run_status` (LECTURA_PARCIAL/SUCCESS_EMPTY), `busqueda.{fuente,procesado,ultima_sync,estados_analizados}`, sin motivo de parcialidad ni ids de corrida.
- Contrato requerido:
  1. Admisión durable e idempotente (clave radicado+día Bogotá) ANTES de responder 202 `{backend_run_id, trazabilidad_id, estado:"ADMITIDA"}`; repetir devuelve la misma corrida.
  2. Trabajador durable con reintentos propios; GET /runs/{backend_run_id} → `{estado: ADMITIDA|EN_CURSO|COMPLETA|PARCIAL|FALLIDA, motivo_parcial, checkpoint, estados_analizados, total_estimado, backend_new_events, finalizada_en}`.
  3. Paginación/checkpoint para >200 estados; PARCIAL siempre con `motivo_parcial` (TOPE_ESTADOS, PORTAL_HTTP_xxx, TIMEOUT, PARSE_MISMATCH).
  4. /historico incluye `backend_run_id`, `trazabilidad_id`, `consulta_completa` y `motivo_parcial`.
- Compatibilidad del consumidor (ya desplegada): guarda `backend_trace` cuando existan esos campos y deja null si faltan; no hace polling a /runs hasta que una respuesta 202 incluya `backend_run_id` (no se activa sobre endpoint inexistente).
- Pruebas de aceptación: (a) POST repetido mismo radicado → mismo run_id; (b) radicado con >200 estados → COMPLETA tras checkpoints; (c) timeout forzado → PARCIAL con motivo; (d) /historico del día con `consulta_completa=true` → la app registra SUCCESS sin PENDING_UPSTREAM; (e) caso Nicholls 05376311200120261033300 con ultima_sync de hoy.
- Estado: no desplegado; ejecutar en el entorno autorizado.

### Huellas de despliegue de este turno (SHA-256 de contenido enviado, no commit Git)
- sync-by-work-item 7d1e36c54bb3426d544cb7d62b3881b08d7112f8f2f91df40b2a41152048d369
- sync-publicaciones-by-work-item ace56d2aefef43f249cf336eb7d281be13fd8fbbf3d417d1033f7077f39ca2f5
- atenia-ai-supervisor 31b879fa3bb943c502bd0b17b0ffa69d6596b69b8f6f511e42a8a19679d62c63
- atenia-platform-sweep 83a018ea4003d0c630799b711fc545005ba14097050f1b4c9f878fbfc425fe56
- atenia-e2e-scheduled ef3403abce23234192d89a22c756e635657f429509461d3d4bc32b5d1c3b1870
DEPLOY_SHA sigue sin configurar (no se inventa).
Web publicada: https://andromeda.legal sirve /assets/main-Bx4I7k9K.js (sin cambios de interfaz en este turno).

## 2026-10-28 20:25 UTC — async PP bridge integrated (supersedes "backend synchronous/not deployed" above)
- Integrated lexyai `fix/pp-async-caller-20261028` commit c4a4c76c (base b9199925 = project HEAD, applied cleanly, 9 files).
- Migration applied as drizzle 0090 (finish_sync_retry accepts DEFERRED/PP_RUN_PENDING only with valid run UUID, ADMITIDA/EN_CURSO, admission <24h; no attempt increment).
- Deployed: sync-publicaciones-by-work-item (src sha256 8cea87d2…), process-retry-queue (79260f1c…).
- Deno: 13/13 PASS. Isolated SQL suite not run (needs empty cluster).
- Nicholls single check (net request 2488): HTTP 202 reused run 0233cc45-1944-44f8-bafb-7580b4cddace, trazabilidad 3cd0dab4-7edb-4520-a3b6-6381d85122fa, estado EN_CURSO, status PENDING_UPSTREAM, 0 inserted / 3 skipped; association stored in cron_state pub_rescrape:db1b4198…; no new run created.
