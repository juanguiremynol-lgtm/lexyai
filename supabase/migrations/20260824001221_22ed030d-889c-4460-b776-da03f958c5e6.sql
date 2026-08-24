UPDATE public.workflow_stages_global
   SET code = 'EN_TERMINO_DESCARGOS'
 WHERE workflow_type = 'GOV_PROCEDURE' AND code = 'TERMINO_DESCARGOS';

UPDATE public.gov_procedure_regime_stage_applicability
   SET stage_code = 'EN_TERMINO_DESCARGOS'
 WHERE stage_code = 'TERMINO_DESCARGOS';

UPDATE public.workflow_stage_transitions
   SET from_stage_code = 'EN_TERMINO_DESCARGOS'
 WHERE workflow_type = 'GOV_PROCEDURE' AND from_stage_code = 'TERMINO_DESCARGOS';

UPDATE public.workflow_stage_transitions
   SET to_stage_code = 'EN_TERMINO_DESCARGOS'
 WHERE workflow_type = 'GOV_PROCEDURE' AND to_stage_code = 'TERMINO_DESCARGOS';

UPDATE public.workflow_event_stage_patterns
   SET suggested_stage_code = 'EN_TERMINO_DESCARGOS'
 WHERE workflow_type = 'GOV_PROCEDURE' AND suggested_stage_code = 'TERMINO_DESCARGOS';