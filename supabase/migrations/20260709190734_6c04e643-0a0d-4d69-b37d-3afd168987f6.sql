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
    -- work_item_scrape_jobs has no updated_at column; do not touch it.
    UPDATE public.work_item_scrape_jobs
      SET status = 'CANCELLED'
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