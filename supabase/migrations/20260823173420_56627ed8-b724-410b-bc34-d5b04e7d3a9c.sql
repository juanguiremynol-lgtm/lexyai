CREATE OR REPLACE FUNCTION public.match_deadline_discharges(p_work_item_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d record; pat record; act record; v_new int := 0; v_examined int := 0;
BEGIN
  FOR d IN
    SELECT dl.* FROM public.work_item_deadlines dl
    WHERE dl.status IN ('PENDING','VENCIDO_SIN_ACTUACION')  -- NN1(f): a drained term stays matchable
      AND COALESCE(dl.is_judge_side, false) = false
      AND COALESCE(dl.bound_party_role, '') <> 'DESPACHO_AUTORITATIVO'
      AND dl.deadline_type <> 'DESPACHO_AUTORITATIVO'
      AND (p_work_item_id IS NULL OR dl.work_item_id = p_work_item_id)
      AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = dl.work_item_id)
  LOOP
    v_examined := v_examined + 1;
    FOR pat IN
      SELECT * FROM public.deadline_discharge_patterns p
      WHERE p.is_active
        AND p.deadline_type = d.deadline_type
        AND (p.workflow_scope IS NULL
             OR COALESCE(d.calculation_meta->>'workflow_type','') = ANY(p.workflow_scope))
      ORDER BY p.priority
    LOOP
      SELECT a.id, a.act_date, COALESCE(a.description, a.act_type) txt
        INTO act
        FROM public.work_item_acts a
       WHERE a.work_item_id = d.work_item_id
         AND COALESCE(a.is_archived,false) = false
         AND a.act_date >= d.trigger_date
         AND a.act_date <= COALESCE(d.deadline_date, d.trigger_date) + 5
         AND UPPER(COALESCE(a.description, a.act_type, '')) ~ pat.act_pattern_regex
       ORDER BY a.act_date ASC
       LIMIT 1;

      IF act.id IS NULL THEN CONTINUE; END IF;

      INSERT INTO public.deadline_discharge_suggestions (
        deadline_id, work_item_id, owner_id, organization_id, pattern_id,
        act_id, act_date, act_text, norma, discharge_label)
      VALUES (d.id, d.work_item_id, d.owner_id, d.organization_id, pat.id,
              act.id, act.act_date, LEFT(act.txt, 500), pat.norma, pat.discharge_label)
      ON CONFLICT DO NOTHING;

      IF FOUND THEN
        v_new := v_new + 1;
        UPDATE public.work_item_deadlines
           SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
               || jsonb_build_object('discharge_state','PRESUNTAMENTE_CUMPLIDO',
                                     'discharge_evaluated_at', now())
         WHERE id = d.id;
      END IF;
      EXIT;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('examined', v_examined, 'suggested', v_new);
END $$;

CREATE OR REPLACE FUNCTION public.decide_deadline_discharge(p_suggestion_id uuid, p_confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s record; v_prev text;
BEGIN
  SELECT * INTO s FROM public.deadline_discharge_suggestions WHERE id = p_suggestion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'suggestion not found'; END IF;
  IF s.owner_id <> auth.uid() THEN RAISE EXCEPTION 'not authorised'; END IF;
  IF s.status <> 'PENDING' THEN RETURN jsonb_build_object('ok', false, 'reason','ALREADY_DECIDED'); END IF;

  SELECT status INTO v_prev FROM public.work_item_deadlines WHERE id = s.deadline_id;

  UPDATE public.deadline_discharge_suggestions
     SET status = CASE WHEN p_confirm THEN 'CONFIRMED' ELSE 'REJECTED' END,
         decided_at = now(), decided_by = auth.uid()
   WHERE id = p_suggestion_id;

  IF p_confirm THEN
    UPDATE public.work_item_deadlines
       SET status = 'FULFILLED', met_at = COALESCE(met_at, now()),
           closure_reason = 'DISCHARGE_CONFIRMED_BY_LAWYER',
           calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
             || jsonb_build_object('discharge_state','CUMPLIDO_CONFIRMADO',
                                   'discharge_suggestion_id', p_suggestion_id,
                                   'discharge_act_id', s.act_id)
             -- NN1(f): a drained term is recoverable, never stuck.
             || CASE WHEN v_prev = 'VENCIDO_SIN_ACTUACION'
                     THEN jsonb_build_object('recovered_from_drain_at', now())
                     ELSE '{}'::jsonb END
     WHERE id = s.deadline_id;
  ELSE
    UPDATE public.work_item_deadlines
       SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
             || jsonb_build_object('discharge_state','RECHAZADO_POR_ABOGADO')
     WHERE id = s.deadline_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'confirmed', p_confirm, 'previous_status', v_prev);
END $$;