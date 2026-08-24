
DROP POLICY IF EXISTS workflow_transitions_read ON public.workflow_stage_transitions;
CREATE POLICY workflow_transitions_read
  ON public.workflow_stage_transitions
  FOR SELECT
  TO authenticated
  USING (true);
REVOKE SELECT ON public.workflow_stage_transitions FROM anon;
