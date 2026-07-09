
-- 1) Enum canónico
DO $$ BEGIN
  CREATE TYPE public.work_item_lifecycle_state AS ENUM (
    'ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED', 'DELETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Columnas canónicas
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS lifecycle_state public.work_item_lifecycle_state
    NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS lifecycle_reason text,
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_changed_by uuid;

CREATE INDEX IF NOT EXISTS work_items_lifecycle_state_active_idx
  ON public.work_items (lifecycle_state)
  WHERE lifecycle_state = 'ACTIVE';

COMMENT ON COLUMN public.work_items.lifecycle_state IS 'CANONICAL work item lifecycle state. Mutate ONLY via set_work_item_lifecycle RPC.';
COMMENT ON COLUMN public.work_items.status IS 'DEPRECATED: use lifecycle_state.';
COMMENT ON COLUMN public.work_items.monitoring_mode IS 'DEPRECATED: no longer authoritative.';
COMMENT ON COLUMN public.work_items.monitoring_disabled_at IS 'DEPRECATED: use lifecycle_state + lifecycle_reason.';
COMMENT ON COLUMN public.work_items.demonitor_at IS 'DEPRECATED: use lifecycle_state + lifecycle_reason.';

-- 3) Outbox GCP
CREATE TABLE IF NOT EXISTS public.gcp_lifecycle_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL,
  radicado text,
  workflow_type text,
  prev_state public.work_item_lifecycle_state,
  new_state public.work_item_lifecycle_state NOT NULL,
  reason text,
  actor text,
  actor_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  delivery_attempts int NOT NULL DEFAULT 0,
  last_delivery_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.gcp_lifecycle_outbox TO authenticated;
GRANT ALL ON public.gcp_lifecycle_outbox TO service_role;

ALTER TABLE public.gcp_lifecycle_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_gcp_outbox" ON public.gcp_lifecycle_outbox;
CREATE POLICY "service_role_all_gcp_outbox" ON public.gcp_lifecycle_outbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "platform_admins_read_gcp_outbox" ON public.gcp_lifecycle_outbox;
CREATE POLICY "platform_admins_read_gcp_outbox" ON public.gcp_lifecycle_outbox
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS gcp_lifecycle_outbox_pending_idx
  ON public.gcp_lifecycle_outbox (occurred_at)
  WHERE delivered_at IS NULL;

