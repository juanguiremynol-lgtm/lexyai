# Fase 2 — GOV_PROCEDURE: procedimiento administrativo sancionatorio (CPACA 47–52)

Plan only. No migrations until the legal model is approved.

## 1. Legal model reconstructed (Ley 1437 de 2011; Ley 2080 de 2021)

Supletoriedad (arts. 34 y 47 inc. 1): CPACA is the *default* regime; special laws displace it and CPACA fills their gaps. The model is therefore **one workflow (`GOV_PROCEDURE`) + one common core + regime overlays**, never one workflow per authority.

Milestones by universality:

| Hito | Clase | Término / cita |
|---|---|---|
| Iniciación de oficio o a petición | universal | art. 47 inc. 2 |
| Averiguaciones preliminares | condicional (facultativa) | art. 47 inc. 2 — never a mandatory first stage |
| Comunicación de méritos al interesado | condicional | art. 47 |
| Formulación de cargos (acto motivado; notificación personal; sin recursos) | universal | art. 47 |
| Descargos y solicitud de pruebas | universal | 15 días desde notificación de cargos (art. 47); 5 días régimen fiscal (Ley 2080) |
| Período probatorio | condicional | ≤30 días; ≤60 si 3+ investigados o prueba en el exterior (art. 48) |
| Traslado para alegatos | condicional (depende de que haya habido probatorio) | 10 días desde vencimiento del probatorio (art. 48 inc. 2) |
| Decisión de fondo (sanción o exoneración con archivo), congruente con el pliego | universal | 30 días desde presentación de alegatos (art. 49) |
| Notificación de la decisión | universal | personal art. 67 / aviso art. 69 / electrónica art. 56 |
| Recursos (reposición, apelación, queja) | condicional | 10 días desde notificación (arts. 74, 76); 5 días régimen fiscal (art. 49A) |
| Renuencia a suministrar información | condicional | art. 51 |
| Suspensión provisional del servidor | condicional (solo fiscal) | art. 47A |
| Firmeza / ejecutoria | universal | art. 87 |
| Caducidad de la facultad sancionatoria | universal (temporizador de fondo) | art. 52 |

Régimen-dependiente (nunca hard-coded): toda duración, procedencia de apelación, tipología sancionatoria y el propio plazo de caducidad ("salvo leyes especiales", art. 52).

### Los dos temporizadores de fondo (§2.3)
- **Caducidad (art. 52)**: 3 años desde el hecho/conducta/omisión; dentro de ese plazo el acto sancionatorio debe haberse **expedido y notificado**. Conducta continuada: se re-ancla al día siguiente de la cesación. Solo se satisface con la **notificación**, no con la expedición. Alertas escalonadas (180/90/30/7 días) y, al vencer, propuesta de etapa terminal `CADUCIDAD_FACULTAD_SANCIONATORIA`.
- **Recursos, 1 año (art. 52 inc. 2)**: cada recurso debidamente interpuesto tiene su propio reloj de 1 año; vencido, pérdida de competencia y **fallo a favor del recurrente**. Al vencer: propuesta de `SILENCIO_POSITIVO_RECURSO` + alerta accionable de máxima prioridad. Desplaza el silencio negativo general del art. 86 en materia sancionatoria; si un overlay afirma lo contrario, el punto se marca *contested* y exige revisión manual.

### Notificación como ancla
Cada acto notificable genera un evento de notificación con modalidad (`PERSONAL`, `AVISO`, `ELECTRONICA`, `CONDUCTA_CONCLUYENTE`) y su propia regla de perfeccionamiento. Si solo se conoce la fecha de expedición y la regla exige notificación, el deadline nace `requires_manual_review = true` con motivo explícito (invariante 2).

## 2. Inspección: qué se reutiliza y qué es genuinamente nuevo

Reutilizado sin fork: `workflow_definitions` (`catalog_governed = true`), `workflow_stages_global` + `workflow_stages_org_override` (patrón `_global` / `_org_override`), `workflow_stage_transitions`, `workflow_event_catalog`, `workflow_event_stage_patterns`, `work_item_stage_suggestions.stage_id`, trigger fail-closed de etapa, motor `add_business_days_sql` / `is_business_day_sql` con `term_class`, `holiday_calendar_coverage` y su guarda de caminata, `compute_deadline_from_rule`, `work_item_deadlines` (con `supersedes_deadline_id`, `deadline_status`, `legal_effect`), `work_item_successions` y `work_item_external_links`.

