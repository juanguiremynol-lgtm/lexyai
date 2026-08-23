# Fase 1 — Motor de términos + catálogo multidimensional + PETICION

Aditivo. CGP, CPACA, TUTELA, EJECUTIVO, LABORAL, PENAL_906, INDETERMINADO no cambian de comportamiento.

Regla estructural que gobierna todo el diseño:

```text
PROCEDURAL STAGE  = dónde está la petición
EVENT             = qué ocurrió
DEADLINE          = qué término corre
DEADLINE STATUS   = vigente | próximo | vencido | suspendido | supersedido
LEGAL EFFECT      = aceptación por silencio, silencio negativo, etc.
ATTENTION STATUS  = qué requiere actuación del bufete
LIFECYCLE STATE   = activa | finalizada | archivada
```

## 1. Inspección (verificada en la base)

- `is_business_day_sql(date)` aplica `judicial_term_suspensions` (`GLOBAL_JUDICIAL`) incondicionalmente. `add_business_days_sql` y `business_days_between_sql` lo consumen.
- `compute_deadline_from_rule()` lee **solo `deadline_rules`** (31 filas: CGP 9, CPACA 8, LABORAL 6, PENAL_906 3, TUTELA 4, GENERIC 1). También la lee `evaluate-deadline-alerts`.
- `workflow_deadline_rules` (46 filas: LABORAL 19, PENAL_906 17, EJECUTIVO 10) **no la consume ninguna ruta de cálculo**: solo el hook de administración `use-workflow-deadline-rules.ts` y `stamp_deadline_term_audit`. Queda marcada como **DEUDA TÉCNICA** documentada; no recibe reglas de PETICION y no se migra en esta fase.
- `colombian_holidays`: 52 filas, 2024-01-01 → 2026-12-25.
- Reutilizables: `cgp_term_templates` (`pause_on_judicial_suspension`), `milestone_mapping_patterns` y `providencia_classification_rules` (idioma regex+prioridad), `provider_category_policies_global`/`_org_override` (patrón de tenencia), `work_item_stage_suggestions`, `work_item_successions` (relación petición↔tutela), `work_item_email_links` (metadata + `web_link`, sin cuerpos).
- No existe ningún `work_item` con `workflow_type='PETICION'`. La tabla legada `peticiones` está vacía de uso.

## 2. P0 — Motor de términos

**2.1 Clase de término.** Enum `term_class` (`JUDICIAL`,`ADMINISTRATIVO`). Sobrecargas nuevas `is_business_day_sql(date, term_class)` y `add_business_days_sql(date, int, term_class)`; `ADMINISTRATIVO` observa fines de semana y `colombian_holidays` pero **no** `judicial_term_suspensions`. Las firmas actuales quedan idénticas y delegan con `JUDICIAL`. `deadline_rules` gana `term_class` con default `JUDICIAL`, alineado con `pause_on_judicial_suspension`.

**2.2 Cobertura de festivos — por período, no por fecha máxima.** Nueva tabla `holiday_calendar_coverage(year, country, coverage_status, generated_at, verified_at)`. La caminata verifica que **todos los años que atraviesa** tengan `coverage_status='COMPLETE'`; si alguno falta o está `PARTIAL`, el cálculo no devuelve fecha: `requires_manual_review = true`. Se cargan 2027 y 2028 (Ley 51/1983, Emiliani, móviles pascuales) y se marcan `COMPLETE`; 2024-2026 se marcan `COMPLETE` tras verificación. El chequeo de salud diario cuenta **años completos de margen** y emite `system_health_events` WARN por debajo de 12 meses.

**2.3 Guardia de cero días.** `CHECK` en `deadline_rules`: `days_amount > 0 OR requires_manual_review = true`.

## 3. Catálogo multidimensional (aditivo)

- `workflow_definitions` — una fila por `workflow_type`, con `catalog_governed` (`true` solo para PETICION).
- `workflow_stages_global` + `workflow_stages_org_override` — el override alcanza **solo etiqueta, orden y preferencias de visualización/alerta**; nunca clasificación terminal, duración legal ni `legal_basis`.
- `workflow_stage_transitions` — `from_stage`→`to_stage`, `allowed_by_suggestion`, `requires_explicit_user_action`, `is_regression_allowed`.
- `workflow_event_catalog` — vocabulario de eventos (dimensión EVENT), separado de las etapas.
- `workflow_event_stage_patterns` — `pattern_regex`, `pattern_keywords`, `base_confidence`, `priority`, `suggested_stage_code`, `is_excluded` (acuses, lecturas, fuera de oficina).
- Dimensiones paralelas sobre el work item de PETICION: `deadline_status`, `legal_effect`, `attention_status`; `lifecycle_state` ya existe y es donde vive el archivado.

