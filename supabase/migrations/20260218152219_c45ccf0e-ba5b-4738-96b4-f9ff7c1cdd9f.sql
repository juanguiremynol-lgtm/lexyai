-- Fix RLS on external_sync_run_attempts: restrict writes to service_role only
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Service role full access on sync run attempts" ON public.external_sync_run_attempts;

-- Read: join through external_sync_runs → work_items to enforce tenant isolation
CREATE POLICY "Users can read sync run attempts for their work items"
  ON public.external_sync_run_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.external_sync_runs esr
      JOIN public.work_items wi ON wi.id = esr.work_item_id
      WHERE esr.id = external_sync_run_attempts.sync_run_id
        AND wi.owner_id = auth.uid()
    )
  );

-- Writes: service_role only (edge functions use service_role key)
-- No INSERT/UPDATE/DELETE policies for authenticated users