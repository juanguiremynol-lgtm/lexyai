# Fase 1 — Motor de términos + catálogo de etapas + PETICION

Additive only. CGP, CPACA, TUTELA, EJECUTIVO, LABORAL, PENAL_906, INDETERMINADO no cambian de comportamiento.

## 1. Informe de inspección (verificado en la base ahora)

**Motor de términos**
- `is_business_day_sql(date)` — SQL puro: descarta fines de semana, `colombian_holidays` y `judicial_term_suspensions` con `scope='GLOBAL_JUDICIAL'` **incondicionalmente**. Confirma el hallazgo.
- `add_business_days_sql(date,int)` y `business_days_between_sql(a,b)` lo consumen; `business_days_between_sql` ya tiene guardia de 60 días.
- `compute_deadline_from_rule(anchor, workflow, deadline_type)` lee **solo `deadline_rules`**.
- `colombian_holidays`: 52 filas, 2024-01-01 → 2026-12-25. No hay 2027/2028.

**Las dos tablas de reglas**
- `deadline_rules` (13 col): CGP 9, CPACA 8, LABORAL 6, PENAL_906 3, TUTELA 4, GENERIC 1. Leída por `compute_deadline_from_rule()` y por `evaluate-deadline-alerts`.
- `workflow_deadline_rules` (35 col, 46 filas: LABORAL 19, PENAL_906 17, EJECUTIVO 10). Ningún path de ejecución la lee: solo el hook de UI `use-workflow-deadline-rules.ts` (pantalla de administración) y la función de auditoría `stamp_deadline_term_audit`.
- **Solapamiento real:** LABORAL y PENAL_906 están en ambas. `deadline_rules` es la que efectivamente calcula.
- **Conclusión (a decidir por usted):** `deadline_rules` es hoy la autoritativa de *ejecución*; `workflow_deadline_rules` es un catálogo más rico que quedó desconectado. **Las reglas de PETICION se insertarán en `deadline_rules`**, porque es la única que el motor lee; insertar en la otra produciría reglas inertes. No se migra ni se fusiona nada en esta fase.

**Infraestructura declarativa existente a reutilizar**
- `cgp_term_templates` — ya tiene `pause_on_judicial_suspension`; es el ancla del modelo de clase de término.
- `milestone_mapping_patterns` y `providencia_classification_rules` — idioma de mapeo evento→etapa por `pattern_regex` + `priority`; el vocabulario PETICION seguirá ese mismo idioma.
- `provider_category_policies_global` / `_org_override` — patrón de tenencia global + override por organización que copiaremos.
- `work_item_tracks` — existe, 0 filas; no se toca en esta fase.
- Relación petición↔tutela: `work_item_successions` ya tiene `relation_type` y estado de confirmación. **Se reutiliza** (nuevo valor `TUTELA_POR_SILENCIO`), no se crea tabla nueva. `work_item_external_links` es solo URLs; no sirve.
- `work_item_stage_suggestions` existe con `suggested_stage`/`status`/`confidence`; se le añade `stage_id` nullable.
- Correo: la tabla real es `work_item_email_links` (metadata + `web_link` + `evidence_type`/`confidence`), no almacena cuerpos. Se mantiene.
- Existe la tabla legada `peticiones` (con `phase peticion_phase` de 4 valores) y `peticion-reminders`. **Hoy no hay ningún `work_item` con `workflow_type='PETICION'`**. El catálogo nuevo gobierna work items; la tabla legada se deja intacta y se reporta como deuda a resolver en otra fase.

## 2. P0 — Remediación del motor

1. **Clase de término.** Enum `term_class` (`JUDICIAL`,`ADMINISTRATIVO`). Nuevas sobrecargas `is_business_day_sql(date, term_class)` y `add_business_days_sql(date, int, term_class)`; `ADMINISTRATIVO` ignora `judicial_term_suspensions`. Las firmas de un/dos argumentos quedan idénticas y delegan con `JUDICIAL`. `deadline_rules` gana `term_class` (default `JUDICIAL`), alineado con `cgp_term_templates.pause_on_judicial_suspension`.
2. **Festivos.** Insertar 2027 y 2028 (Ley 51/1983 + Emiliani + móviles pascuales). Guardia de cobertura: si la caminata supera `max(holiday_date)`, la función levanta excepción y `compute_deadline_from_rule` devuelve `requires_manual_review = true` en vez de una fecha errónea. Chequeo programado diario que emite `system_health_events` WARN con menos de 12 meses de margen.
3. **Guardia de cero días.** `CHECK` en `deadline_rules`: `days_amount > 0 OR requires_manual_review = true`. Las filas actuales ya cumplen.

## 3. Catálogo de flujos y etapas (aditivo)

Cuatro tablas nuevas, con `is_system` + override por organización:
- `workflow_definitions` — una fila por `workflow_type`, con `catalog_governed` (`true` solo para PETICION).
- `workflow_stages_global` (+ `workflow_stages_org_override` para etiqueta y orden únicamente) — `code`, `label` ES, `display_order`, `is_terminal`, `is_procedurally_live`, `expected_next_event`, `legal_basis`.
- `workflow_stage_transitions` — `from_stage` → `to_stage`, `allowed_by_suggestion`, `requires_explicit_user_action`, `is_regression_allowed`.
- `workflow_event_stage_patterns` — `pattern_regex`, `pattern_keywords`, `base_confidence`, `priority`, `suggested_stage_code`, `is_excluded` (para acuses, fuera de oficina, confirmaciones de lectura).

