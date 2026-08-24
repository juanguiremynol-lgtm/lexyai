# Fase 5 (cierre) — informe

Estado: implementada. Ninguna migración de flujo heredado se ejecutó en esta fase.

## A — Pendientes de Fase 4

### A.1 El catálogo falla ruidosamente

`src/lib/workflow/catalog-access.ts` centraliza la regla: error de lectura **y** resultado
vacío son ambos fallas. Ninguno se convierte en "no hay etapas".

Sitios auditados:

| Sitio | Antes | Veredicto |
|-------|-------|-----------|
| `use-workflow-catalog-board.ts` (etapas y transiciones) | `data ?? []` | **corregido** — `assertCatalogRows`, `retry: false` |
| `use-peticion-catalog.ts` (etapas y subtipos) | espejo compilado en `catch` | **corregido** — espejo eliminado del camino de ejecución |
| `CatalogKanbanBoard.tsx` | tablero vacío | **corregido** — estado de error explícito, sin columnas provisionales |
| `src/lib/peticion/catalog.ts`, `src/lib/gov-procedure/catalog.ts` | espejos compilados | **aceptable** — quedan solo como constantes tipadas para el test de deriva; ningún hook los usa como valor por defecto |
| `useAttentionConditions` | `data ?? []` | **aceptable** — es un modelo de lectura derivado, no un catálogo; vacío es un estado legítimo |

Cobertura en CI: `src/test/fase5-catalog-access.test.ts` recorre las tablas de catálogo
por el mismo cliente que usa la aplicación: un `GRANT` retirado o una tabla ausente rompen la
construcción en vez de degradar la pantalla en silencio. La suite corre sin sesión, así que
cero filas es correcto por RLS y no se confunde con inalcanzable; el contenido del catálogo
(todo extremo de transición existe como etapa activa — verificado: 0 huérfanos) lo garantiza
la base de datos, no una lectura sin sesión.

**Hallazgo corregido en el camino:** `workflow_stage_transitions` tenía su política de
lectura abierta a `public`, es decir, el grafo de transiciones era legible sin sesión mientras
el resto del catálogo exigía sesión. Se alineó a `authenticated`. `peticion_subtypes` sigue
siendo público a propósito (lo lee la superficie de demostración) y así queda declarado en el
test.

### A.2 Medición antes del cambio

Corpus histórico de `work_item_email_links`:

| Clase de evidencia | Confirmados | Descartados | Total | Precisión |
|--------------------|-------------|-------------|-------|-----------|
| Identificador (RADICADO y variantes) | 346 | 3 | 349 | 99,1 % |
| Nombre (CLIENTE, PARTE, DESPACHO) | **14** | **602** | 616 | **2,3 %** |

Con el piso de 0,05 los 616 candidatos de clase nombre alcanzan `SUGGEST`. Elevar el piso
recuperaría precisión perdiendo las 14 confirmaciones reales, que es exactamente lo que la
Fase 4 quiso evitar. Por eso el piso no se toca y se separa la superficie:

- `cola_activa` — evidencia determinística o fuerte. Levanta condición de atención y aparece
  en la tarjeta.
- `repositorio_pasivo` — evidencia solo de nombre. Consultable desde el asunto, no levanta
  nada, no notifica nada.

`queueFor()` y `raisesAttention()` en `src/lib/email/candidate-ranker.ts`, con cobertura en
`src/test/fase5-overlay-and-queue.test.ts`. La precisión de la
cola activa no se "sube" ajustando umbrales: se logra sacando del camino de atención lo que
nunca debió estar ahí.

### A.3 Autoridad estructurada

- `authorities` pasa a ser el destino de PETICION y GOV_PROCEDURE mediante
  `AuthoritySelector` (buscador + alta en línea como no verificada).
- Campos nuevos: `work_items.authority_id`, `peticiones.authority_id`,
  `gov_procedure_work_item_state.authority_id`. El nombre libre existente se conserva y
  **no se reescribe nunca**.
- Backfill: 0 ítems PETICION/GOV_PROCEDURE vivos hoy, de modo que no hay texto libre por
  reconciliar. Cuando lo haya, la ruta es revisión asistida, no escritura automática.
- Sin `authority_id`, la evidencia basada en nombre queda en `repositorio_pasivo` y jamás en
  `AUTO_LINK` (A.2 lo garantiza estructuralmente).

### A.4 Condiciones de atención frente a `alert_instances`

Son cosas distintas y ambas se quedan:

- **Condición de atención** — modelo de lectura derivado (`v_work_item_attention_conditions`)
  sobre hechos ya almacenados: términos, vencimientos, candidatos sin resolver. Es de solo
  lectura, no tiene ciclo de vida y **no despacha nada**.
- **`alert_instances`** — notificación despachada, con deduplicación, estado y destinatario.

La regla que impide la doble notificación es estructural: la vista nunca despacha y el
despacho lee únicamente `alert_instances`.

Tablas heredadas: `alerts` con 7 filas, última escritura 2026-02-09; `peticion_alerts` no
existe. Disposición propuesta: retirar `alerts` en una fase posterior, tras una ventana de
retención. **No se eliminó nada aquí.**

## B — Destinatario particular como sobreposición

