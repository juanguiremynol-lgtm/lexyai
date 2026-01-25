-- Platform Verification Snapshot RPC
-- Returns comprehensive system verification data for platform admins

CREATE OR REPLACE FUNCTION public.platform_verification_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_schema jsonb;
  v_triggers jsonb;
  v_rls jsonb;
  v_activity jsonb;
  v_jobs jsonb;
  v_email_columns text[];
  v_email_indexes text[];
  v_trigger_names text[];
  v_last_job_run record;
  v_last_job_error record;
BEGIN
  -- Access control: Only platform admins
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized: platform admin access required';
  END IF;

  -- 1) Schema checks for email_outbox
  SELECT array_agg(column_name::text)
  INTO v_email_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'email_outbox'
    AND column_name IN ('provider_message_id', 'last_event_type', 'last_event_at', 'failure_type', 'failed_permanent');

  SELECT array_agg(indexname::text)
  INTO v_email_indexes
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'email_outbox';

  v_schema := jsonb_build_object(
    'email_outbox_columns_ok', 
    COALESCE(array_length(v_email_columns, 1), 0) >= 5,
    'email_outbox_columns_found',
    COALESCE(v_email_columns, ARRAY[]::text[]),
    'email_outbox_indexes_ok',
    COALESCE(array_length(v_email_indexes, 1), 0) >= 1,
    'email_outbox_indexes_found',
    COALESCE(v_email_indexes, ARRAY[]::text[])
  );

  -- 2) Trigger existence checks
  SELECT array_agg(tgname::text)
  INTO v_trigger_names
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relname IN ('organization_memberships', 'subscriptions', 'email_outbox')
    AND NOT t.tgisinternal;

  v_triggers := jsonb_build_object(
    'audit_trigger_function_exists',
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'audit_trigger_write_audit_log'
    ),
    'organization_memberships_triggers_ok',
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public' AND c.relname = 'organization_memberships' AND NOT t.tgisinternal
    ),
    'subscriptions_trigger_ok',
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public' AND c.relname = 'subscriptions' AND NOT t.tgisinternal
    ),
    'email_outbox_trigger_ok',
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public' AND c.relname = 'email_outbox' AND NOT t.tgisinternal
    ),
    'triggers_found',
    COALESCE(v_trigger_names, ARRAY[]::text[])
  );

  -- 3) RLS checks
  v_rls := jsonb_build_object(
    'audit_logs_rls_enabled',
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'audit_logs' AND relnamespace = 'public'::regnamespace),
    'audit_logs_rls_forced',
    (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'audit_logs' AND relnamespace = 'public'::regnamespace),
    'admin_notifications_rls_enabled',
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'admin_notifications' AND relnamespace = 'public'::regnamespace),
    'subscriptions_rls_enabled',
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'subscriptions' AND relnamespace = 'public'::regnamespace),
    'organizations_rls_enabled',
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'organizations' AND relnamespace = 'public'::regnamespace)
  );

  -- 4) Activity last-seen from audit_logs (DB trigger events)
  v_activity := jsonb_build_object(
    'DB_MEMBERSHIP_INSERTED',
    (SELECT MAX(created_at) FROM audit_logs WHERE action = 'DB_MEMBERSHIP_INSERTED'),
    'DB_MEMBERSHIP_UPDATED',
    (SELECT MAX(created_at) FROM audit_logs WHERE action = 'DB_MEMBERSHIP_UPDATED'),
    'DB_MEMBERSHIP_DELETED',
    (SELECT MAX(created_at) FROM audit_logs WHERE action = 'DB_MEMBERSHIP_DELETED'),
    'DB_SUBSCRIPTION_UPDATED',
    (SELECT MAX(created_at) FROM audit_logs WHERE action = 'DB_SUBSCRIPTION_UPDATED'),
    'DB_EMAIL_STATUS_CHANGED',
    (SELECT MAX(created_at) FROM audit_logs WHERE action = 'DB_EMAIL_STATUS_CHANGED')
  );

  -- 5) Job runs for scheduled operations
  SELECT * INTO v_last_job_run
  FROM job_runs
  WHERE job_name = 'purge-old-audit-logs' AND status = 'OK'
  ORDER BY finished_at DESC NULLS LAST
  LIMIT 1;

  SELECT * INTO v_last_job_error
  FROM job_runs
  WHERE job_name = 'purge-old-audit-logs' AND status = 'ERROR'
  ORDER BY finished_at DESC NULLS LAST
  LIMIT 1;

  v_jobs := jsonb_build_object(
    'purge_old_audit_logs_last_run',
    CASE WHEN v_last_job_run.id IS NOT NULL THEN
      jsonb_build_object(
        'status', v_last_job_run.status,
        'finished_at', v_last_job_run.finished_at,
        'duration_ms', v_last_job_run.duration_ms,
        'processed_count', v_last_job_run.processed_count,
        'preview', COALESCE((v_last_job_run.metadata->>'preview')::boolean, false)
      )
    ELSE NULL END,
    'purge_old_audit_logs_last_error',
    CASE WHEN v_last_job_error.id IS NOT NULL THEN
      jsonb_build_object(
        'status', v_last_job_error.status,
        'finished_at', v_last_job_error.finished_at,
        'error', v_last_job_error.error
      )
    ELSE NULL END
  );

  -- Build final result
  v_result := jsonb_build_object(
    'generated_at', NOW(),
    'platform_admin', true,
    'schema', v_schema,
    'triggers', v_triggers,
    'rls', v_rls,
    'activity_last_seen', v_activity,
    'jobs', v_jobs
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users (function itself checks is_platform_admin)
GRANT EXECUTE ON FUNCTION public.platform_verification_snapshot() TO authenticated;