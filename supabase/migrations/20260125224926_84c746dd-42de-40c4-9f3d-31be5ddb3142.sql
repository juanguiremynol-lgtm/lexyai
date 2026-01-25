-- =====================================================
-- Migration: Platform Admin RLS Policy Updates
-- =====================================================
-- Extends RLS policies to allow platform superadmins cross-org access
-- Uses OR public.is_platform_admin() pattern for safe policy extension

-- 1. Organizations - Platform admins can SELECT all orgs
DROP POLICY IF EXISTS "Platform admins can view all organizations" ON public.organizations;
CREATE POLICY "Platform admins can view all organizations"
  ON public.organizations
  FOR SELECT
  USING (public.is_platform_admin());

-- 2. Subscriptions - Platform admins can SELECT and UPDATE all
DROP POLICY IF EXISTS "Platform admins can view all subscriptions" ON public.subscriptions;
CREATE POLICY "Platform admins can view all subscriptions"
  ON public.subscriptions
  FOR SELECT
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admins can update all subscriptions" ON public.subscriptions;
CREATE POLICY "Platform admins can update all subscriptions"
  ON public.subscriptions
  FOR UPDATE
  USING (public.is_platform_admin());

-- 3. Organization memberships - Platform admins can SELECT all (for user counts)
DROP POLICY IF EXISTS "Platform admins can view all memberships" ON public.organization_memberships;
CREATE POLICY "Platform admins can view all memberships"
  ON public.organization_memberships
  FOR SELECT
  USING (public.is_platform_admin());

-- 4. Audit logs - Platform admins can SELECT all
DROP POLICY IF EXISTS "Platform admins can view all audit logs" ON public.audit_logs;
CREATE POLICY "Platform admins can view all audit logs"
  ON public.audit_logs
  FOR SELECT
  USING (public.is_platform_admin());

-- 5. Email outbox - Platform admins can SELECT all
DROP POLICY IF EXISTS "Platform admins can view all email outbox" ON public.email_outbox;
CREATE POLICY "Platform admins can view all email outbox"
  ON public.email_outbox
  FOR SELECT
  USING (public.is_platform_admin());

-- 6. Job runs - Platform admins can SELECT all
DROP POLICY IF EXISTS "Platform admins can view all job runs" ON public.job_runs;
CREATE POLICY "Platform admins can view all job runs"
  ON public.job_runs
  FOR SELECT
  USING (public.is_platform_admin());

-- 7. System health events - Platform admins can SELECT all
DROP POLICY IF EXISTS "Platform admins can view all system health events" ON public.system_health_events;
CREATE POLICY "Platform admins can view all system health events"
  ON public.system_health_events
  FOR SELECT
  USING (public.is_platform_admin());

-- 8. Profiles - Platform admins can SELECT all (for user management)
DROP POLICY IF EXISTS "Platform admins can view all profiles" ON public.profiles;
CREATE POLICY "Platform admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_platform_admin());