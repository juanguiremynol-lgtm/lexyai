CREATE OR REPLACE FUNCTION public._mcp_is_trusted_backend()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_role text;
BEGIN
  v_role := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                     (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'));
  IF v_role IS NOT NULL THEN RETURN v_role = 'service_role'; END IF;
  -- No JWT: only explicit backend login roles (session_user is unaffected by SECURITY DEFINER).
  RETURN session_user::text IN ('postgres', 'supabase_admin', 'service_role');
END $$;

CREATE OR REPLACE FUNCTION public.record_lifecycle_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_outbox_id uuid;
  v_via text := COALESCE(current_setting('andromeda.via_lifecycle_rpc', true), 'off');
BEGIN
  IF NEW.lifecycle_state IS NOT DISTINCT FROM OLD.lifecycle_state THEN
    RETURN NEW;
  END IF;
  -- Inside set_work_item_lifecycle the RPC binds the new event afterwards;
  -- never attach an older outbox row.
  IF v_via <> 'on' THEN
    SELECT o.id INTO v_outbox_id
    FROM public.gcp_lifecycle_outbox o
    WHERE o.work_item_id = NEW.id
      AND o.new_state::text = NEW.lifecycle_state::text
    ORDER BY o.occurred_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.work_item_lifecycle_ledger (
    work_item_id, radicado, workflow_type, from_state, to_state,
    actor, actor_user_id, reason, occurred_at, record_origin,
    emitted_to_gcp, gcp_outbox_id, metadata
  ) VALUES (
    NEW.id,
    regexp_replace(COALESCE(NEW.radicado_digits, NEW.radicado, ''), '\D', '', 'g'),
    NEW.workflow_type::text,
    OLD.lifecycle_state::text,
    NEW.lifecycle_state::text,
    COALESCE(NEW.lifecycle_actor, 'SYSTEM'),
    NEW.lifecycle_actor_user,
    NEW.lifecycle_reason,
    COALESCE(NEW.lifecycle_changed_at, now()),
    'OBSERVED',
    v_outbox_id IS NOT NULL,
    v_outbox_id,
    jsonb_build_object('via_rpc', v_via)
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.set_work_item_lifecycle(p_work_item_id uuid, p_new_state work_item_lifecycle_state, p_reason text DEFAULT NULL::text, p_actor text DEFAULT 'USER'::text, p_actor_user uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
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
  v_wf text;
  v_rad23 text;
  v_sib record;
  v_offset int := 1;
  v_emitted text[] := ARRAY[]::text[];
  v_uid uuid;
  v_trusted boolean;
  v_ctx jsonb;
  v_outbox_id uuid;
  v_ledger_n int;
BEGIN
  PERFORM set_config('andromeda.via_lifecycle_rpc', 'on', true);

  -- Caller guard. Trusted maintenance = service_role JWT or a no-JWT backend
  -- login (pg_cron/migrations), decided by public._mcp_is_trusted_backend()
  -- which never reads current_user. Every other caller must be a verified
  -- session (first-party, or OAuth with a manage grant) AND the matter owner:
  -- per ROLE_AND_SUBSCRIPTION_SPEC section 5 business admins and platform
  -- admins only read work_items. The actor is always auth.uid().
  v_uid := auth.uid();
  v_trusted := v_uid IS NULL AND public._mcp_is_trusted_backend();
  IF NOT v_trusted THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    v_ctx := public.mcp_caller_context();
    IF v_ctx->>'surface' NOT IN ('first_party', 'oauth_client') THEN
      RAISE EXCEPTION 'unverified session' USING ERRCODE = '42501';
    END IF;
    PERFORM public.mcp_assert_write();
    p_actor_user := v_uid;
    IF v_ctx->>'surface' = 'oauth_client' THEN
      p_actor := 'MCP';
    ELSIF COALESCE(p_actor, 'USER') NOT IN ('USER', 'MCP') THEN
      p_actor := 'USER';
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_item % not found', p_work_item_id;
  END IF;

  IF NOT v_trusted AND v_row.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'work_item % not found', p_work_item_id USING ERRCODE = '42501';
  END IF;

  v_prev := v_row.lifecycle_state;

  IF v_prev = p_new_state THEN
    RETURN jsonb_build_object('ok', true, 'no_op', true, 'prev_state', v_prev, 'new_state', p_new_state);
  END IF;

  IF p_new_state = 'PAUSED' THEN
    INSERT INTO public.lifecycle_pause_refusals (work_item_id, attempted_state, actor, reason, metadata)
    VALUES (p_work_item_id, p_new_state::text, COALESCE(p_actor, 'SYSTEM'), p_reason,
            COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('prev_state', v_prev));
    RETURN jsonb_build_object('ok', false, 'refused', true, 'prev_state', v_prev,
                              'attempted_state', p_new_state, 'actor', COALESCE(p_actor, 'SYSTEM'),
                              'error', 'PAUSE_STATE_DOES_NOT_EXIST');
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
    status = v_status,
    -- Listed explicitly so AFTER UPDATE OF deleted_at triggers (notification
    -- dismissal, alert supersede, deletion ledger) fire in this transaction.
    deleted_at  = CASE WHEN p_new_state = 'DELETED' THEN v_now ELSE NULL END,
    purge_after = CASE WHEN p_new_state = 'DELETED' THEN v_purge ELSE NULL END,
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

  v_wf := COALESCE(NULLIF(v_row.workflow_type::text, ''), 'INDETERMINADO');

  v_rad23 := NULLIF(regexp_replace(COALESCE(v_row.radicado_digits, v_row.radicado, ''), '\D', '', 'g'), '');
  IF v_rad23 IS NOT NULL AND v_rad23 !~ '^\d{23}$' THEN
    v_rad23 := NULL;
  END IF;

  INSERT INTO public.gcp_lifecycle_outbox (
    work_item_id, radicado, workflow_type, prev_state, new_state,
    reason, actor, actor_user_id, metadata, occurred_at
  ) VALUES (
    p_work_item_id, v_rad23, v_wf, v_prev, p_new_state,
    p_reason, COALESCE(p_actor, 'SYSTEM'), p_actor_user, COALESCE(p_metadata, '{}'::jsonb), v_now
  ) RETURNING id INTO v_outbox_id;

  -- Bind the ledger row written by trg_record_lifecycle_transition in THIS
  -- statement to the event just inserted (the trigger runs before it exists).
  UPDATE public.work_item_lifecycle_ledger
     SET gcp_outbox_id = v_outbox_id, emitted_to_gcp = true
   WHERE work_item_id = p_work_item_id
     AND to_state = p_new_state::text
     AND occurred_at = v_now
     AND gcp_outbox_id IS NULL;
  GET DIAGNOSTICS v_ledger_n = ROW_COUNT;
  IF v_ledger_n <> 1 THEN
    RAISE EXCEPTION 'lifecycle ledger binding failed (% rows)', v_ledger_n;
  END IF;

  -- Sibling fanout only for trusted maintenance and only within the same owner;
  -- user/agent deletions never emit DELETED for other records.
  IF p_new_state = 'DELETED' AND v_rad23 IS NOT NULL AND v_trusted THEN
    v_base := left(v_rad23, 21);

    FOR v_sib IN
      SELECT w.id,
             regexp_replace(COALESCE(w.radicado_digits, w.radicado, ''), '\D', '', 'g') AS rad,
             COALESCE(NULLIF(w.workflow_type::text, ''), 'INDETERMINADO') AS wf
        FROM public.work_items w
       WHERE w.id <> p_work_item_id
         AND w.deleted_at IS NULL
         AND w.owner_id = v_row.owner_id
         AND left(regexp_replace(COALESCE(w.radicado_digits, w.radicado, ''), '\D', '', 'g'), 21) = v_base
    LOOP
      CONTINUE WHEN v_sib.rad !~ '^\d{23}$';
      CONTINUE WHEN v_sib.rad = ANY (v_emitted);

      INSERT INTO public.gcp_lifecycle_outbox (
        work_item_id, radicado, workflow_type, prev_state, new_state,
        reason, actor, actor_user_id, metadata, occurred_at
      ) VALUES (
        v_sib.id, v_sib.rad, v_sib.wf, NULL, 'DELETED',
        COALESCE(p_reason, 'ELIMINACION_BASE'), COALESCE(p_actor, 'SYSTEM'), p_actor_user,
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
          'scope', 'INSTANCIA_HERMANA',
          'radicado_base_21', v_base,
          'origin_radicado', v_rad23
        ),
        v_now + (v_offset * interval '1 second')
      );
      v_emitted := v_emitted || v_sib.rad;
      v_offset := v_offset + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'prev_state', v_prev, 'new_state', p_new_state,
                            'work_item_id', p_work_item_id, 'gcp_outbox_id', v_outbox_id,
                            'purge_after', v_purge);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_work_item_lifecycle(uuid, public.work_item_lifecycle_state, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_work_item_lifecycle(uuid, public.work_item_lifecycle_state, text, text, uuid, jsonb) TO authenticated, service_role;