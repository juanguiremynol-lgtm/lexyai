# Fase 5 / C — Secuencia de migración de los siete flujos restantes

Clasificación únicamente. **Ninguna migración se ejecuta en esta fase**: aquí quedan el
orden, el vocabulario real y el riesgo por flujo. Todas las cifras salen de
`work_items` con `deleted_at IS NULL` al cierre de Fase 5.

Flujos ya gobernados por catálogo: `PETICION` (15 etapas), `GOV_PROCEDURE` (20 etapas).

## Orden propuesto

| # | Flujo | Ítems con etapa | Bloqueo | Motivo del orden |
|---|-------|-----------------|---------|------------------|
| 1 | PENAL_906 + INDETERMINADO | 0 | ninguno | Sin vocabulario vivo: la migración es puro alta de catálogo, riesgo nulo. |
| 2 | LABORAL | 1 | D.1 | Un solo ítem, pero sus términos viven en `workflow_deadline_rules` (19 filas): migrar antes de reconciliar duplicaría la fuente. |
| 3 | TUTELA | 0 | ninguno | Sin etapas en uso hoy (ver reserva abajo). Catálogo nuevo, sin remapeo. |
| 4 | EJECUTIVO | 6 | D.1 | Vocabulario pequeño y coherente; 10 filas en `workflow_deadline_rules`. |
| 5 | CPACA judicial | 12 | `etapa` (D.2) | Enum `cpaca_phase` paralelo y 9 filas con `etapa` en texto libre. |
| 6 | CGP | 34 | `filing_status` (D.2) | El más grande y el más fragmentado; además enum `cgp_phase` y `cgp_term_templates` en producción. |

## Vocabulario por flujo

### PENAL_906 e INDETERMINADO
Cero ítems con etapa. Sin duplicados, sin valores inválidos, sin remapeo. Riesgo de
regresión: **nulo**. Sí existen 17 filas de `workflow_deadline_rules` para PENAL_906 que
deben quedar apuntadas al catálogo nuevo en el mismo paso.

### LABORAL
`RADICACION` (1). Sin duplicados. Mapeo directo a una etapa `RADICACION` del catálogo.
Riesgo: **bajo**, condicionado a D.1 (19 reglas en la tabla heredada).

### TUTELA
Sin etapas en uso. **Reserva:** el enunciado de la fase menciona 7 ítems TUTELA; hoy no hay
ninguno con valor de etapa en el conjunto no eliminado. La clasificación se hace sobre lo
que la tabla contiene y la discrepancia se reporta, no se supone resuelta.

### EJECUTIVO
`MANDAMIENTO_PAGO` (3), `NOTIFICACION_MANDAMIENTO` (1), `RADICACION` (1), `PREPARACION` (1).
Vocabulario coherente, sin duplicados. Mapeo uno a uno. Riesgo: **bajo**.

### CPACA judicial
`RECURSOS` (4), `AUTO_ADMISORIO` (3), `TRASLADO_EXCEPCIONES` (2), `AUDIENCIA_PRUEBAS` (1),
`ALEGATOS_SENTENCIA` (1), `DEMANDA_RADICADA` (1).
- Dimensión paralela: enum `cpaca_phase` (14 valores) usado por el módulo CPACA.
- Texto libre residual: 9 filas con `etapa` (`Admisión` ×7, `ASIGNAR ETAPA` ×2). `ASIGNAR
  ETAPA` no es una etapa: es ausencia de clasificación y debe migrarse a NULL, nunca a una
  etapa inventada.
- Riesgo: **medio**. Requiere decidir si el catálogo sustituye a `cpaca_phase` o si el enum
  pasa a ser una proyección del catálogo.

### CGP
13 valores distintos sobre 34 ítems. Problemas concretos:

| Situación | Valores | Tratamiento propuesto |
|-----------|---------|-----------------------|
| Duplicado por sufijo | `RADICADO` (5) / `RADICADO_CONFIRMED` (3) | Colapsar en `RADICADO`; la confirmación es un atributo de `filing_status`, no una etapa. |
| Solapamiento de admisión | `ADMISION` (2) / `ADMISION_PENDIENTE` (1) / `AUTO_ADMISORIO` (2) | `AUTO_ADMISORIO` es el hecho; `ADMISION_PENDIENTE` es espera. Colapsar en dos etapas: `PENDIENTE_ADMISION` y `ADMITIDA`. |
| Otra dimensión | `DRAFTED` (1) | No es etapa: es `filing_status`. Se retira del campo `stage` en la migración de CGP. |
| Etapa vs. objeto | `CUADERNO` (3) | No es una etapa procesal; corresponde a organización documental. Requiere decisión antes de migrar. |
| Vocabulario válido | `SUBSANACION`, `SANEAMIENTO`, `NOTIFICACION`, `CONTESTACION`, `AUDIENCIA_INICIAL`, `SENTENCIA` | Mapeo uno a uno. |

Además: enum `cgp_phase` (`FILING`/`PROCESS`) y `cgp_term_templates` **en producción**. La
migración de CGP no puede tocar el cómputo de términos existente; el catálogo entra como
dimensión de etapa y los términos siguen resolviéndose por las plantillas hasta que D.1 se
cierre.

## Regla común a los seis pasos

1. Alta del catálogo (`workflow_stages_global` + `workflow_stage_transitions`) sin tocar datos.
2. Tabla de mapeo explícita (`workflow_stage_code_mappings`) valor viejo → código nuevo, con
   los valores que van a NULL declarados como tales.
3. Migración de datos y activación del guard de texto libre (invariante I3) en el mismo paso.
4. Verificación: cero valores fuera del catálogo, cero cambios en términos vigentes.