**Compatibilidad.** No se añade un segundo campo de etapa: `work_items.stage` sigue siendo la proyección operativa. Trigger `enforce_catalog_stage` que valida **solo** cuando `catalog_governed = true` (hoy PETICION) y es pass-through literal para todos los demás flujos. `work_item_stage_suggestions` gana `stage_id uuid` nullable; `suggested_stage` sigue poblándose.

## 4. PETICION — subtipos (system-owned, sin override de duración)

| Código | Término | Unidad | Fundamento |
|---|---|---|---|
| `GENERAL` | 15 | días hábiles | L.1755 art. 14 inc. 1 |
| `DOCUMENTOS_INFORMACION` | 10 | días hábiles | L.1755 art. 14 num. 1 |
| `CONSULTA` | 30 | días hábiles | L.1755 art. 14 num. 2 |
| `ENTRE_AUTORIDADES_INFO_DOCUMENTOS` | 10 | días hábiles | L.1755 art. 30 |
| `NORMA_ESPECIAL` | configurable | configurable | norma legal especial |

`term_class = ADMINISTRATIVO` en todas (L.4 de 1913 art. 62). Los cuatro primeros son `is_system = true` y **no admiten override organizacional de duración**.

`ENTRE_AUTORIDADES` no existe como subtipo genérico de 10 días. Se conserva únicamente como **atributo descriptivo** (`is_inter_authority`) y, cuando el objeto no es información/documentos, exige un subtipo del art. 14 que determine si son 10, 15, 30 o norma especial.

`NORMA_ESPECIAL` exige norma citada, cantidad, unidad, `legal_basis` y `silence_effect` ∈ {`NEGATIVE_GENERAL`,`POSITIVE_SPECIAL`,`NEGATIVE_SPECIAL`,`NONE`,`MANUAL_REVIEW`}.

## 5. Etapas procedimentales de PETICION (reclasificadas)

Solo estados de *dónde está* la petición:

| Código | Etiqueta | Terminal |
|---|---|---|
| `BORRADOR` | Borrador | no |
| `RADICADA` | Radicada | no |
| `PENDIENTE_RESPUESTA` | Pendiente de respuesta | no |
| `AWAITING_PETITIONER_COMPLETION` | En espera de complementación del peticionario | no |
| `TRASLADO_POR_COMPETENCIA` | Trasladada por competencia | no |
| `RESPUESTA_PARCIAL` | Respuesta parcial | no |
| `RESPUESTA_DE_FONDO` | Respuesta de fondo | sí |
| `DESISTIMIENTO_DECRETADO` | Desistimiento decretado y archivo | sí |
| `DESISTIMIENTO_EXPRESO` | Desistimiento expreso | sí |
| `DEVUELTA_PARA_ACLARACION` | Devuelta para aclaración | no |
| `RECHAZADA` | Rechazada | sí |

**Eliminadas como etapas** (pasan a otras dimensiones): `PRORROGA`, `TERMINO_VENCIDO_SIN_RESPUESTA`, `SILENCIO_NEGATIVO`, `ARCHIVADA` (esta última pasa a `lifecycle_state`, siempre por acción humana).

`RESPUESTA_DE_FONDO` nunca se infiere de la llegada de un mensaje: una respuesta evasiva o incongruente entra como `RESPUESTA_PARCIAL` y requiere confirmación humana para promoverse.

## 6. Eventos, términos y efectos legales

**Vencimiento del término ordinario.** La etapa sigue en `PENDIENTE_RESPUESTA`. Se emite evento `RESPONSE_TERM_EXPIRED`, `deadline_status = OVERDUE`, `attention_status = ACTION_REQUIRED` y las acciones disponibles que correspondan (`EVALUAR_TUTELA`, `RECURSOS`, `MEDIO_DE_CONTROL`).

**Documentos/información (art. 14 num. 1).** Al vencer los 10 días sin respuesta se emite `REQUEST_DEEMED_ACCEPTED` (silencio positivo especial, **no** `SILENCIO_NEGATIVO`) y se crea el término derivado `DOCUMENT_DELIVERY_AFTER_DEEMED_ACCEPTANCE = 3 días hábiles`, **anclado al vencimiento de los 10 días**, no a la fecha de detección. Para este subtipo no se arma el timer general del art. 83 como consecuencia primaria.

