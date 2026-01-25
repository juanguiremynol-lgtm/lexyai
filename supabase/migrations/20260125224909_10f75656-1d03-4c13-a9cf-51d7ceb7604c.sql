-- =====================================================
-- Migration: Platform Admins Table & Function
-- =====================================================
-- Creates infrastructure for platform-level super admin access
-- Separate from organization-level admin roles

-- 1. Create platform_admins table
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'SUPERADMIN' CHECK (role IN ('SUPERADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

-- Add comment for documentation
COMMENT ON TABLE public.platform_admins IS 'Platform-level super administrators who can manage all organizations';

-- 2. Enable RLS
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- 3. Create is_platform_admin() function
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = auth.uid()
  )
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS 'Returns true if the current user is a platform superadmin';

-- 4. RLS Policies for platform_admins table
-- Platform admins can see their own record
CREATE POLICY "Platform admins can view own record"
  ON public.platform_admins
  FOR SELECT
  USING (user_id = auth.uid());

-- Service role can manage all records (for bootstrap)
CREATE POLICY "Service role can manage platform_admins"
  ON public.platform_admins
  FOR ALL
  USING (auth.role() = 'service_role');

-- 5. Bootstrap the platform admin (gr@lexetlit.com)
INSERT INTO public.platform_admins (user_id, role, notes)
VALUES (
  'c64c2ca1-436a-44ee-a6ae-69bb19dfdc3a',
  'SUPERADMIN',
  'Initial platform admin - ATENIA owner'
)
ON CONFLICT (user_id) DO NOTHING;