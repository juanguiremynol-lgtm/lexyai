
-- 1. job_runs: restrict null-org rows to platform admins
DROP POLICY IF EXISTS "Org members can view their job runs" ON public.job_runs;
CREATE POLICY "Org members can view their job runs"
  ON public.job_runs FOR SELECT
  USING (organization_id IS NOT NULL AND organization_id = get_user_organization_id());

-- 2. organization_memberships: restrict full-row SELECT to self + org admins + platform admins
DROP POLICY IF EXISTS "Users can view memberships of their organizations" ON public.organization_memberships;
CREATE POLICY "Users can view their own membership"
  ON public.organization_memberships FOR SELECT
  USING (user_id = auth.uid() OR is_org_admin(organization_id));

-- 3. provider_connectors: drop blanket SELECT policy
DROP POLICY IF EXISTS "connectors_select" ON public.provider_connectors;

-- 4. system_health_events: restrict null-org SELECT to platform admins; restrict null-org INSERT to service role
DROP POLICY IF EXISTS "Org members can view their system health events" ON public.system_health_events;
CREATE POLICY "Org members can view their system health events"
  ON public.system_health_events FOR SELECT
  USING (organization_id IS NOT NULL AND organization_id = get_user_organization_id());

DROP POLICY IF EXISTS "Users can insert for their org" ON public.system_health_events;
CREATE POLICY "Users can insert for their org"
  ON public.system_health_events FOR INSERT
  WITH CHECK (organization_id IS NOT NULL AND organization_id = get_user_organization_id());

-- 5. system_health_heartbeat: restrict reads to platform admins
DROP POLICY IF EXISTS "Authenticated users can read heartbeat" ON public.system_health_heartbeat;
CREATE POLICY "Platform admins can read heartbeat"
  ON public.system_health_heartbeat FOR SELECT
  TO authenticated
  USING (is_platform_admin());

-- 6. user_feedback: drop NULL-user exposure
DROP POLICY IF EXISTS "Users can view their own feedback" ON public.user_feedback;
CREATE POLICY "Users can view their own feedback"
  ON public.user_feedback FOR SELECT
  USING (user_id = auth.uid());
