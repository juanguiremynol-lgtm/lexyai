-- Allow the audit trigger function to insert audit logs
-- The trigger runs as SECURITY DEFINER, which runs as the function owner (postgres/supabase_admin)
-- We need a policy that allows service role / function owner to insert

-- First, let's check if there's a service role policy - if not, add one
CREATE POLICY "Service role can insert audit logs"
  ON public.audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Also allow the authenticated role to read via service_role for edge functions
CREATE POLICY "Service role can read all audit logs"
  ON public.audit_logs
  FOR SELECT
  TO service_role
  USING (true);