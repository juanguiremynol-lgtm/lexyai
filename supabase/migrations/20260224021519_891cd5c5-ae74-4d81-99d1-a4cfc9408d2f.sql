
-- Fix: scope the permissive policy to service_role only
DROP POLICY IF EXISTS "Service role full access on sync run payloads" ON public.external_sync_run_payloads;

CREATE POLICY "Service role writes sync run payloads"
  ON public.external_sync_run_payloads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
