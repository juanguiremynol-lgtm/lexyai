-- Update platform_verification_snapshot() to include Jobs Evidence
-- Forensic evidence for job_name mismatch and status debugging

CREATE OR REPLACE FUNCTION public.platform_verification_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_schema jsonb;
  v_triggers jsonb;
  v_rls jsonb;
  v_activity jsonb;
  v_jobs jsonb;
  v_usage jsonb;
  v_email_columns text[];
  v_email_indexes text[];
  v_trigger_names text[];
  v_last_job_run record;
  v_last_job_error record;
  v_last_seen_exact record;
  v_last_seen_fuzzy record;
  v_recent_job_names text[];
  v_job_runs_exists boolean;
  v_job_runs_has_metadata boolean;
  v_system_health_exists boolean;
  -- Usage counts
  v_orgs_count bigint;
  v_members_count bigint;
  v_distinct_users_count bigint;
  v_email_outbox_count bigint;
  v_subscriptions_count bigint;
  v_audit_logs_count bigint;
  v_job_runs_count bigint;
BEGIN
  -- Access control: Only platform admins
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized: platform admin access required';
  END IF;

  -- Check if tables exist
  v_job_runs_exists := to_regclass('public.job_runs') IS NOT NULL;
  v_system_health_exists := to_regclass('public.system_health_events') IS NOT NULL;

  -- Check if job_runs.metadata column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_runs'
      AND column_name = 'metadata'
  ) INTO v_job_runs_has_metadata;

  -- ========== USAGE COUNTS (lightweight) ==========
  SELECT COUNT(*) INTO v_orgs_count FROM public.organizations;
  SELECT COUNT(*) INTO v_members_count FROM public.organization_memberships;
  SELECT COUNT(DISTINCT user_id) INTO v_distinct_users_count FROM public.organization_memberships;
  
  -- Safe count for email_outbox (may not exist)
  IF to_regclass('public.email_outbox') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_email_outbox_count FROM public.email_outbox;
  ELSE
    v_email_outbox_count := 0;
  END IF;
  
  SELECT COUNT(*) INTO v_subscriptions_count FROM public.subscriptions;
  SELECT COUNT(*) INTO v_audit_logs_count FROM public.audit_logs;
  
  IF v_job_runs_exists THEN
    SELECT COUNT(*) INTO v_job_runs_count FROM public.job_runs;
  ELSE
    v_job_runs_count := 0;
  END IF;

  v_usage := jsonb_build_object(
    'organizations_total', v_orgs_count,
    'memberships_total', v_members_count,
    'distinct_users_total', v_distinct_users_count,
    'email_outbox_total', v_email_outbox_count,
    'subscriptions_total', v_subscriptions_count,
    'audit_logs_total', v_audit_logs_count,
    'job_runs_total', v_job_runs_count
  );

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
    COALESCE(v_email_indexes, ARRAY[]::text[]),
    'job_runs_table_exists',
    v_job_runs_exists,
    'job_runs_has_metadata',
    COALESCE(v_job_runs_has_metadata, false),
    'system_health_events_table_exists',
    v_system_health_exists
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

  -- 5) Job runs for scheduled operations with FORENSIC EVIDENCE
  IF v_job_runs_exists THEN
    -- Get last successful run (status = 'OK', exact job_name)
    IF v_job_runs_has_metadata THEN
      SELECT id, job_name, status, started_at, finished_at, duration_ms, processed_count, 
             COALESCE((metadata->>'preview')::boolean, false) as preview_flag,
             error
      INTO v_last_job_run
      FROM job_runs
      WHERE job_name = 'purge-old-audit-logs' AND status = 'OK'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1;
    ELSE
      SELECT id, job_name, status, started_at, finished_at, duration_ms, processed_count, 
             false as preview_flag, error
      INTO v_last_job_run
      FROM job_runs
      WHERE job_name = 'purge-old-audit-logs' AND status = 'OK'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1;
    END IF;

    -- Get last error
    SELECT id, job_name, status, started_at, finished_at, error
    INTO v_last_job_error
    FROM job_runs
    WHERE job_name = 'purge-old-audit-logs' AND status = 'ERROR'
    ORDER BY finished_at DESC NULLS LAST
    LIMIT 1;

    -- FORENSIC: Last seen EXACT (any status, exact job_name)
    IF v_job_runs_has_metadata THEN
      SELECT id, job_name, status, started_at, finished_at, duration_ms, processed_count,
             true as has_metadata,
             COALESCE((metadata->>'preview')::boolean, false) as preview_flag,
             error
      INTO v_last_seen_exact
      FROM job_runs
      WHERE job_name = 'purge-old-audit-logs'
      ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
      LIMIT 1;
    ELSE
      SELECT id, job_name, status, started_at, finished_at, duration_ms, processed_count,
             false as has_metadata,
             false as preview_flag,
             error
      INTO v_last_seen_exact
      FROM job_runs
      WHERE job_name = 'purge-old-audit-logs'
      ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
      LIMIT 1;
    END IF;

    -- FORENSIC: Last seen FUZZY (catch naming drift)
    IF v_job_runs_has_metadata THEN
      SELECT id, job_name, status, started_at, finished_at, duration_ms, processed_count,
             true as has_metadata,
             COALESCE((metadata->>'preview')::boolean, false) as preview_flag,
             error
      INTO v_last_seen_fuzzy
      FROM job_runs
      WHERE job_name ILIKE '%purge%' 
         OR job_name IN ('purge_old_audit_logs', 'purge-old-audit-logs', 'audit_purge', 'purge-audit-logs')
      ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
      LIMIT 1;
    ELSE
      SELECT id, job_name, status, started_at, finished_at, duration_ms, processed_count,
             false as has_metadata,
             false as preview_flag,
             error
      INTO v_last_seen_fuzzy
      FROM job_runs
      WHERE job_name ILIKE '%purge%' 
         OR job_name IN ('purge_old_audit_logs', 'purge-old-audit-logs', 'audit_purge', 'purge-audit-logs')
      ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
      LIMIT 1;
    END IF;

    -- FORENSIC: Recent job names (last 30 days)
    SELECT array_agg(DISTINCT job_name ORDER BY job_name)
    INTO v_recent_job_names
    FROM (
      SELECT job_name
      FROM job_runs
      WHERE COALESCE(finished_at, started_at) > NOW() - INTERVAL '30 days'
      ORDER BY COALESCE(finished_at, started_at) DESC
      LIMIT 50
    ) sub;

  END IF;

  v_jobs := jsonb_build_object(
    'job_runs_table_exists', v_job_runs_exists,
    'job_runs_has_metadata', COALESCE(v_job_runs_has_metadata, false),
    -- Expected signature for verification
    'expected_signature', jsonb_build_object(
      'job_name', 'purge-old-audit-logs',
      'success_status', 'OK',
      'notes', 'Verification expects a successful run with this exact job_name and status.'
    ),
    -- Backward-compatible: Last successful run
    'purge_old_audit_logs_last_run',
    CASE WHEN v_last_job_run.id IS NOT NULL THEN
      jsonb_build_object(
        'status', v_last_job_run.status,
        'finished_at', v_last_job_run.finished_at,
        'duration_ms', v_last_job_run.duration_ms,
        'processed_count', v_last_job_run.processed_count,
        'preview', COALESCE(v_last_job_run.preview_flag, false)
      )
    ELSE NULL END,
    -- Backward-compatible: Last error
    'purge_old_audit_logs_last_error',
    CASE WHEN v_last_job_error.id IS NOT NULL THEN
      jsonb_build_object(
        'status', v_last_job_error.status,
        'finished_at', v_last_job_error.finished_at,
        'error', v_last_job_error.error
      )
    ELSE NULL END,
    -- FORENSIC: Last seen exact (any status)
    'purge_old_audit_logs_last_seen_exact',
    CASE WHEN v_last_seen_exact.id IS NOT NULL THEN
      jsonb_build_object(
        'id', v_last_seen_exact.id,
        'job_name', v_last_seen_exact.job_name,
        'status', v_last_seen_exact.status,
        'started_at', v_last_seen_exact.started_at,
        'finished_at', v_last_seen_exact.finished_at,
        'duration_ms', v_last_seen_exact.duration_ms,
        'processed_count', v_last_seen_exact.processed_count,
        'has_metadata', v_last_seen_exact.has_metadata,
        'preview_flag', v_last_seen_exact.preview_flag,
        'error', v_last_seen_exact.error
      )
    ELSE NULL END,
    -- FORENSIC: Last seen fuzzy (catch naming drift)
    'purge_old_audit_logs_last_seen_fuzzy',
    CASE WHEN v_last_seen_fuzzy.id IS NOT NULL THEN
      jsonb_build_object(
        'id', v_last_seen_fuzzy.id,
        'job_name', v_last_seen_fuzzy.job_name,
        'status', v_last_seen_fuzzy.status,
        'started_at', v_last_seen_fuzzy.started_at,
        'finished_at', v_last_seen_fuzzy.finished_at,
        'duration_ms', v_last_seen_fuzzy.duration_ms,
        'processed_count', v_last_seen_fuzzy.processed_count,
        'has_metadata', v_last_seen_fuzzy.has_metadata,
        'preview_flag', v_last_seen_fuzzy.preview_flag,
        'error', v_last_seen_fuzzy.error
      )
    ELSE NULL END,
    -- FORENSIC: Recent job names in last 30 days
    'job_runs_recent_names',
    COALESCE(v_recent_job_names, ARRAY[]::text[])
  );

  -- Build final result with usage
  v_result := jsonb_build_object(
    'generated_at', NOW(),
    'platform_admin', true,
    'schema', v_schema,
    'triggers', v_triggers,
    'rls', v_rls,
    'activity_last_seen', v_activity,
    'jobs', v_jobs,
    'usage', v_usage
  );

  RETURN v_result;
END;
$function$;