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
