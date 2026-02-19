
-- Recreate RPCs with platform-admin auth guard and deterministic tiebreaker

CREATE OR REPLACE FUNCTION public.get_chain_progress(p_chain_id TEXT)
RETURNS TABLE (
  organization_id UUID,
  status TEXT,
  trigger_source TEXT,
  chain_id TEXT,
  items_succeeded INT,
  items_failed INT,
  items_skipped INT,
  dead_letter_count INT,
  timeout_count INT,
  continuation_block_reason TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fail closed: require authenticated platform admin
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized: platform admin access required';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (l.organization_id)
    l.organization_id,
    l.status::TEXT,
    l.trigger_source,
    l.chain_id,
    COALESCE(l.items_succeeded, 0)::INT,
    COALESCE(l.items_failed, 0)::INT,
    COALESCE(l.items_skipped, 0)::INT,
    COALESCE(l.dead_letter_count, 0)::INT,
    COALESCE(l.timeout_count, 0)::INT,
    l.continuation_block_reason,
    l.started_at,
    l.finished_at,
    l.created_at
  FROM auto_sync_daily_ledger l
  WHERE l.chain_id = p_chain_id
  ORDER BY l.organization_id, l.created_at DESC, l.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chain_org_history(p_chain_id TEXT, p_org_id UUID)
RETURNS TABLE (
  id UUID,
  status TEXT,
  is_continuation BOOLEAN,
  items_succeeded INT,
  items_failed INT,
  items_skipped INT,
  dead_letter_count INT,
  continuation_block_reason TEXT,
  failure_reason TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fail closed: require authenticated platform admin
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized: platform admin access required';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.status::TEXT,
    COALESCE(l.is_continuation, false),
    COALESCE(l.items_succeeded, 0)::INT,
    COALESCE(l.items_failed, 0)::INT,
    COALESCE(l.items_skipped, 0)::INT,
    COALESCE(l.dead_letter_count, 0)::INT,
    l.continuation_block_reason,
    l.failure_reason,
    l.started_at,
    l.finished_at,
    l.created_at
  FROM auto_sync_daily_ledger l
  WHERE l.chain_id = p_chain_id AND l.organization_id = p_org_id
  ORDER BY l.created_at DESC, l.id DESC
  LIMIT 50;
END;
$$;
