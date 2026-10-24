# Roadmap

## Scoped completion — 2026-10-21 17:46 UTC
- [x] Correct daily attempt completion/recovery with existing durable leases; preserve successful sources and bound retries.
- [x] Verify six native acts and repeat only the three authorized cases today; preserve historical terms (0 inserts, 15/28/138 existing).
- [x] Verify J19 communication/providencia relationship and production document controls; headless viewer not visually certified.
- [x] Finish Familia/J15 attempt/snapshot presentation and eight evidence-backed stage suggestions, preserving manual overrides.
- [x] Compare the exact 14 failed tests with the prior baseline; identical failures, none muted.
- [x] Run focused tests, confirm publication and served bundle main-DxeC-PSG.js; report automatic next-run verification separately.
- [ ] Observe the next automatic daily execution — blocked until its scheduled time; manual recovery is verified separately.

## Authorized public closure (2026-10-21)
- [x] Reconcile five diagnostics and two adapter tests; preserve SQL0045, official evidence and legacy-copy compatibility.
- [x] Confirm no active recent claims; apply corrected durable protocol 0046 and deploy 13 affected importers; Deno check passes all.
- [x] Implement personal notification dismiss/snooze, cancellation/rollback, scoped caches, RPC confirmation; migrations 0047/0048 and isolated tests pass.
- [x] Verify runtime cron auth using real POST validation/rejection; preview session restored and six case pages inspected; selected stored downloads pass.
- [ ] Inject matching CRON_SERVICE_KEY and SUPABASE_URL into Vault through a secure privileged channel; no available tool writes Vault safely.
- [ ] Apply coordination/20261020011000_public_monitor_dispatch.sql only after both Vault names and gateway auth pass; observe scheduler→persistence and idempotency. Old unauthenticated job 64 paused; jobs 66/91/92 remain enabled.
- [ ] Confirm requested frontend publication on production; MCP unchanged (33). Public closure remains unverified until dispatcher runs.

## Legal access blocker (2026-10-19)
- [x] Repair canonical document loading, retry and no-scroll gating; preserve current-version acceptance (11 focused tests pass; browser modal checked without registration).
- [x] Publish complete versioned legal documents with authorized company placeholders, preserving historical acceptances (v1.1; both canonical hashes verified).
- [ ] Publish frontend and verify real-user access — existing browser session remains signed_out; do not mint a session under the user's standing restriction.

## SAMAI — isolated persistence validation (2026-10-18)
- [x] Abort the real sync batch when a confirmed write cannot be read back; prepare A-confirmed/read-failed/B-distinct regression.
- [x] Repair the local harness readiness wait.
- [ ] Rerun all real persistence scenarios — blocked: previous /tmp/itest schema, seeded local database and synthetic credentials are absent; recreating roles/grants/credentials is not authorized.
- [x] Document combined results, exact environment blockers and publication effects without deployment or real-data writes.

## Responsive móvil (solicitud actual)
- [ ] Corregir ficha de radicado, hitos, encabezado, chips y pestañas a 390 px.
- [ ] Auditar y corregir patrones compartidos en tablero, procesos, alertas, audiencias/calendario y configuración.
- [ ] Validar 390/430/768/escritorio, pruebas y límites de verificación.

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
- [x] P1 Hitos reales D-8/D-3/D-1/D-DAY/vencido: una fila por término con historial; vencido no repite; preferencias (hitos, vencido, avisos INFO de revisión manual) leídas por el evaluador. Tests termAlert 4/4.
- [x] P1 Calendario: utilidad común .ics/Google/Outlook; función calendar-ics con enlaces opacos (tabla calendar_event_tokens, solo servicio, 30 días); botones en resumen, pestaña Términos, ficha de audiencia y calendario interno. Tests 5/5 + render 3/3.
- [x] Calendario interno: términos PENDING fechados + audiencias vigentes de work_item_hearings; revisiones manuales en "Pendientes de validación" sin fecha.
- [x] regenerate_doctrine_alerts ya no lee `hearings` (duplicaba hearing-reminders) — 0031.
- [x] Corrida real 01/10 11:15 UTC confirmada: OK, 0 errores, 1 alerta de atribución pendiente.
- [ ] hearings-extract-backfill todavía escribe en la tabla legada `hearings` (no modificado).
- [ ] Correo inmediato opt-in al entrar crítico/vencido: no implementado (opcional).
- [ ] P2 Resumen semanal de cierres sin verificar; atribución de parte.

## Omisión PP/estados 05001400302320250063800 (01/10/2026)
- [x] Causa raíz: monitor pedía profundidad 60 y la RPC aceptaba ≤32 → 30/09 y 01/10 sin corrida (PP y SAMAI, 44/44 asuntos). Corregido (0035) + desplegado.
- [x] Recuperación: Estado 116 + AutoCorreTraslado insertados desde PP; 2ª lectura 0 nuevos
- [x] Señal de cobertura Fijacion Estado sin PP (0036), al final de cada corrida PP
- [x] Claim rechazado ahora queda registrado (RUN_NOT_STARTED, expected/attempted=0)
- [ ] Seguridad: la clave del programador está escrita en claro en la tarea programada; rotar
- [x] Pruebas (SQL de cobertura escrito; ejecución en sandbox sin permisos — verificado en producción)

