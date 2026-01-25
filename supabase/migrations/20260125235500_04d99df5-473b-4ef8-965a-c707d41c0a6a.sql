-- RLS Negative Probe: Validates policy structure via pg_policies inspection
-- Ensures both platform-admin and org-scoped policies exist for critical tables

CREATE OR REPLACE FUNCTION public.platform_rls_probe_negative()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_policies jsonb := '[]'::jsonb;
  v_table text;
  v_has_platform_policy boolean;
  v_has_org_policy boolean;
  v_critical_tables text[] := ARRAY['organizations', 'subscriptions', 'audit_logs', 'organization_memberships'];
BEGIN
  -- Access control: Only platform admins
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized: platform admin access required';
  END IF;

  -- Check each critical table for policy structure
  FOREACH v_table IN ARRAY v_critical_tables
  LOOP
    -- Check for platform-admin policy (uses is_platform_admin())
    SELECT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND (qual ILIKE '%is_platform_admin%' OR with_check ILIKE '%is_platform_admin%')
    ) INTO v_has_platform_policy;

    -- Check for org-scoped policy (uses is_org_member, organization_id, or org_id)
    SELECT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND (
          qual ILIKE '%is_org_member%' 
          OR qual ILIKE '%organization_id%'
          OR qual ILIKE '%get_user_org%'
          OR with_check ILIKE '%is_org_member%'
          OR with_check ILIKE '%organization_id%'
          OR with_check ILIKE '%get_user_org%'
        )
    ) INTO v_has_org_policy;

    v_policies := v_policies || jsonb_build_object(
      'table', v_table,
      'has_platform_policy', v_has_platform_policy,
      'has_org_policy', v_has_org_policy
    );
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'generated_at', NOW(),
    'policies', v_policies
  );

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', SQLERRM
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.platform_rls_probe_negative() TO authenticated;