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
- [HISTÓRICO, superado 20:25 UTC — ver abajo] Contrato observado antes del cambio: POST /procesar-radicado síncrono, 34/34 abortos a 60 s hoy; GET /historico/{radicado} 200 con `run_status` (LECTURA_PARCIAL/SUCCESS_EMPTY), `busqueda.{fuente,procesado,ultima_sync,estados_analizados}`, sin motivo de parcialidad ni ids de corrida.
- Contrato requerido:
  1. Admisión durable e idempotente (clave radicado+día Bogotá) ANTES de responder 202 `{backend_run_id, trazabilidad_id, estado:"ADMITIDA"}`; repetir devuelve la misma corrida.
  2. Trabajador durable con reintentos propios; GET /runs/{backend_run_id} → `{estado: ADMITIDA|EN_CURSO|COMPLETA|PARCIAL|FALLIDA, motivo_parcial, checkpoint, estados_analizados, total_estimado, backend_new_events, finalizada_en}`.
  3. Paginación/checkpoint para >200 estados; PARCIAL siempre con `motivo_parcial` (TOPE_ESTADOS, PORTAL_HTTP_xxx, TIMEOUT, PARSE_MISMATCH).
  4. /historico incluye `backend_run_id`, `trazabilidad_id`, `consulta_completa` y `motivo_parcial`.
- Compatibilidad del consumidor (ya desplegada): guarda `backend_trace` cuando existan esos campos y deja null si faltan; no hace polling a /runs hasta que una respuesta 202 incluya `backend_run_id` (no se activa sobre endpoint inexistente).
- Pruebas de aceptación: (a) POST repetido mismo radicado → mismo run_id; (b) radicado con >200 estados → COMPLETA tras checkpoints; (c) timeout forzado → PARCIAL con motivo; (d) /historico del día con `consulta_completa=true` → la app registra SUCCESS sin PENDING_UPSTREAM; (e) caso Nicholls 05376311200120261033300 con ultima_sync de hoy.
- [HISTÓRICO] Estado al redactar: no desplegado. Superado: backend 00091-fod (8655f3f8) y app c4a4c76c desplegados; ver entradas 20:25 y 20:31 UTC.

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

## 2026-10-28 20:31 UTC (15:31 Bogotá) — verification closure
- HISTORICAL NOTE: any statement above or in Codex reports that `fix/pp-async-caller-20261028` is "not deployed" or that the PP backend is synchronous is superseded by the 20:25 UTC entry (c4a4c76c integrated, migration 0090, both consumers deployed). Do not re-implement.
- Task d84d9222-72c8-489d-bd6f-859c3e499ff4 not yet taken by a scheduled drain: attempt 1, no lease, next_run_at 06:00 UTC (due), last_error PENDING_UPSTREAM, no outcome row.
- Limitation: claim_sync_retry takes the oldest due task per channel (1 recovery PUB slot per drain); 22 due PUB_RETRY tasks precede this one, and there is no task-id parameter. A targeted drain is not possible without new parameters, so no manual drain was run.
- Association (cron_state pub_rescrape:db1b4198…): run 0233cc45, trace 3cd0dab4, backend_admitted_at 20:21:51Z. Admission is preserved for the same run_id (recordRescrapeTrigger + backend_trace use stored value); not renewed per poll.
- 24h exit: after the deadline ppDurableDeferral returns null → normal RETRY consumes one attempt with PENDING_UPSTREAM (observable), association/run kept; DB also rejects expired PP deferrals.
- Isolated SQL suite: not run (no empty PostgreSQL cluster available; production not used).

