
-- A) Fix RLS: restrict platform_job_heartbeats reads to platform admins only
-- Drop the overly permissive authenticated read policy
DROP POLICY IF EXISTS "Authenticated users can read platform_job_heartbeats" ON public.platform_job_heartbeats;

-- Create a security definer function to check platform admin status (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_platform_admin_check(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_user_id
  );
$$;

-- Only platform admins can read heartbeat telemetry
CREATE POLICY "Platform admins can read platform_job_heartbeats"
  ON public.platform_job_heartbeats FOR SELECT
  USING (public.is_platform_admin_check(auth.uid()));
