# Roadmap

## LV — términos, correspondencia, clasificador (en curso)
- [x] LV1 Desactivar apply_email_evidence_to_deadlines
- [x] LV2 Separar el estado en tres (41 / 11 / 1)
- [x] LV3 RPC decide_correspondence_closure (confirmar o reabrir)
- [x] LV5 Ventana de ancla hacia atrás (5 días)
- [x] LV6 Clasificador: requiere / requerimiento / desistimiento
- [x] LT2 Declarar los valores de resultado (36) + PENDING_UPSTREAM
- [x] LT3 Prueba de caso exacto en el runner
- [x] LV3 Digest: render de las tres categorías + control confirmar/reabrir
- [x] LV4 Los 23 sin fecha: "SIN FECHA — REQUIERE REVISIÓN", fuera de conteos
- [x] Frontend: estados nuevos en hooks y banner

## LW — cobertura por cadena
- [x] LW1 Denominador = cadena del proveedor (CPNU/PP: CGP, EJECUTIVO, LABORAL, PENAL, TUTELA; SAMAI/SAMAI Estados: CPACA)
- [x] LW1 ROUTING_SKIP fuera de numerador, denominador y "sin confirmar"
- [x] LW2 "Cobertura incompleta" por fuente, no global
- [x] LW3 Nombrar los 11 PP y 5 SAMAI Estados pendientes en la tabla de fuentes
- [x] LW4 Restringidos por asunto (3 asuntos / 8 intentos), no total

## LX — antigüedad de la brecha (los mismos 16 todos los días)
- [x] LX1 Sección propia "Fuentes que llevan días sin entregar" (radicado, asunto, días)
- [x] LX2 Titular reporta movimiento; "sin cambios" cuando no hay altas ni bajas
- [x] LX3 Días consecutivos por asunto y fuente (source_coverage_persistence)
- [x] LX4 La falla única de CPNU se nombra cada día que persista

## Monitoring remediation (work order 2026-09-25)
- [x] Baseline 18:49 UTC: 59 monitored (36 CGP, 7 EJEC, 15 CPACA, 1 LAB); 60 = +1 ARCHIVED non-monitored CGP without radicado (874dea9a)
- [x] Daily estados reads: weekly deferral removed from estadosMonitor
- [x] Duplicate deadline trigger dropped; outcome per fijación in pub_deadline_outcomes; failures no longer silent
- [x] SAMAI fijación: strict calendar date (DB + mapper), no fijación→providencia repurposing, verified date never erased; conflicts logged
- [x] Fechas por perder: per-run cache, failure shown as unavailable, null count stays null, scoped to recipient's despachos
- [ ] Shared per-matter/per-channel coverage classifier for digest + dashboard (Phase 1)
- [ ] CPNU fijación vs PP reconciliation in digest (Phase 5)
- [ ] Live replay of SAMAI captures — blocked: needs approval to sign in as gr@lexetlit.com
- [ ] Cases A, B, D, E — blocked on GCP document evidence