-- 4) RPC canónico
CREATE OR REPLACE FUNCTION public.set_work_item_lifecycle(
  p_work_item_id uuid,
  p_new_state    public.work_item_lifecycle_state,
  p_reason       text DEFAULT NULL,
  p_actor        text DEFAULT 'USER',
  p_actor_user   uuid DEFAULT NULL,
  p_metadata     jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev   public.work_item_lifecycle_state;
  v_row    public.work_items%ROWTYPE;
  v_now    timestamptz := now();
  v_purge  timestamptz;
BEGIN
  -- Marcar mutación como "vía RPC" para desactivar advertencia del guardián.
  PERFORM set_config('andromeda.via_lifecycle_rpc', 'on', true);

  SELECT * INTO v_row FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_item % not found', p_work_item_id;
  END IF;

  v_prev := v_row.lifecycle_state;

  IF v_prev = p_new_state THEN
    RETURN jsonb_build_object('ok', true, 'no_op', true, 'prev_state', v_prev, 'new_state', p_new_state);
  END IF;

  IF v_prev = 'DELETED' AND p_new_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'invalid transition: DELETED -> %', p_new_state;
  END IF;

  IF p_new_state = 'DELETED' THEN
    v_purge := v_now + interval '10 days';
  END IF;

  UPDATE public.work_items
  SET
    lifecycle_state = p_new_state,
    lifecycle_reason = p_reason,
    lifecycle_changed_at = v_now,
    lifecycle_changed_by = p_actor_user,
    monitoring_enabled = (p_new_state = 'ACTIVE'),
    scraping_enabled   = (p_new_state = 'ACTIVE'),
    deleted_at = CASE
      WHEN p_new_state = 'DELETED' THEN COALESCE(v_row.deleted_at, v_now)
      WHEN p_new_state = 'ACTIVE' AND v_prev = 'DELETED' THEN NULL
      ELSE v_row.deleted_at
    END,
    deleted_by = CASE
      WHEN p_new_state = 'DELETED' THEN COALESCE(v_row.deleted_by, p_actor_user)
      WHEN p_new_state = 'ACTIVE' AND v_prev = 'DELETED' THEN NULL
      ELSE v_row.deleted_by
    END,
    delete_reason = CASE
      WHEN p_new_state = 'DELETED' THEN COALESCE(v_row.delete_reason, p_reason)
      WHEN p_new_state = 'ACTIVE' AND v_prev = 'DELETED' THEN NULL
      ELSE v_row.delete_reason
    END,
    purge_after = CASE
      WHEN p_new_state = 'DELETED' THEN COALESCE(v_row.purge_after, v_purge)
      WHEN p_new_state = 'ACTIVE' AND v_prev = 'DELETED' THEN NULL
      ELSE v_row.purge_after
    END,
    monitoring_suspended_at = CASE
      WHEN p_new_state = 'PAUSED' THEN COALESCE(v_row.monitoring_suspended_at, v_now)
      WHEN p_new_state <> 'PAUSED' THEN NULL
      ELSE v_row.monitoring_suspended_at
    END,
    monitoring_suspended_reason = CASE
      WHEN p_new_state = 'PAUSED' THEN COALESCE(p_reason, v_row.monitoring_suspended_reason)
      WHEN p_new_state <> 'PAUSED' THEN NULL
      ELSE v_row.monitoring_suspended_reason
    END,
    status = CASE
      WHEN p_new_state = 'CLOSED' THEN 'CLOSED'::item_status
      WHEN p_new_state = 'ARCHIVED' THEN 'ARCHIVED'::item_status
      WHEN p_new_state = 'ACTIVE' THEN 'ACTIVE'::item_status
      ELSE v_row.status
    END,
    updated_at = v_now
  WHERE id = p_work_item_id;

  IF p_new_state <> 'ACTIVE' THEN
    UPDATE public.work_item_scrape_jobs
      SET status = 'CANCELLED', updated_at = v_now
      WHERE work_item_id = p_work_item_id AND status = 'PENDING';
  END IF;

  INSERT INTO public.audit_logs (
    organization_id, actor_user_id, actor_type, action,
    entity_type, entity_id, metadata
  ) VALUES (
    v_row.organization_id,
    p_actor_user,
    COALESCE(p_actor, 'SYSTEM'),
    'WORK_ITEM_LIFECYCLE_CHANGED',
    'WORK_ITEM',
    p_work_item_id,
    jsonb_build_object('prev_state', v_prev, 'new_state', p_new_state, 'reason', p_reason)
      || COALESCE(p_metadata, '{}'::jsonb)
  );

  INSERT INTO public.gcp_lifecycle_outbox (
    work_item_id, radicado, workflow_type, prev_state, new_state,
    reason, actor, actor_user_id, metadata, occurred_at
  ) VALUES (
    p_work_item_id, v_row.radicado, v_row.workflow_type::text, v_prev, p_new_state,
    p_reason, COALESCE(p_actor, 'SYSTEM'), p_actor_user, COALESCE(p_metadata, '{}'::jsonb), v_now
  );

  RETURN jsonb_build_object('ok', true, 'prev_state', v_prev, 'new_state', p_new_state, 'work_item_id', p_work_item_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_work_item_lifecycle(uuid, public.work_item_lifecycle_state, text, text, uuid, jsonb) TO authenticated, service_role;

-- 5) Guardián suave (WARNING, no bloquea; se endurecerá tras rewire)
CREATE OR REPLACE FUNCTION public.wi_lifecycle_soft_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_via_rpc text := current_setting('andromeda.via_lifecycle_rpc', true);
BEGIN
  IF v_via_rpc = 'on' THEN
    RETURN NEW;
  END IF;
  IF (NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state)
     OR (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
     OR (NEW.monitoring_enabled IS DISTINCT FROM OLD.monitoring_enabled)
     OR (NEW.scraping_enabled IS DISTINCT FROM OLD.scraping_enabled)
  THEN
    RAISE WARNING 'work_items lifecycle field mutated outside set_work_item_lifecycle RPC (id=%)', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wi_lifecycle_soft_guard ON public.work_items;
CREATE TRIGGER trg_wi_lifecycle_soft_guard
  BEFORE UPDATE ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.wi_lifecycle_soft_guard();

-- 6) Backfill correctivo (silencia guardián en la sesión de migración)
DO $$
BEGIN
  PERFORM set_config('andromeda.via_lifecycle_rpc', 'on', true);

  -- DELETED
  UPDATE public.work_items
  SET lifecycle_state = 'DELETED',
      lifecycle_changed_at = COALESCE(lifecycle_changed_at, now()),
      lifecycle_reason = COALESCE(lifecycle_reason, delete_reason, 'BACKFILL_LEGACY_DELETED'),
      monitoring_enabled = false,
      scraping_enabled = false,
      monitoring_suspended_at = NULL,
      monitoring_suspended_reason = NULL,
      purge_after = COALESCE(purge_after, deleted_at + interval '10 days')
  WHERE deleted_at IS NOT NULL
    AND lifecycle_state = 'ACTIVE';

  -- PAUSED
  UPDATE public.work_items
  SET lifecycle_state = 'PAUSED',
      lifecycle_changed_at = COALESCE(lifecycle_changed_at, now()),
      lifecycle_reason = COALESCE(lifecycle_reason, monitoring_suspended_reason, 'BACKFILL_LEGACY_PAUSED'),
      monitoring_enabled = false,
      scraping_enabled = false,
      monitoring_suspended_at = COALESCE(monitoring_suspended_at, now()),
      monitoring_suspended_reason = COALESCE(monitoring_suspended_reason, 'BACKFILL_LEGACY_PAUSED')
  WHERE deleted_at IS NULL
    AND lifecycle_state = 'ACTIVE'
    AND (monitoring_enabled = false OR monitoring_suspended_at IS NOT NULL);

  -- ACTIVE — normalizar scraping_enabled
  UPDATE public.work_items
  SET scraping_enabled = true
  WHERE lifecycle_state = 'ACTIVE'
    AND deleted_at IS NULL
    AND monitoring_enabled = true
    AND (scraping_enabled IS DISTINCT FROM true);
END $$;

-- 7) Encolar señal GCP retroactiva para los DELETED fantasma
INSERT INTO public.gcp_lifecycle_outbox (
  work_item_id, radicado, workflow_type, prev_state, new_state,
  reason, actor, actor_user_id, metadata, occurred_at
)
SELECT
  wi.id, wi.radicado, wi.workflow_type::text,
  'ACTIVE'::public.work_item_lifecycle_state,
  'DELETED'::public.work_item_lifecycle_state,
  COALESCE(wi.delete_reason, 'BACKFILL_GHOST_RECONCILIATION'),
  'SYSTEM', wi.deleted_by,
  jsonb_build_object('backfill', true, 'source', 'lifecycle_backfill_2026_07'),
  COALESCE(wi.deleted_at, now())
FROM public.work_items wi
LEFT JOIN public.gcp_lifecycle_outbox ob
  ON ob.work_item_id = wi.id AND ob.new_state = 'DELETED'
WHERE wi.lifecycle_state = 'DELETED'
  AND ob.id IS NULL;
