---
name: Court competence vs subject matter
description: Iteration 18 doctrine — workflow_type is never inferred from the radicado for mixed-competence courts; source hierarchy, INDETERMINADO tray and tenant practice areas
type: feature
---
The radicado encodes the COMPETENCE of the despacho, never the subject matter.

- `despacho_competencia`: PURA | MIXTA | DESCONOCIDA (catalog `despacho_competencia_catalog`, mirrored in `src/lib/despacho-competencia.ts`). Only PURA permits inference from the radicado. Specialty 89 (promiscuo / pequeñas causas) and corp 31 esp 12 are MIXTA.
- Source hierarchy (`workflow_type_source`): MANUAL > PROVIDER_CLASS (clase_proceso map) > PURE_ESPECIALIDAD > INFERRED_VOCABULARY (suggestion only, never auto-applied) > INDETERMINADO.
- Undecidable matters get `workflow_type = 'INDETERMINADO'` and appear in the "Por clasificar" board tab (`UnclassifiedTray`). Monitoring stays ACTIVE and fans out to cpnu + publicaciones + samai + samai_estados.
- Tenant `organizations.practice_areas` (hook `use-practice-areas`, settings panel `PracticeAreasSettings`): areas not selected hide their board, are never auto-assigned (downgraded to a suggestion), but can still be set manually — which adds the area.