No reutilizable tal cual, con razón:
- `cgp_term_templates`, `milestone_mapping_patterns`, `providencia_classification_rules`: acoplados a providencias judiciales CGP y a su vocabulario; se dejan intactos.
- `work_item_tracks`: sirve para ramas paralelas, pero los recursos aquí requieren un reloj de 1 año **por recurso**; se modela como instancia de término, no como track.
- `deadline_rules` no tiene noción de overlay ni de tipo de ancla (expedición vs notificación).

Estructura nueva mínima (aditiva):
1. `gov_procedure_regimes` — catálogo de overlays (`CPACA_GENERAL`, `SANCIONATORIO_FISCAL`, `AMBIENTAL`, `TRANSITO`…), con `verified`, `requires_manual_review`, `legal_basis`.
2. `gov_procedure_regime_terms` — por (overlay, deadline_type): duración, unidad, `term_class`, `anchor_kind` (`ISSUANCE` | `NOTIFICATION` | `TERM_EXPIRY` | `FACT_DATE` | `FILING_DATE`), norma. Un overlay no verificado no aporta filas computables.
3. `gov_procedure_regime_stage_applicability` — por (overlay, stage_code): `UNIVERSAL` | `CONDITIONAL` | `NOT_APPLICABLE`. Un overlay **no** puede alterar identidad de etapa, clasificación terminal ni integridad del grafo (validado por constraint + test).
4. `gov_procedure_work_item_state` — dimensiones paralelas por expediente: overlay asignado, `fact_date`, `conducta_continuada`, autoridad, expediente/radicado de la autoridad, `hubo_periodo_probatorio`.
5. `gov_procedure_notifications` — acto notificado, modalidad, fecha de perfeccionamiento, evidencia.
6. `gov_procedure_recursos` — un recurso por fila (tipo, fecha de interposición debida y oportuna, estado) → ancla del reloj de 1 año.
7. Ampliación aditiva de `deadline_rules` con `anchor_kind` (default `ISSUANCE`, sin cambio de comportamiento para workflows existentes).

## 3. Catálogo de etapas y grafo

Se siembran las 20 etapas del §3 tal cual, con `is_terminal` solo en `EXONERACION_ARCHIVO`, `SILENCIO_POSITIVO_RECURSO`, `ACTO_EN_FIRME`, `CADUCIDAD_FACULTAD_SANCIONATORIA`. `SANCION_IMPUESTA` no es terminal. La ausencia de descargos no es estancamiento: `TERMINO_DESCARGOS → PRUEBAS_DECRETADAS | PENDIENTE_DECISION` sin pasar por `DESCARGOS_PRESENTADOS`.

Dependencia condicional clave: `TRASLADO_ALEGATOS` solo es alcanzable desde `PERIODO_PROBATORIO`; se hace cumplir por el grafo de transiciones y por test.

`CADUCIDAD_FACULTAD_SANCIONATORIA` y `SILENCIO_POSITIVO_RECURSO` son alcanzables desde cualquier etapa viva, pero **solo por acción explícita del usuario** sobre una propuesta del sistema (`requires_explicit_user_action = true`).

Prohibido como etapa: vencido, requiere revisión, coincidencia ambigua, esperando cliente, no leído, acción requerida.

## 4. Vocabulario de eventos

~24 eventos en `workflow_event_catalog` (apertura de indagación, comunicación de méritos, formulación de cargos, notificación personal/aviso/electrónica, presentación de descargos, decreto de pruebas, cierre de probatorio, traslado de alegatos, alegatos, resolución sancionatoria, resolución de exoneración, interposición de recurso, resolución de recurso, constancia de ejecutoria, renuencia art. 51, suspensión provisional art. 47A…), más patrones de exclusión (acuses, fuera de oficina, avisos automáticos) marcados `is_excluded = true` y **visiblemente descartados**, no ignorados. El mapeo evento→etapa vive en `workflow_event_stage_patterns` (data-driven, sin condicionales en código).

## 5. Términos y anclas

