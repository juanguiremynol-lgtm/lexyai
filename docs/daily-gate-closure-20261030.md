# Cierre de brechas del límite diario — 2026-10-30

## Rutas que pueden iniciar una actualización de un work_item
| Ruta | Protección |
|---|---|
| sync-by-work-item (cron, supervisor, watchdog, retries, manual, force) | admit_daily_update 'acts' |
| sync-publicaciones-by-work-item (todos los llamadores) | admit_daily_update 'pubs'; seguimiento GET /runs: claim_pp_followup_poll (1 por corrida cada 600 s), sin SAMAI |
| resync-actuaciones | delega en sync-by-work-item (una sola admisión), invoker etiquetado |
| admin-force-sync-pub | delega en sync-publicaciones-by-work-item (una sola admisión), invoker etiquetado |
| sync-by-radicado (asunto existente), generate-evidence-bundle, bridge-reconcile, estadosMonitor, atenia-e2e-scheduled | delegan en las dos funciones con barrera |
| cpnu-job-poller → continuación | admit_cpnu_continuation: job actual IN_PROGRESS + ligado al ciclo de origen; solo CPNU, allow_buscar=false, force_refresh=false, sin orquestador/SAMAI/externos/enriquecimiento |
| provider-wizard-run-e2e → provider-sync-external-provider | admit_daily_update 'acts' antes del sync |

Límites fuera de la barrera: búsquedas por radicado sin asunto (sync-by-radicado lookup/creación), registro único pp_id en sync-pp-by-work-item, y reintentos internos del servicio Cloud Run (no accesibles desde aquí).

## Pruebas
- Concurrencia real: 3 rondas × 5 llamadas PostgREST simultáneas (PIDs/txids distintos, una sesión retiene el bloqueo 1,5 s) en días aislados 2099: acts 1/3 y pubs 1/2 admitidas en cada ronda; filas de prueba borradas (3), función temporal eliminada.
- DB (rollback): continuación falsa, job inexistente, job ajeno, job no ligado, job terminado, ciclo de origen de cualquier antigüedad, claim de seguimiento doble y de otra corrida, helper de prueba rechaza días reales (22023).
- Deno: dailyUpdateGate 8/8, sync-publicaciones 11/11. admin-force-sync-pub/gate_test.ts hace que el runtime de Deno se cierre de forma inesperada (crash) en este entorno.

## Conteos (corrección)
Las cifras previas 12/17 y 332/188/63/14 son **invocaciones** (trace_id distintos), no inicios de fuente.
Evidencia en provider_sync_traces (estados/publicaciones PP):
- 28/10: trigger_accepted 69 (52 asuntos; 17 asuntos con 2, máx. 2); follow_admitted_run 113 GET de seguimiento.
- 29/10: trigger_accepted 50 (50 asuntos, máx. 1); follow_admitted_run 436 GET (51 asuntos).
Backfill pubs 29/10 (69): 50 con POST aceptado, 1 solo seguimiento, 18 sin evidencia de inicio. Se anotaron en backfill_evidence; no se borraron, para no reabrir consultas el mismo día.
