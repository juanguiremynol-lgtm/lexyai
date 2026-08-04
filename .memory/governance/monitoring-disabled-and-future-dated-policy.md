# Memory: governance/monitoring-disabled-and-future-dated-policy
Updated: now

## Monitoreo desactivado
- `list_unmonitored_work_items()` powers `/app/sin-monitoreo` (badge + filter also in `/app/processes`).
- `is_procedurally_live_stage(stage)` = at/after AUTO_ADMISORIO and before SENTENCIA/ARCHIVO.
- `detect_monitoring_disabled_live()` emits WARNING alert type `MONITOREO_DESACTIVADO` (cron 12:45 UTC).
- Reactivation is ALWAYS manual; provider enrolment stays governed by the routing matrix
  (CPACA→SAMAI exclusive; CGP/Penal/Laboral→CPNU+PP; TUTELA→full union).

## Fechas futuras
- `work_item_acts.is_future_dated` / `work_item_publicaciones.is_future_dated`, set by
  `trg_flag_future_dated_act` / `_pub`. Rows are FLAGGED, never dropped.
- Flagged rows are excluded from "última actuación" displays and recency classification
  until a human reviews them.
