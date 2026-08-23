CREATE OR REPLACE FUNCTION public.set_work_item_lifecycle(
  p_work_item_id uuid,
  p_new_state public.work_item_lifecycle_state,
  p_reason text DEFAULT NULL::text,
  p_actor text DEFAULT 'USER'::text,
  p_actor_user uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prev   public.work_item_lifecycle_state;
  v_row    public.work_items%ROWTYPE;
  v_now    timestamptz := clock_timestamp();
  v_purge  timestamptz;
  v_status public.item_status;
  v_actor_user uuid;
  v_change_source text;
  v_base text;
  v_siblings text[];
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

  v_status := CASE p_new_state
    WHEN 'ACTIVE'   THEN 'ACTIVE'::public.item_status
    WHEN 'PAUSED'   THEN 'INACTIVE'::public.item_status
    WHEN 'CLOSED'   THEN 'CLOSED'::public.item_status
    WHEN 'ARCHIVED' THEN 'ARCHIVED'::public.item_status
    WHEN 'DELETED'  THEN 'INACTIVE'::public.item_status
  END;

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
    status = v_status,
    updated_at = v_now
  WHERE id = p_work_item_id;

  v_actor_user := COALESCE(p_actor_user, v_row.owner_id);
  v_change_source := 'LIFECYCLE_' || p_new_state::text;

  IF v_row.organization_id IS NOT NULL AND v_actor_user IS NOT NULL THEN
    INSERT INTO public.work_item_stage_audit (
      work_item_id, organization_id, actor_user_id, previous_stage, new_stage,
      change_source, reason, metadata
    ) VALUES (
      p_work_item_id, v_row.organization_id, v_actor_user, v_prev::text, p_new_state::text,
      v_change_source, p_reason,
      jsonb_build_object('prev_state', v_prev, 'new_state', p_new_state,
                         'actor', COALESCE(p_actor, 'SYSTEM')) || COALESCE(p_metadata, '{}'::jsonb)
    );
  END IF;

  INSERT INTO public.gcp_lifecycle_outbox (
    work_item_id, radicado, workflow_type, prev_state, new_state,
    reason, actor, actor_user_id, metadata, occurred_at
  ) VALUES (
    p_work_item_id, v_row.radicado, v_row.workflow_type::text, v_prev, p_new_state,
    p_reason, COALESCE(p_actor, 'SYSTEM'), p_actor_user, COALESCE(p_metadata, '{}'::jsonb), v_now
  );

  IF p_new_state = 'DELETED' AND COALESCE(v_row.radicado_digits, v_row.radicado) IS NOT NULL THEN
    v_base := left(regexp_replace(COALESCE(v_row.radicado_digits, v_row.radicado), '\D', '', 'g'), 21);

    IF length(v_base) = 21 THEN
      SELECT COALESCE(array_agg(DISTINCT w.radicado), ARRAY[]::text[])
        INTO v_siblings
        FROM public.work_items w
       WHERE w.id <> p_work_item_id
         AND left(regexp_replace(COALESCE(w.radicado_digits, w.radicado, ''), '\D', '', 'g'), 21) = v_base;

      -- +1s keeps FIFO order and avoids the (work_item_id, occurred_at) unique index.
      INSERT INTO public.gcp_lifecycle_outbox (
        work_item_id, radicado, workflow_type, prev_state, new_state,
        reason, actor, actor_user_id, metadata, occurred_at
      ) VALUES (
        p_work_item_id, v_base, v_row.workflow_type::text, v_prev, 'DELETED',
        COALESCE(p_reason, 'ELIMINACION_BASE'), COALESCE(p_actor, 'SYSTEM'), p_actor_user,
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
          'scope', 'RADICADO_BASE',
          'radicado_base', v_base,
          'origin_radicado', v_row.radicado,
          'known_siblings', to_jsonb(v_siblings),
          'instruction', 'Desactivar todas las instancias que compartan esta base de 21 digitos.'
        ),
        v_now + interval '1 second'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'prev_state', v_prev, 'new_state', p_new_state,
                            'work_item_id', p_work_item_id);
END;
$function$;