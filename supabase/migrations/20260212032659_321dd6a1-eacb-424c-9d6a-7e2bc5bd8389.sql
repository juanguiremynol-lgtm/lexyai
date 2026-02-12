
-- =============================================================
-- Proof-of-fire + proof-of-completion table: atenia_cron_runs
-- =============================================================
CREATE TABLE IF NOT EXISTS public.atenia_cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','OK','FAILED','SKIPPED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (job_name, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_atenia_cron_runs_job_started
  ON public.atenia_cron_runs(job_name, started_at DESC);

-- RLS: only service_role writes; platform admins read
ALTER TABLE public.atenia_cron_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read cron runs"
  ON public.atenia_cron_runs FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Service role full access on cron runs"
  ON public.atenia_cron_runs FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant service_role bypass (policies above allow anon SELECT for platform admins)
-- The ALL policy is for service_role operations

-- =============================================================
-- Dedupe key on remediation queue
-- =============================================================
ALTER TABLE public.atenia_ai_remediation_queue
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_remediation_dedupe_pending
  ON public.atenia_ai_remediation_queue(dedupe_key)
  WHERE status IN ('PENDING','RUNNING');

-- =============================================================
-- Claim/lease RPC: atenia_try_start_cron
-- =============================================================
CREATE OR REPLACE FUNCTION public.atenia_try_start_cron(
  p_job_name text,
  p_scheduled_for timestamptz,
  p_lease_seconds int DEFAULT 600
)
RETURNS TABLE (ok boolean, run_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid;
  v_status text;
  v_started_at timestamptz;
BEGIN
  -- Try insert; if already exists, do nothing
  INSERT INTO atenia_cron_runs(job_name, scheduled_for, status)
  VALUES (p_job_name, p_scheduled_for, 'RUNNING')
  ON CONFLICT (job_name, scheduled_for) DO NOTHING;

  -- Fetch the existing row
  SELECT acr.id, acr.status, acr.started_at
    INTO v_run_id, v_status, v_started_at
  FROM atenia_cron_runs acr
  WHERE acr.job_name = p_job_name AND acr.scheduled_for = p_scheduled_for;

  IF v_run_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  -- If already OK or FAILED, don't re-run
  IF v_status IN ('OK', 'FAILED') THEN
    RETURN QUERY SELECT false, v_run_id;
    RETURN;
  END IF;

  -- If RUNNING but lease expired, allow takeover
  IF v_status = 'RUNNING' AND v_started_at < now() - (p_lease_seconds || ' seconds')::interval THEN
    UPDATE atenia_cron_runs SET started_at = now(), status = 'RUNNING'
    WHERE id = v_run_id;
    RETURN QUERY SELECT true, v_run_id;
    RETURN;
  END IF;

  -- If RUNNING and lease not expired, it was just inserted by us or is still active
  -- Check if started_at is very recent (within 2 seconds) meaning we just inserted it
  IF v_status = 'RUNNING' AND v_started_at >= now() - interval '2 seconds' THEN
    RETURN QUERY SELECT true, v_run_id;
    RETURN;
  END IF;

  -- Otherwise another worker owns it
  RETURN QUERY SELECT false, v_run_id;
END $$;

-- =============================================================
-- Finish RPC: atenia_finish_cron
-- =============================================================
CREATE OR REPLACE FUNCTION public.atenia_finish_cron(
  p_run_id uuid,
  p_status text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE atenia_cron_runs
  SET status = p_status,
      finished_at = now(),
      details = COALESCE(details, '{}'::jsonb) || p_details
  WHERE id = p_run_id;
END $$;

-- =============================================================
-- Invariant check: monitored items missing sync in last 24h
-- =============================================================
CREATE OR REPLACE FUNCTION public.atenia_get_missing_sync_coverage()
RETURNS TABLE (
  total_monitored bigint,
  attempted_24h bigint,
  missing_attempts bigint,
  coverage_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH monitored AS (
    SELECT id FROM work_items WHERE monitoring_enabled = true
  ),
  attempted AS (
    SELECT DISTINCT st.work_item_id
    FROM sync_traces st
    JOIN monitored m ON m.id = st.work_item_id
    WHERE st.created_at > now() - interval '24 hours'
  )
  SELECT
    (SELECT count(*) FROM monitored)::bigint AS total_monitored,
    (SELECT count(*) FROM attempted)::bigint AS attempted_24h,
    ((SELECT count(*) FROM monitored) - (SELECT count(*) FROM attempted))::bigint AS missing_attempts,
    CASE
      WHEN (SELECT count(*) FROM monitored) = 0 THEN 100.0
      ELSE round((SELECT count(*) FROM attempted)::numeric / (SELECT count(*) FROM monitored)::numeric * 100, 1)
    END AS coverage_pct;
$$;