Todos `term_class = ADMINISTRATIVO`. Por overlay: descargos (15 / 5 fiscal, ancla NOTIFICATION), probatorio (≤30/≤60, ancla ISSUANCE del auto de pruebas), alegatos (10, ancla TERM_EXPIRY del probatorio), decisión (30, ancla FILING_DATE de alegatos; 15 fiscal), recursos (10 / 5 fiscal, ancla NOTIFICATION), caducidad (3 años, ancla FACT_DATE), reloj de recurso (1 año, ancla FILING_DATE por recurso). `AMBIENTAL` y `TRANSITO` se siembran como overlays **no verificados** (`requires_manual_review = true`, sin términos computables) hasta auditar Ley 1333/2009 y Ley 769/2002.

## 6. Trabajos vinculados, nunca fusionados

Al alcanzar `ACTO_EN_FIRME` el sistema **propone** (nunca crea automáticamente): (a) un work item de cobro coactivo, (b) un work item `CPACA` para el medio de control. Ambos se enlazan vía `work_item_successions` con `relation_type` nuevos (`COBRO_COACTIVO`, `MEDIO_DE_CONTROL`). El plazo de caducidad judicial del art. 164 **no se siembra** en esta fase: se verifica primero; hasta entonces el deadline nace `requires_manual_review`.

## 7. Correo (último y conservador)

Solo `work_item_stage_suggestions`; jamás aplica etapa, crea ni descarga términos. Señales permitidas: número de expediente/radicado de la autoridad, dominio de correo registrado de la autoridad, continuidad de hilo sobre un vínculo ya confirmado. Matchers por nombre: bloqueados. Adjuntos: se reporta lo que exigiría la extracción (OCR de PDF escaneado, cola durable, presupuesto de egreso, política de retención) — **no se improvisa** en esta fase.

## 8. Invariantes del §0 como tests nombrados

- `invariant-1-ai-evidence-threshold` — ninguna sugerencia IA por debajo del umbral se convierte en hecho procesal; siempre queda como sugerencia.
- `invariant-2-term-requires-class-anchor-coverage` — todo término tiene `term_class`, `anchor_kind` resuelto y cobertura de festivos; si falta cualquiera → `NULL` + `requires_manual_review`.
- `invariant-3-no-free-text-stages` — en workflows `catalog_governed`, todo `stage` está en el catálogo; el trigger fail-closed rechaza el resto.
Más: overlay no altera identidad/terminalidad/grafo; alegatos exigen probatorio previo; `SANCION_IMPUESTA` no terminal; caducidad solo se satisface con notificación.

## 9. No-regresión de workflows existentes

CGP, CPACA judicial, TUTELA, EJECUTIVO, LABORAL, PENAL_906, INDETERMINADO: todo lo nuevo es aditivo y filtrado por `workflow_type = 'GOV_PROCEDURE'`. Verificación: snapshot de conteos de `deadline_rules`, etapas y transiciones por workflow antes/después; `anchor_kind` con default que preserva el comportamiento actual; suite completa (1928 tests) en verde.

## 10. Puntos que considero incorrectos, no verificados o inseguros

1. **Art. 49A y la tabla fiscal (Ley 2080)** — las duraciones fiscales del prompt (descargos 5, probatorio ≤10/≤30, alegatos 5, decisión 15, recursos 5) deben verificarse artículo por artículo antes de sembrar; si no las confirmo, `SANCIONATORIO_FISCAL` se siembra como no verificado.
2. **Art. 52 inc. 2 vs art. 86** — la afirmación de que el silencio positivo del recurso desplaza al negativo general es defendible pero discutida; se marca `contested` y exige confirmación manual antes de proponer etapa terminal.
3. **Caducidad de 3 años** — muchísimos regímenes especiales tienen plazos distintos; el valor por defecto solo aplica a `CPACA_GENERAL`.
4. **`AMBIENTAL` y `TRANSITO`** — no verificados; se siembran sin términos computables.
5. **Art. 164 (caducidad judicial)** — no se implementa figura alguna sin verificación previa.
6. **Perfeccionamiento de la notificación por aviso/electrónica** — la fecha efectiva depende de reglas que aún no están modeladas; en esta fase se captura la fecha declarada y se marca revisión manual cuando la modalidad no es personal.