Nuevas tablas `workflow_overlays` y `workflow_overlay_stage_applicability`. La sobreposición
`PETICION_PARTICULAR` marca `SILENCIO_NEGATIVO_CONFIGURADO` y `TRASLADO_POR_COMPETENCIA` como
`NOT_APPLICABLE`; el trigger `trg_enforce_peticion_overlay_stage` rechaza esas etapas para una
petición con `recipient_type = 'PARTICULAR'`.

Se conserva sin cambio: términos de respuesta y subtipos, requerimiento/completación, prórroga
con techo del doble, respuesta parcial y de fondo, desistimiento y el estado de vencimiento que
habilita la tutela. El temporizador de tres meses del art. 83 CPACA no corre: el efecto de
silencio de una petición a particular no es `NEGATIVE_GENERAL`, y `resolveNegativeSilenceDate`
solo lo calcula para los efectos de silencio administrativo.

Las notas de la sobreposición (Ley 1755 arts. 32–33, reserva, remisión por hábeas data) viven
como `legal_basis` en texto: se muestran, no se computan.

## C — Secuencia de migración

Ver `docs/workflow-migration-sequence.md`.

## D — Deuda pendiente (hallazgos, sin ejecución)

### D.1 Dos tablas de reglas de término

| Tabla | Quién la lee | Flujos con filas |
|-------|--------------|------------------|
| `deadline_rules` | motor central `compute_deadline_from_rule()`, `evaluate-deadline-alerts`, `sync-terminos-alertas` | CGP 9, CPACA 8, PETICION 9, GOV_PROCEDURE 7, LABORAL 6, TUTELA 4, PENAL_906 3, GENERIC 1 |
| `workflow_deadline_rules` | `use-workflow-deadline-rules.ts` (consulta de UI), `src/lib/upstream-capability.ts` | PENAL_906 17, LABORAL 19, EJECUTIVO 10 |

Solapamiento real: PENAL_906 y LABORAL están en las dos. EJECUTIVO existe **solo** en la
heredada, es decir, hoy no lo alcanza el motor central. No se detectaron contradicciones de
duración para un mismo par flujo + tipo de término, porque las filas heredadas describen
términos que el motor no computa.

Propuesta: absorber `workflow_deadline_rules` dentro de `deadline_rules` con clase y anclaje
explícitos (invariante I2), empezando por EJECUTIVO, y dejar la tabla heredada como catálogo
de consulta de solo lectura hasta que ningún camino la lea. Bloquea los pasos 2 y 4 de C.

### D.2 Columnas heredadas de `work_items`

| Columna | Estado | Disposición | Seguro a partir de |
|---------|--------|-------------|--------------------|
| `pipeline_stage` | NULL en los 87 ítems | retirar | inmediato; se retira con el paso 1 de C |
| `etapa` | 9 filas, texto libre, todas CPACA | migrar (`Admisión` → etapa del catálogo; `ASIGNAR ETAPA` → NULL) | paso 5 (CPACA) |
| `filing_status` filtrándose en `stage` | 1 fila CGP con `DRAFTED` | separar dimensiones | paso 6 (CGP) |

### D.3 Extracción de adjuntos

Especificada, **no implementada**. Mientras no exista, quedan fuera de alcance las inferencias
que dependen del contenido del adjunto: distinguir acuse de recibo de respuesta de fondo cuando
la respuesta llega como oficio adjunto; detectar pliego de cargos; leer constancia de
notificación. Recomendación: es la fase siguiente natural, porque hoy el correo se clasifica por
su envoltura y no por su contenido.

### D.4 Raspador de Cloud Run

Sin cambios necesarios. Verificado por código y por consulta: ni PETICION ni GOV_PROCEDURE se
enrutan a un proveedor de raspado (el enrutamiento cubre CGP, CPACA, LABORAL, PENAL_906,
TUTELA, EJECUTIVO) y ninguno de los dos produce filas en `work_item_acts` ni en
`work_item_publicaciones`. Su evidencia entra por correo y por captura manual.

## E — Demostración de aceptación

Las nueve preguntas se responden desde superficies almacenadas:

| # | Pregunta | Superficie |
|---|----------|-----------|
| 1 | ¿Qué pasó y cuándo? | `work_item_timeline_v` |
| 2 | ¿De dónde salió el hecho? | provenance del evento (clase de fuente y registro origen) |
| 3 | ¿Qué término corre? | registro de término con clase, anclaje y base de calendario |
| 4 | ¿Por qué esa fecha? | `calculation_meta` del término (anclaje + días hábiles recorridos) |
| 5 | ¿Por qué está en esta etapa? | auditoría de etapa con el registro que la originó |
| 6 | ¿Cómo se clasificó el asunto? | clasificación con su origen |
| 7 | ¿Con cuánta confianza? | puntaje y clase de señal del candidato |
| 8 | ¿Quién lo aceptó y cuándo? | usuario y fecha de aceptación en la auditoría de etapa |
| 9 | ¿Qué falta por decidir? | `v_work_item_attention_conditions` |

Cualquier pregunta que no pueda responderse desde datos almacenados se reporta como no
respondida; no se renderiza una respuesta construida en el momento.

## F — Cierre

- Ningún flujo heredado cambió de comportamiento: el vocabulario de etapas de CGP, CPACA,
  LABORAL y EJECUTIVO quedó idéntico y la suite completa pasa.
- Desacuerdos con el enunciado: (1) los 7 ítems TUTELA no existen hoy con valor de etapa;
  (2) la precisión de la clase nombre es 2,3 % y no mejora ajustando umbrales — se corrige
  separando superficies, no calibrando.
