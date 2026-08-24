GRANT SELECT ON public.workflow_stages_global TO authenticated;
GRANT SELECT ON public.workflow_stage_transitions TO authenticated;
GRANT SELECT ON public.workflow_stage_code_mappings TO authenticated;
GRANT ALL ON public.workflow_stages_global TO service_role;
GRANT ALL ON public.workflow_stage_transitions TO service_role;
GRANT ALL ON public.workflow_stage_code_mappings TO service_role;

DROP POLICY IF EXISTS workflow_stages_global_read ON public.workflow_stages_global;
CREATE POLICY workflow_stages_global_read ON public.workflow_stages_global
  FOR SELECT TO authenticated USING (true);