**Silencio negativo (CPACA art. 83).** Regla ordinaria: 3 meses calendario desde la presentación. Regla del mes adicional **solo** si una ley fija plazo superior a 3 meses. Si el término especial ≤ 3 meses, rige la regla ordinaria. Si la norma prevé silencio positivo, prevalece. Si la configuración es insuficiente, `requires_manual_review = true`. El silencio no exonera del deber de decidir: el work item sigue vivo y la etapa no cambia.

**Art. 17 (complementación).** `REQUERIMIENTO_COMPLETACION_RECEIVED` → etapa `AWAITING_PETITIONER_COMPLETION`, término de decisión **suspendido**. Eventos posteriores: `COMPLETION_SUBMITTED` (reactiva desde el día siguiente), `COMPLETION_EXTENSION_REQUESTED` (mes adicional, pedido antes del vencimiento), `COMPLETION_TERM_EXPIRED` (solo habilita a la administración). La etapa pasa a `DESISTIMIENTO_DECRETADO` **únicamente** al registrarse el acto administrativo motivado; se anota que procede reposición.

**Art. 21 (competencia).** Dos términos distintos: `TRANSFER_DUE` = 5 días hábiles desde la recepción por la autoridad incompetente; y, al conocerse la recepción por la competente, un **nuevo** `RESPONSE_DUE` con `anchor = COMPETENT_AUTHORITY_RECEIPT`, enlazado por `supersedes_deadline_id`. Nunca se recalcula ni se edita el término original.

**Art. 14 par. (prórroga).** Evento `EXTENSION_NOTIFIED`; el término original pasa a `SUPERSEDED_BY_EXTENSION`; se crea el término prorrogado con `extension_validity` ∈ {`VALID`,`LATE`,`EXCEEDS_CAP`,`INCOMPLETE`,`MANUAL_REVIEW`} (techo: no exceder el doble del inicial; comunicación previa al vencimiento). La etapa procedimental no cambia de nombre.

**Anclas.** Se guardan fecha de envío y fecha de recepción por la autoridad, con `anchor_source` y nota de procedencia; el cómputo indica cuál usó.

**Tutela.** Work item aparte (`workflow_type='TUTELA'`) ligado por `work_item_successions` con `relation_type='TUTELA_POR_SILENCIO'`. Sin fusión ni escritura cruzada; la petición sigue evolucionando.

## 7. Tabla legada `peticiones` — congelada

Se documenta como `LEGACY / DO_NOT_USE`: ninguna feature nueva de PETICION escribe en ella ni lee su `phase` para determinar estado. Se retira `peticion-reminders` de toda ruta que pueda alcanzar los nuevos work items (se limita explícitamente a filas de la tabla legada, que están vacías de uso).

## 8. Correo — conservador

Solo crea filas en `work_item_stage_suggestions`; nunca aplica etapa ni crea/cierra términos. Escala de evidencia:

- radicado de la entidad + contexto compatible → alta confianza
- hilo previamente confirmado → alta confianza
- dominio de entidad + radicado → fuerte
- dominio de entidad solo → candidato, **nunca** autoasociación
- `CLIENTE` / `PARTE` → bloqueados como match principal, insuficientes por sí solos
- cualquier ambigüedad → revisión humana

Acuses de recibo, confirmaciones de lectura y fuera-de-oficina se clasifican en el vocabulario de eventos y se descartan de forma visible. Adjuntos fuera de alcance; se reportará qué haría falta.

## 9. Verificación de no regresión

- Snapshot antes/después de `compute_deadline_from_rule()` sobre las 31 filas vivas: fechas idénticas.
- Igualdad exacta de `is_business_day_sql(date)` y `add_business_days_sql(date,int)` sobre 2024-2026 (la suspensión activa sigue aplicando en modo JUDICIAL).
- Trigger de etapa pass-through comprobado con las etapas vivas de CGP, CPACA, EJECUTIVO, TUTELA, LABORAL y GOV_PROCEDURE.
- Suite completa (~1.909 pruebas) verde.

## 10. Puntos que siguen abiertos

1. `workflow_deadline_rules`: 46 reglas editables desde la UI de administración que no producen ningún efecto. Deuda declarada; decisión (promover o retirar) en fase posterior.
2. `attention_status` y `legal_effect` como dimensiones nuevas requerirán superficie de UI; en esta fase se modelan en datos y se exponen mínimamente, sin rediseño de Kanban.
3. `GOV_PROCEDURE` queda fuera, con 2 work items vivos y sin catálogo.