## 2026-10-28 20:36 UTC (15:36 Bogotá) — PP follow-up slot (fix of the 1-slot bottleneck)
- Trigger cadence (unchanged): process-retry-queue cron 67 `0 5-13 * * *` + cron 95 `0 18 * * *` = 10 drains/day, x-cron-key from Vault. Before: 4 slots/drain, 1 PUB recovery slot → 10 PUB recoveries/day, oldest-first.
- Now: 2 extra follow-up slots per drain (claim_sync_retry_pp_poll, migration 0091) take only PUB_RETRY tasks whose case has an open stored run (valid run id, not closed, <72h since first app observation, <96 polls), ordered by next_run_at. Extraction slots unchanged. Follow-up = one GET /runs/{id} (+ certified /historico if COMPLETA); never POST.
- 24h limit replaced: 0–24h PP_RUN_PENDING (≤30 min), 24–72h PP_RUN_OVERDUE (observable, ≤6h, no attempt), ≥72h terminal PP_RUN_FOLLOWUP_EXPIRED in sync_retry_outcomes with run id; ledger keeps run/checkpoint; afterwards normal gate (backend idempotent admission) is the recovery.
- backend_trace now distinguishes `backend_admitted_at_source=app_first_observed` from `backend_reported_admitted_at` (null: backend sends none) and records live `run_status_polled/http/polled_at`.
- Deployed: sync-publicaciones-by-work-item 6724984a…, process-retry-queue e34892b1… Tests 16/16.
- Real worker run (request 2497, targeted pp_poll, same claim/lease/finish): task d84d9222 attempt 1→1, lease null after, next_run_at 06:00→21:06:02 UTC, last_error PENDING_UPSTREAM→PP_RUN_PENDING, no outcome row; live GET /runs 200 estado ADMITIDA at 20:36:01Z; run 0233cc45, trace 3cd0dab4, admission 20:21:51.668Z unchanged; poll_count 1.

## 2026-10-28 20:47 UTC (15:47 Bogotá) — durable follow-up trigger
- New cron 99 `pp-run-followup-15m` `*/15 * * * *` (UTC; Bogotá = UTC−5, every 15 min all day), x-cron-key from Vault, body {"mode":"followup"}. SQL-gated: HTTP only if a due open follow-up exists (same predicate as claim_sync_retry_pp_poll), else no function boot/provider call.
- followup mode: only pp_poll slots (max 8 per call, stops at first empty claim); extraction slots unreachable by construction (slots.ts + followupOnly_test.ts). Overlap with cron 67/95 safe: same SKIP LOCKED claim + lease token fencing.
- Effective schedule: 0–24h target ≤30 min → met (deferral ≤30 min + ≤15 min trigger ⇒ ≤45 min worst case). 24–72h target ~6h → met (≤6h + 15 min). Capacity 8×96 = 768 follow-ups/day vs real volume at 20:47: 3 stored/open runs (of 67 PUB tasks).
- Expiry: a stored run not proven terminal is now only READ (GET /runs) by sync-publicaciones, even after 72h/96 polls or cooldown/day change; `followup_expired_needs_intervention` flags it. New POST only after a terminal state closes follow-up.
- Ledger keeps sanitized last /runs body (last_poll_body) with source timestamp last_polled_at.
- ADMITIDA vs EN_CURSO (Nicholls): 202 at 20:21 said EN_CURSO, GET /runs at 20:36 said ADMITIDA (body not stored at that poll). Two other runs polled at 20:45 also report ADMITIDA with estados_analizados 0, checkpoint unchanged. No conclusion on regression; for Codex.
- Deployed sync-publicaciones-by-work-item 196d7b26…, process-retry-queue 74f3a659…. Tests 16/16 + 2 follow-up-only.
- First automatic run 20:45:00 UTC (request 2502): mode followup, 2 pp_poll tasks (c8f41dc1, e76d925a), both DEFERRED PP_RUN_PENDING, attempt 1→1, no extraction slots. Nicholls not touched (next_run_at 21:06:02 → served by the 21:15 UTC firing).
- Concurrent: scheduled-publicaciones-monitor (request 2503, same minute) is a separate extraction channel and admitted run 7c94efe6 for e76d925a at 20:45:06.

## 2026-10-29 23:54 UTC — scoped Tiny optimization and live follow-up acceptance

### Applied database change
- Applied only `drizzle/migrations/0092_atenia_actions_created_at_listing_index.sql`: single-column B-tree `idx_atenia_ai_actions_created_at (created_at DESC)`. Existing organization-leading/partial indexes are not equivalent for the unfiltered global listing. Index verified `indisvalid=true`, `indisready=true` in the live database.
- The migration tool owns a transaction, so concurrent index creation is not available through that path. Used ordinary additive creation with transaction-local `lock_timeout=500ms` and `statement_timeout=5s`; the migration succeeded. This bounds waiting/build time, not a claim that no write lock occurred. No compute resize, deleted indexes, application logic, persistence guards, provider requests, or function deployments.
- Same live query, `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.atenia_ai_actions ORDER BY created_at DESC LIMIT 50`: before **1072.289 / 11.249 / 11.148 ms**, sequential scan of **8451 rows**, top-N sort, **3726 shared hits**. After **1.337 / 0.284 / 0.216 ms**, index scan returning **50 rows**, **45 buffer accesses**, no sort. First before measurement is an outlier and excluded from the warm comparison; no cold-cache or concurrency benchmark was attempted. The structural reduction in rows/buffers, not cache alone, supports the improvement; observed times are not an SLA.

