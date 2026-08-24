# Corrección: el Dashboard no usa el tablero de catálogo

## 1. Inventario de superficies que muestran etapas/pipelines

| Superficie (ruta) | Componente | Fuente de etapas | Fuente de datos |
|---|---|---|---|
| `/app/dashboard?tab=cgp` | `WorkItemPipeline` | `workflow-constants` (código) | `work_items` |
| `?tab=ejecutivo` | `WorkflowPhaseBoard` | `workflow-phases.ts` (código) | `work_items` |
| `?tab=laboral` | `LaboralPipeline` | `LABORAL_STAGES` (código) | `work_items` |
| `?tab=penal` | `PenalPipeline` | `PENAL_STAGES` (código) | `work_items` |
| `?tab=cpaca` | `CpacaPipeline` | `CPACA_STAGES` (código) | `work_items` |
| `?tab=administrativos` | `AdminPipeline` | `GOV_PROCEDURE_STAGES` (9 etapas en código) | `work_items` |
| `?tab=peticiones` | `PeticionesPipeline` | `PETICION_PHASES` (4 fases, enum `peticion_phase`) | tabla `peticiones` |
| `?tab=tutelas` | `TutelasPipeline` | constantes de código | `work_items` |
| `?tab=por-clasificar` | `UnclassifiedTray` | sin etapas | `work_items` |
| `/app/cpaca` | `CpacaPipeline` | constantes de código | `work_items` |
| `/app/peticiones/:id` | `WorkItemDetailPage` | catálogo/detalle | `work_items` |
| `PeticionDetail.tsx` (legado) | selector de fase | `PETICION_PHASES` | tabla `peticiones` |
| Tablero de catálogo | `CatalogKanbanBoard` | `workflow_stages_global` + `workflow_stage_transitions` | consumidor le pasa los ítems |

Ninguna superficie del Dashboard consume hoy `CatalogKanbanBoard`: se construyó en Fase 4 pero quedó sin conectar.

Hechos verificados en base de datos:
- Catálogo: `PETICION` 15 etapas activas, `GOV_PROCEDURE` 20 etapas activas.
- `work_items` con `workflow_type='PETICION'`: **0**. Tabla `peticiones`: **0 filas**.
- `work_items` con `workflow_type='GOV_PROCEDURE'`: 2, ambos borrados (`lifecycle_state = DELETED`).
- `practice_areas` de la organización **no incluye `GOV_PROCEDURE`** → esa es la razón real por la que la pestaña no aparece (no es un fallo del tablero).

## 2. Qué se va a construir

### a) Consumidor de catálogo genérico
Nuevo `src/components/pipeline/CatalogBoardContainer.tsx`:
- lee `work_items` del `workflow_type` dado (excluyendo borrados, igual que `WorkflowPhaseBoard`),
- mapea filas a `CatalogCardItem` (identificador, contraparte/autoridad, etapa, término más próximo),
- persiste el cambio de etapa en `work_items.stage` tras el veredicto del catálogo,
- renderiza `CatalogKanbanBoard`.

### b) Enrutamiento en el Dashboard
`BoardBody` en `src/pages/Dashboard.tsx`: `PETICION` y `GOV_PROCEDURE` pasan a `CatalogBoardContainer`. `CGP`, `EJECUTIVO`, `LABORAL`, `PENAL_906`, `CPACA`, `TUTELA` quedan intactos.

### c) Visibilidad de GOV_PROCEDURE
- `hasPhaseCatalogue` reconoce además los workflows gobernados por catálogo, para que la pestaña no dependa del catálogo de código.
- La pestaña sigue sujeta a `practice_areas`; se añadirá `GOV_PROCEDURE` a las áreas de la organización para que aparezca (decisión de datos, reversible desde Ajustes).

### d) Disposición de `peticion_phase`
- Escribe: `PeticionesPipeline` (drag) y `PeticionDetail` (selector), ambos sobre la tabla `peticiones`, hoy **vacía**.
- Lee: los mismos dos, más `PeticionColumn`/`PeticionCard`.
- Propuesta: dejar de renderizar `PeticionesPipeline` en el Dashboard en esta iteración; conservar el enum y la tabla sin tocar (cero filas, sin riesgo). Retiro físico del enum y de `src/lib/peticiones-constants.ts` en una iteración posterior, tras confirmar que ningún inquilino tiene filas.

## 3. Pruebas

Nuevo `src/__tests__/dashboard-catalog-routing.test.tsx`:
- monta la **ruta** `/app/dashboard?tab=peticiones` y `?tab=administrativos` con el cliente de datos simulado, y verifica que las columnas provienen del catálogo (15 y 20 etapas, con franja de ciclo de vida) y no de `PETICION_PHASES`;
- verifica que una condición de atención aparece como insignia en la tarjeta y **nunca** como columna;
- verifica los cinco campos de tarjeta en la ruta real;
- verifica que un fallo del catálogo produce el aviso de error, sin columnas inventadas.

## 4. Notas técnicas
- Sin migraciones de esquema; solo un `update` de `practice_areas`.
- El movimiento de tarjetas sigue validándose contra `workflow_stage_transitions`; los pasos no contemplados se rechazan.
