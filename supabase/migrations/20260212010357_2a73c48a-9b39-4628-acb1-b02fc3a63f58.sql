
-- =====================================================================
-- Atenia AI Autonomy V2: Remediation queue, scheduled tasks, state tracking
-- =====================================================================

-- 1) Extend work_items for reversible demonitor metadata
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS monitoring_disabled_reason text,
  ADD COLUMN IF NOT EXISTS monitoring_disabled_by text,
  ADD COLUMN IF NOT EXISTS monitoring_disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS monitoring_disabled_meta jsonb;

-- 2) Per-work-item state tracking (consecutive failures, etc.)
CREATE TABLE IF NOT EXISTS public.atenia_ai_work_item_state (
  work_item_id uuid PRIMARY KEY REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  consecutive_not_found int NOT NULL DEFAULT 0,
  consecutive_timeouts int NOT NULL DEFAULT 0,
  consecutive_other_errors int NOT NULL DEFAULT 0,
  last_error_code text,
  last_provider text,
  last_success_at timestamptz
);

CREATE INDEX IF NOT EXISTS atenia_ai_work_item_state_org
  ON public.atenia_ai_work_item_state(organization_id);

-- 3) Remediation queue with atomic claim support
CREATE TABLE IF NOT EXISTS public.atenia_ai_remediation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  run_after timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  priority int NOT NULL DEFAULT 0,
  action_type text NOT NULL,
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  provider text,
  reason_code text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text
);

CREATE INDEX IF NOT EXISTS atenia_ai_remediation_queue_status
  ON public.atenia_ai_remediation_queue(status, run_after, priority DESC);

-- Dedupe active jobs per (work_item_id, action_type)
CREATE UNIQUE INDEX IF NOT EXISTS atenia_ai_remediation_queue_dedupe_active
  ON public.atenia_ai_remediation_queue(work_item_id, action_type)
  WHERE status IN ('PENDING','RUNNING');

-- 4) Scheduled tasks with row-based lock + TTL
CREATE TABLE IF NOT EXISTS public.atenia_ai_scheduled_tasks (
  task_key text PRIMARY KEY,
  task_name text NOT NULL,
  status text NOT NULL DEFAULT 'IDLE',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error jsonb,
  locked_until timestamptz,
  run_count int NOT NULL DEFAULT 0
);

-- 5) Add missing columns to existing atenia_ai_actions for v2 semantics
ALTER TABLE public.atenia_ai_actions
  ADD COLUMN IF NOT EXISTS actor text,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS is_reversible boolean DEFAULT true;

-- 6) RPC: task lock acquisition (atomic)
CREATE OR REPLACE FUNCTION public.atenia_ai_try_start_task(_task_key text, _ttl_seconds int DEFAULT 900)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
BEGIN
  INSERT INTO public.atenia_ai_scheduled_tasks(task_key, task_name, status, last_attempt_at, locked_until, run_count)
  VALUES (_task_key, _task_key, 'RUNNING', _now, _now + make_interval(secs => _ttl_seconds), 1)
  ON CONFLICT (task_key) DO UPDATE
    SET status = 'RUNNING',
        last_attempt_at = _now,
        locked_until = _now + make_interval(secs => _ttl_seconds),
        run_count = public.atenia_ai_scheduled_tasks.run_count + 1
    WHERE public.atenia_ai_scheduled_tasks.locked_until IS NULL
       OR public.atenia_ai_scheduled_tasks.locked_until < _now
       OR public.atenia_ai_scheduled_tasks.status <> 'RUNNING';
  RETURN found;
END $$;

-- 7) RPC: finish task
CREATE OR REPLACE FUNCTION public.atenia_ai_finish_task(_task_key text, _status text, _error jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.atenia_ai_scheduled_tasks
    SET status = CASE WHEN _status IN ('OK','ERROR','IDLE') THEN _status ELSE 'ERROR' END,
        last_success_at = CASE WHEN _status = 'OK' THEN now() ELSE last_success_at END,
        last_error = _error,
        locked_until = NULL
  WHERE task_key = _task_key;
END $$;

-- 8) RPC: claim queue items (SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.atenia_ai_claim_queue(_limit int DEFAULT 5)
RETURNS SETOF public.atenia_ai_remediation_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.atenia_ai_remediation_queue
    WHERE status = 'PENDING'
      AND run_after <= now()
      AND attempts < max_attempts
    ORDER BY priority DESC, created_at ASC
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.atenia_ai_remediation_queue q
    SET status = 'RUNNING',
        attempts = attempts + 1,
        updated_at = now()
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.*;
END $$;

-- 9) Lock RPC execution to service_role only
REVOKE ALL ON FUNCTION public.atenia_ai_try_start_task(text, int) FROM public;
REVOKE ALL ON FUNCTION public.atenia_ai_finish_task(text, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.atenia_ai_claim_queue(int) FROM public;

GRANT EXECUTE ON FUNCTION public.atenia_ai_try_start_task(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.atenia_ai_finish_task(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.atenia_ai_claim_queue(int) TO service_role;

-- 10) Enable RLS on new tables
ALTER TABLE public.atenia_ai_work_item_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atenia_ai_remediation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atenia_ai_scheduled_tasks ENABLE ROW LEVEL SECURITY;

-- Admin read policies (platform admins or org OWNER/ADMIN)
CREATE POLICY "platform_admin_read_work_item_state"
  ON public.atenia_ai_work_item_state FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = atenia_ai_work_item_state.organization_id
        AND m.role IN ('OWNER','ADMIN')
    )
  );

CREATE POLICY "platform_admin_read_remediation_queue"
  ON public.atenia_ai_remediation_queue FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = atenia_ai_remediation_queue.organization_id
        AND m.role IN ('OWNER','ADMIN')
    )
  );

CREATE POLICY "platform_admin_read_scheduled_tasks"
  ON public.atenia_ai_scheduled_tasks FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());