### Recent real Lovable scheduled execution (not Google dispatcher)
- Live `cron.job`: **99 / pp-run-followup-15m**, active, `*/15 * * * *`, follow-up mode and EXISTS due-work guard confirmed without printing credentials.
- `cron.job_run_details`: **runid 520985**, 29Oct **23:45:00.241–23:45:00.364 UTC**, succeeded. This alone is not source/ingestion success.
- Corresponding `net._http_response` **97**, 23:45:00.369 UTC: HTTP200, `ok=true`, revision **retry-pp-poll-20261028b**, `mode=followup`, **8 pp_poll results**, all **DEFERRED / PP_RUN_PENDING**. Eight tasks were actually claimed and finished; this is not eight completed extractions.
- Read-back example: task **a9def8c8-01ec-4a52-b379-22968496929f**, matter **d5d846a3-673e-4969-b7ea-9cfc49d613c4**, execution trace **ff9c6f74-c164-4b89-8cab-83bd3cd396ce**, run **ae00346c-d5ab-4450-82a2-37b3da62279f**, backend trace **200a04e5-ba79-4045-831b-99974f805882**. Poll **10**, last poll **23:45:05.092 UTC**, GET result HTTP200/ADMITIDA/`consulta_completa=false`; attempt **1→1**, claim and lease released, finish/update **23:45:06.107 UTC**, next due **30Oct 00:15:06.107 UTC**. The first eligible 15-minute firing is **00:30 UTC** (scheduled opportunity, not guaranteed completion; capacity/older due rows can delay it).
- Another finished task **daf3fe5e-6ede-402e-9d8d-e87ea09643c0**: run **0cb3e335-6cb9-48d5-b52b-6ca9e9c967c2**, poll **11**, attempt **3→3**, released lease, next due **00:15:12.563 UTC**, ADMITIDA, `EXTRACCION_DOCUMENTO_NO_VERIFICADA`.
- Runtime no-POST evidence for the first task: `provider_sync_traces` at **23:45:05.613 UTC** records **follow_admitted_run / RESCRAPE_NOT_NEEDED**, even though six-hour cooldown had elapsed; gate ledger last POST remains **17:30:07.331 UTC**, distinct from last poll. Stored run body and trace match the follow-up path. No packet-level Cloud Run access log is available here; do not claim a global absence of POST from unrelated scheduled channels.
- Live finish definition requires service role and the matching fenced lease; PP pending deferral validates durable run UUID/state/admission, updates next_run_at without incrementing attempt, releases lease, and returns true. The deployed drain returns a result only after successful finish. Deferred finishes intentionally stay in the queue, not terminal `sync_retry_outcomes`; stored message is truncated text, not guaranteed parseable JSON.
- Isolated regressions: **8 PASS / 0 FAIL** (`followupOnly_test.ts`, `ppDurableContract_test.ts`, `retryOutcome_test.ts`). Build telemetry OK. No local defect preventing this recent automatic follow-up was demonstrated, so no redeployment or repeated migrations.

### External limits, kept explicit
- Esfinge follow-up at **23:15 UTC**, task **156ab619-afe7-41f4-bad3-b20008699c43**, run **a6d38267-6398-429f-95d3-4f180947bf42**, poll **7**, ADMITIDA, `consulta_completa=false`, reason **DB_CONNECTION_RESET_ARTICLE_LEASE_PENDING**. Nicholls at 23:15, run **737b95d2-f93e-4a98-a97b-39cbd1953191**, poll **8**, ADMITIDA, **EXTRACCION_DOCUMENTO_NO_VERIFICADA**. These are stored intermediary responses, not proof of portal failure, judicial reserve, or restored coverage.
- Effective intermediary destination remains **https://publicaciones-procesales-api-11974381924.us-central1.run.app**. Codex's 29Oct 18:32 Bogotá report (API00110-jor, dispatcher00006-lin, commit7aa0cf3de28789c6d95573664e5dc9141823a5b9, worker template d98832f5c1a5) is coordination evidence **not independently verified here**. Worker image/revision and durable extraction completion remain for the authorized Cloud Run environment; Lovable follow-up is proven independently of Google's dispatcher cron.
- No new extraction, broad sweep, matter assignment, ambiguous publication attribution, session minting, or UI test was performed. Tiny retained. Partial/unverified results remain partial/unverified.
