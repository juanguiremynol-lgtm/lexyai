---
name: Appellate blind spot (apelación en el superior)
description: The estados provider is despacho-bound by radicado prefix, so second-instance activity is invisible; modelled as APELACION_EN_SUPERIOR + its own alert type
type: feature
---

# Appellate blind spot — ITER58

## Provider constraint (verified against the PP OpenAPI contract)
Publicaciones Procesales derives the despacho **only** from the first 12 digits of
the radicado. There is no `despacho` parameter. Once an appeal is granted and the
file goes to the superior, its estados are published under the superior's despacho
and are structurally unreachable for the origin radicado. Closing this needs a
GCP-side contract change (despacho override / party search).

## Model
- SQL: `act_is_apelacion_concedida`, `work_item_appellate_blindspot(uuid)`,
  `portfolio_appellate_blindspots()`, `emit_appellate_blindspot_alerts()`
  (cron `appellate-blindspot-sweep`, 12:20 UTC).
- Signal class `APELACION_EN_SUPERIOR` in `classify_work_item_estados_signal`,
  evaluated **before** REMITIDO_A_SUPERIOR; it zeroes the unmatched counters so it
  never raises BRECHA_COBERTURA_ESTADOS.
- Alert type `ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE` (WARNING), fingerprint
  `appellate_blindspot_<work_item_id>`, auto-retired when an estado lands after
  the appeal date. Threshold: 15 days of silence.
- TS mirror: `src/lib/estados-coverage-signal.ts`.

## Silent success
`portfolio_silent_success(p_days)` lists matters synced in the last 48h with zero
acts/estados for N+ days. Surfaced in the daily ops report (WORK_ITEM_FRESHNESS).
