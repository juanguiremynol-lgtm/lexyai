CREATE OR REPLACE FUNCTION public.set_work_item_lifecycle(p_work_item_id uuid, p_new_state work_item_lifecycle_state, p_reason text DEFAULT NULL::text, p_actor text DEFAULT 'USER'::text, p_actor_user uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev   public.work_item_lifecycle_state;
  v_row    public.work_items%ROWTYPE;
  -- clock_timestamp() (not now()) so multiple events enqueued in the same
  -- transaction get distinct sub-microsecond timestamps. Prevents the
  -- FIFO-flip bug where DELETE/RESTORE pairs delivered out of order.
  v_now    timestamptz := clock_timestamp();
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

  UPDATE public.work_items SET
    lifecycle_state = p_new_state,
    lifecycle_reason = p_reason,
    lifecycle_actor = p_actor,
    lifecycle_actor_user = p_actor_user,
    lifecycle_changed_at = v_now,
    monitoring_enabled = (p_new_state = 'ACTIVE'),
    scraping_enabled  = (p_new_state = 'ACTIVE'),
    deleted_at = CASE WHEN p_new_state = 'DELETED' THEN v_now
                      WHEN p_new_state = 'ACTIVE'  THEN NULL
                      ELSE deleted_at END,
    purge_after = CASE WHEN p_new_state = 'DELETED' THEN v_purge
                       WHEN p_new_state = 'ACTIVE'  THEN NULL
                       ELSE purge_after END,
    status = CASE
      WHEN p_new_state = 'ACTIVE'   THEN 'ACTIVE'
      WHEN p_new_state = 'PAUSED'   THEN 'PAUSED'
      WHEN p_new_state = 'CLOSED'   THEN 'CLOSED'
      WHEN p_new_state = 'ARCHIVED' THEN 'ARCHIVED'
      WHEN p_new_state = 'DELETED'  THEN 'DELETED'
    END,
    updated_at = v_now
  WHERE id = p_work_item_id;

  INSERT INTO public.work_item_stage_audit (
    work_item_id, actor, from_stage, to_stage, meta
  ) VALUES (
    p_work_item_id, COALESCE(p_actor, 'SYSTEM'), v_prev::text, p_new_state::text,
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
$function$;