## MCP gestión de cartera (aprobado 2026-10-24) — sin publicar
- [x] Fase 1: cerrar entradas inseguras (0059), corregido en 0065: solo el dueño con sesión verificada; mantenimiento de confianza explícito (service_role o login de backend sin JWT); gate de gestión dentro de set_work_item_lifecycle; sin fanout a hermanos en borrados de usuario; ledger ligado al evento nuevo.
- [x] Fase 2: permisos read/manage por usuario + cliente OAuth (0060; 0064 sesión no verificada = solo lectura).
- [x] Fase 3: idempotencia + revisión esperada + auditoría atómica (0060/0061).
- [x] Fase 4: herramientas (0061–0063; 47 en total); feed por revisión + frescura + reconciliación (0064).
- [x] Pruebas DB aisladas: mcp_management_authz.sql, lifecycle_authz.sql, mcp_stage_creation_parity.sql (0066 vocabulario de etapas + paridad de creación; 0067 permisos de ejecución restaurados).
- [x] Revisión independiente 2026-10-24 (0068–0070): sesión no verificada/caducada/borrada/cliente borrado sin autoridad; atajos directos (monitoreo, etapa del sistema, decisiones de términos) cerrados a dueño+gestión o backend de confianza; notificaciones con visibilidad explícita; asunto del correo cuenta como radicado; creación con recordatorios y sincronización inicial duradera; feed con cursor en servidor, tope fijo y checkpoint monótono. supabase/tests/mcp_release_blockers.sql: 49 checks, 0 fallos.
- [ ] Reabrir las diez RPC de escritura (supabase/release/mcp_write_rpcs_enable.sql) — root revisa evidencia final y sus suites hosted antes de aplicar SQL explícito.
- [ ] Publicar y confirmar marcador mcp-rev-0-6-4 — root controla publicación tras revisión; no autorizado en esta ronda.
- [ ] Prueba real desde ChatGPT tras publicar (activar «Permitir gestionar») — espera publicación.

## MCP aceptación final (2026-10-24)
- [ ] Revisión adicional 20:43: actualización atómica 0079, capacidades runtime, desempate de frescura por ID, regresiones y 0.6.5; once gates cerrados.
- [x] Cierre 20:39: 0078 privilegios no-row revocados/verificados; concurrencia local 15 PASS y panel renderizado 6 PASS; evidencia/prerrequisitos en docs/mcp-release-readiness-20261024.md; diez gates/publicación cerrados.
- [x] Creación sin radicado: motivo automático SYSTEM derivado por base; continuación 18 checks PASS (cuota, pausa USER, revisión, reintento/auditoría), sin proveedores ni horarios; 0.6.4 / 50 herramientas, gates cerrados. Detalles en docs/mcp-creation-continuation-acceptance-20261024.md.
- [x] 20:23: 0076 exige rol JWT JSON y protege emisión/aislamiento cursores con ejecutor NOLOGIN/NOBYPASSRLS; 0077 frescura de problemas paginada; 12 checks nuevos PASS. Fuente/bundle/manifest 50 herramientas / 0.6.3; gates cerrados.
- [x] Arnés feed incorporado: 11 PASS/0 FAIL/3 SKIP; 0075 repara evidencia de fallo en página vacía; suplemento multisesión 11 PASS y etapas manuales 10 PASS. Gates/publicación cerrados; límites en docs/mcp-final-feed-acceptance-20261024.md.
- [x] Movimientos manuales de etapa con validación de servidor, retrocesos con motivo (0072).
- [x] Consulta global de preguntas de correo en la base (mcp_list_email_questions, 0072).
- [x] Frescura por proveedor/operación para todos los asuntos monitoreados visibles; reconciliación documentada como parcial (0072).
- [x] update_work_item usa suspensión/reanudación explícita; get_capabilities corregido.
- [x] Herramienta list_email_questions registrada; bundle regenerado y manifest de 49 herramientas, 0.6.2 (no publicación).
- [x] Corregir public/.well-known/mcp.json al inventario real (49 / 0.6.2, sin scopes de gestión inventados).
- [x] Panel de permisos: borrar niveles obsoletos, mostrar desconocido/error y deshabilitar grants; acciones y retención visibles antes de activar. Falta prueba autenticada.
- [x] Aceptación final usa suites estrictas con BEGIN/veredicto/ROLLBACK y suplementos de feed; suites legacy históricas no se presentan como evidencia final. Root reporta AUTH hosted 61/61 PASS.
- [x] Notificaciones: 0073 filtra estado personal antes de paginar, cursor estable y errores visibles; pendientes antiguos/aislamiento probados en fixtures locales.
- [x] assign_work_item_radicado: 0073 solo propio ACTIVE vacío, revisión/idempotencia/auditoría, límites/duplicados/sincronización pendiente; EXECUTE permanece bloqueado.
- [x] Pruebas operativas locales: 55 checks PostgreSQL rollback + 19 Vitest, artefacto y build OK; límites en docs/mcp-acceptance-20261024.md.
- [x] Panel renderizado: 6 pruebas sintéticas verifican carga/error/desconocido, controles, grant/revoke y alcance/retención; sin impersonación. No se afirma equivalencia productiva de fixtures locales.
- [x] authorization-acceptance.sql adaptado/ejecutado localmente: 68 checks, JSON PASS normal antes de ROLLBACK, diez gates restaurados; firmas/errores exactos y NULL-safe.
- [x] 0074 restauración usa monitoreo efectivo antes de cuota: PETICION/GOV/sin radicado/suspendidos restauran al límite; suite fuentes/restauración 33 checks PASS. ConnectAI y ruta de permisos comprobados sin sesión.
- [ ] Liberación final: root confirma sus pruebas hosted FEED/OPERATIONS, aplica SQL explícito y publica; smoke externo posterior. Implementación local acotada pasa; diez gates siguen cerrados.
