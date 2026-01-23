-- Fix: Organizations table public exposure
-- Restrict SELECT access to authenticated users who belong to the organization

-- Drop existing overly permissive policy if it exists
DROP POLICY IF EXISTS "Organizations are publicly readable" ON public.organizations;
DROP POLICY IF EXISTS "Allow public read access to organizations" ON public.organizations;
DROP POLICY IF EXISTS "Public can view organizations" ON public.organizations;

-- Create new secure policy: Users can only read their own organization
CREATE POLICY "Users can read their own organization"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- Keep the existing service role policy for backend operations
-- (If it doesn't exist, this won't affect anything)