Compatibilidad: no se añade un segundo campo de etapa. Trigger `enforce_catalog_stage` sobre `work_items` que **solo** valida cuando `workflow_definitions.catalog_governed = true` (hoy PETICION); para el resto es pass-through literal. `work_item_stage_suggestions` gana `stage_id uuid` nullable; `suggested_stage` sigue poblándose.

## 4. PETICION — datos semilla

- `peticion_subtypes` (catálogo): `GENERAL` 15 hábiles, `DOCUMENTOS_INFORMACION` 10, `CONSULTA` 30, `ENTRE_AUTORIDADES` 10, `NORMA_ESPECIAL` (término y `legal_basis` obligatorios ingresados por el usuario). Todos con `legal_basis` poblado y `term_class = ADMINISTRATIVO`.
- Consecuencia art. 14 num. 1: al vencer sin respuesta en `DOCUMENTOS_INFORMACION` se crea un **término derivado de 3 días** para entrega de copias (regla propia, no bandera de vencido).
- 15 etapas del catálogo tal como usted las listó, con `legal_basis` en cada fila; transiciones sembradas (p. ej. `RESPUESTA_PARCIAL → RESPUESTA_DE_FONDO` solo por acción explícita del usuario).
- Anclas: se guardan fecha de envío y fecha de recepción, y `anchor_source` con nota de procedencia. Traslado art. 21 crea una **nueva instancia de término** enlazada a la anterior (`supersedes_deadline_id`), nunca sobrescribe. Art. 17 se modela como suspensión + reactivación. Prórroga art. 14 par.: validación de techo (≤ doble del término inicial) y de comunicación previa al vencimiento; si falla, se marca defectuosa.
- Eventos sin correo: vencimiento del término (aplica automáticamente `TERMINO_VENCIDO_SIN_RESPUESTA` con `change_source='SYSTEM_DEADLINE'` en la auditoría) y silencio negativo (3 meses calendario, CPACA art. 83; 1 mes después de vencido cuando la norma especial fija término mayor) con evento + alerta accionable.
- Tutela: work item aparte, ligado por `work_item_successions` con `relation_type='TUTELA_POR_SILENCIO'`. Sin fusión ni escritura cruzada.

## 5. Correo — conservador

La evidencia de correo para PETICION solo crea una fila en `work_item_stage_suggestions`. Nunca aplica etapa, ni crea ni cierra términos. Matchers permitidos: número de radicado asignado por la autoridad, dominio de correo registrado de la entidad, y continuidad de hilo ya confirmada. `CLIENTE` y `PARTE` quedan bloqueados por regla explícita. Acuses, lecturas y fuera-de-oficina se clasifican y se descartan de forma visible. Adjuntos fuera de alcance.

## 6. Verificación de no regresión

- Snapshot antes/después de `compute_deadline_from_rule()` para las 31 filas vivas de `deadline_rules` en los siete flujos existentes: fechas idénticas.
- Prueba de que `is_business_day_sql(date)` y `add_business_days_sql(date,int)` devuelven exactamente lo mismo que hoy sobre un rango de 2024-2026 (la suspensión activa sigue aplicando en modo JUDICIAL).
- Prueba de que el trigger de etapa es pass-through: escrituras con etapas actuales de CGP/CPACA/EJECUTIVO/TUTELA/LABORAL/GOV_PROCEDURE siguen pasando.
- Suite completa (≈1.909 pruebas) verde.

## 7. Objeciones y ambigüedades que debe decidir

1. **`GENERAL` = 15 días.** El art. 14 inc. 1 fija 15 días como regla general; lo dejamos configurable por subtipo, pero conviene confirmar que no quiere el término de 15 días también parametrizable por organización.
2. **`ENTRE_AUTORIDADES` = 10 días.** El art. 30 fija 10 días; algunos autores lo leen como término máximo prorrogable. Lo sembramos como 10 hábiles fijos.
3. **`TERMINO_VENCIDO_SIN_RESPUESTA` no terminal** y `SILENCIO_NEGATIVO` no terminal: correcto, pero significa que una petición puede quedar viva indefinidamente. Propongo un archivado por inactividad **manual**, nunca automático.
4. **Tabla legada `peticiones`** con su propio enum de 4 fases y su cron `peticion-reminders`: quedará conviviendo con el catálogo nuevo. Es una segunda fuente de verdad para peticiones. Recomiendo planificar su retiro; no lo hago aquí.
5. **`workflow_deadline_rules` desconectada** (46 filas que nadie evalúa) es un riesgo latente: la pantalla de administración deja editar reglas que no producen ningún efecto. Reportado, no tocado.
6. **Silencio negativo y norma especial**: la regla "1 mes después de vencido el término especial" requiere que `NORMA_ESPECIAL` registre el término; si el usuario no lo ingresa, el silencio se marca `requires_manual_review` en vez de calcularse.
