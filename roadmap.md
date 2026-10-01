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

## Incidente digest 30/09 (A–F)
- [ ] A. Clasificación: anulada/secretarial/reconocimiento notificación/auto que dispone sentencia/traslado desistimiento → revisión manual; quitar DESISTIMIENTO aislado
- [ ] B. 4 deadlines → REQUIERE_REVISION_MANUAL con respaldo + reversión
- [ ] C. Quitar doble desplazamiento de desfijación en anclas de estado
- [ ] D. Digest: sin respuesta vs sin lectura confirmada; con datos por asunto; quitar causalidad del despacho
- [ ] E. Leer PDFs cacheados (3 publicaciones + auto 00638)

## Incidente resumen 30/09/2026 — verificado 30/09 14:48 UTC
- [x] Clasificación: mandatos mixtos → revisión manual; notificación sola sin plazo automático; traslado futuro condicionado sin término (suite SQL 29/29, exit 0)
- [x] Anulada excluida antes de fechas del despacho (guard puro + acto real; UPDATE de fixture denegado al rol de pruebas)
- [x] Ancla estado vs lista art.110; desfijación solo metadato; contradicción → revisión (suite SQL)
- [x] "Con datos" por asunto con evidencia en cualquier corrida de la ventana (función pura probada)
- [x] Guard: re-lectura no crea PENDING gemelo de un término en auditoría (suite SQL)
- [x] Resumen: bloque visible de revisiones manuales sin fecha; render local con fixtures (2/2, exit 0); desplegado
- [x] 0026: source_collection_quality sin 42702 (SELECT real 4 fuentes OK; regresión en suite).
- [x] 0027–0029: art.110 ancla = día de lista (23/09+3=28/09, 29/09+3=02/10); grade_source_matters filtra intentos al universo, evidencia sin intento inventado, success sin outcome ≠ con datos; guard de gemelos por identidad de origen (act/auto/pub + corroboraciones + vínculos resueltos), no por ±5 días. Suite SQL 41/41 exit 0.
- [x] Digest: revisiones manuales cuentan como contenido; total/exceso si >40. Render 4/4 exit 0. Desplegado.

### Cierre técnico incidente 30/09 — commit 661d2d0d9e065f1cb4092b468ff9590214e1c9f3
Contenido y probado: 4 términos en REQUIERE_REVISION_MANUAL sin fecha ni met_at; guard de gemelos por identidad; ancla estado/lista sin doble desplazamiento; digest con respuesta/lectura/privado/pendiente/error/con datos; revisiones manuales cuentan como contenido. Sin cambios en horarios, monitores, proveedores, permisos ni canales.
Pendientes de plataforma (no trabajo jurídico):
- [ ] Relación canónica acto–publicación: reconciliar automáticamente el mismo acto llegado por fuentes distintas; hoy 58ed4dd1 depende de audit_hold.linked_source_ids anotado a mano.
- [ ] Adquisición de evidencia: decidir si Andromeda debe recuperar los PDFs 00139, 01424 y 00638 y, si sí, por qué el acceso no los sirve aunque existan referencias de almacenamiento.
- [ ] Ingesta CPNU: esta reparación no certifica ese subsistema.
- [ ] Origen del texto breve del resumen original: no localizado.

## Auditoría términos/alertas/calendario (01/10/2026)
- [x] P0.1 Un solo productor de alertas de términos (evaluate-deadline-alerts); regenerate_doctrine_alerts ya no crea TERMINO_* — migración 0030. Pendiente: confirmar en la corrida de 11:35 UTC (≤1 alerta por término).
- [x] P0.2 REQUIERE_REVISION_MANUAL ⇒ requires_manual_review=true (38 filas respaldadas en deadline_manual_review_backup_20261001; trigger de sincronía).
- [x] P0.3 Contadores "sin leer" del asunto y pestaña de notificaciones cuentan solo alertas vivas.
- [ ] P1 Hitos 8/3/1/0/vencido + preferencias en alert_preferences.
- [ ] P1 Calendario externo: función .ics firmada + enlaces Google/Outlook en resumen, término, audiencia y calendario interno.
- [ ] Hallazgo: alertas de audiencias y hearings-extract-backfill usan la tabla `hearings` (vacía/legada) en vez de work_item_hearings; 101 de 109 audiencias con scheduled_at nulo.
- [ ] P2 Resumen semanal de cierres sin verificar; atribución de parte.
