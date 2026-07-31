CREATE POLICY "Org members can insert admin_notifications"
ON public.admin_notifications FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(organization_id) OR public.is_platform_admin());

CREATE POLICY "Org members can insert data alerts"
ON public.user_data_alerts FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "Org members can insert deep dives"
ON public.atenia_deep_dives FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(organization_id) OR public.is_platform_admin());

CREATE POLICY "Org members can update deep dives"
ON public.atenia_deep_dives FOR UPDATE TO authenticated
USING (public.is_org_member(organization_id) OR public.is_platform_admin())
WITH CHECK (public.is_org_member(organization_id) OR public.is_platform_admin());

CREATE POLICY "Org members can insert e2e results"
ON public.atenia_e2e_test_results FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(organization_id) OR public.is_platform_admin());