-- ============================================================
-- FASE 1 · §6 — PETICION system-generated events (no email)
-- ============================================================

CREATE OR REPLACE FUNCTION public.evaluate_peticion_system_events()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_expired int := 0;
  v_deemed int := 0;
  v_silence int := 0;
  v_manual int := 0;
  v_anchor date;
  v_silence_date date;
  v_special_months numeric;
  v_delivery_due date;
  v_new_deadline uuid;
BEGIN
  FOR r IN
    SELECT s.*, wi.organization_id AS wi_org, wi.owner_id AS wi_owner,
           d.id AS deadline_id, d.deadline_date, d.deadline_type, d.status AS deadline_row_status,
           ps.default_silence_effect
    FROM public.peticion_work_item_state s
    JOIN public.work_items wi ON wi.id = s.work_item_id
    JOIN public.peticion_subtypes ps ON ps.code = s.subtype_code
    LEFT JOIN LATERAL (
      SELECT * FROM public.work_item_deadlines wd
      WHERE wd.work_item_id = s.work_item_id
        AND wd.deadline_type LIKE 'RESPUESTA_PETICION%'
        AND COALESCE(wd.deadline_status,'VIGENTE') NOT IN
            ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO','SUSPENDIDO')
      ORDER BY wd.deadline_date DESC NULLS LAST
      LIMIT 1
    ) d ON true
    WHERE wi.deleted_at IS NULL
      AND wi.workflow_type::text = 'PETICION'
  LOOP
    v_anchor := COALESCE(r.competent_authority_received_at, r.authority_received_at, r.sent_at);

    ---------------------------------------------------------------
    -- 1. Statutory term expiry (stage unchanged; dimensions move)
    ---------------------------------------------------------------
    IF r.deadline_id IS NOT NULL AND r.deadline_date IS NOT NULL
       AND r.deadline_date < CURRENT_DATE
       AND NOT EXISTS (
         SELECT 1 FROM public.peticion_events e
         WHERE e.work_item_id = r.work_item_id
           AND e.event_code = 'RESPONSE_TERM_EXPIRED'
           AND e.deadline_id = r.deadline_id)
    THEN
      INSERT INTO public.peticion_events
        (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes)
      VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'RESPONSE_TERM_EXPIRED', r.deadline_date, 'SYSTEM', r.deadline_id,
              'Vencimiento del término legal de respuesta (Ley 1755 de 2015, art. 14). La etapa procedimental no cambia.');

      UPDATE public.work_item_deadlines
        SET deadline_status = 'OVERDUE'
        WHERE id = r.deadline_id;

      UPDATE public.peticion_work_item_state
        SET deadline_status = 'OVERDUE', attention_status = 'ACTION_REQUIRED'
        WHERE id = r.id;

      v_expired := v_expired + 1;

      -----------------------------------------------------------
      -- 2a. Documentos/información → silencio positivo especial
      -----------------------------------------------------------
      IF r.subtype_code = 'DOCUMENTOS_INFORMACION' THEN
        v_delivery_due := public.add_business_days_sql(r.deadline_date, 3, 'ADMINISTRATIVO'::public.term_class);

        INSERT INTO public.peticion_events
          (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, legal_effect, notes)
        VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'REQUEST_DEEMED_ACCEPTED', r.deadline_date, 'SYSTEM', r.deadline_id,
                'REQUEST_DEEMED_ACCEPTED',
                'Ley 1755 de 2015, art. 14 num. 1 — vencido el término sin respuesta, la petición se entiende aceptada.')
        ON CONFLICT DO NOTHING;

        IF v_delivery_due IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.work_item_deadlines wd
          WHERE wd.work_item_id = r.work_item_id
            AND wd.deadline_type = 'ENTREGA_COPIAS_ACEPTACION_FICTA')
        THEN
          INSERT INTO public.work_item_deadlines
            (work_item_id, organization_id, owner_id, deadline_type, label, description,
             trigger_event, trigger_date, deadline_date, business_days_count, status,
             term_class, anchor_kind, anchor_source, supersedes_deadline_id, deadline_status, legal_effect)
          VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'ENTREGA_COPIAS_ACEPTACION_FICTA',
                  'Entrega de copias por aceptación ficta',
                  'Ley 1755 de 2015, art. 14 num. 1 — 3 días hábiles contados desde el vencimiento del término de 10 días.',
                  'REQUEST_DEEMED_ACCEPTED', r.deadline_date, v_delivery_due, 3, 'PENDING',
                  'ADMINISTRATIVO', 'STATUTORY_TERM_EXPIRY', 'DERIVED_FROM_DEEMED_ACCEPTANCE',
                  r.deadline_id, 'VIGENTE', 'REQUEST_DEEMED_ACCEPTED')
          RETURNING id INTO v_new_deadline;

          INSERT INTO public.peticion_events
            (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes)
          VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'DOCUMENT_DELIVERY_DUE', v_delivery_due, 'SYSTEM', v_new_deadline,
                  'Término derivado de 3 días hábiles anclado al vencimiento del término legal.')
          ON CONFLICT DO NOTHING;

          UPDATE public.peticion_work_item_state
            SET legal_effect = 'REQUEST_DEEMED_ACCEPTED'
            WHERE id = r.id;

          v_deemed := v_deemed + 1;
        END IF;
      END IF;
    END IF;

    ---------------------------------------------------------------
    -- 2b. Silencio administrativo negativo (CPACA art. 83)
    ---------------------------------------------------------------
    IF r.subtype_code <> 'DOCUMENTOS_INFORMACION' AND v_anchor IS NOT NULL THEN
      IF r.silence_effect IN ('POSITIVE_SPECIAL','NONE') THEN
        NULL; -- special positive silence or none: no negative-silence clock
      ELSIF r.silence_effect = 'MANUAL_REVIEW' THEN
        UPDATE public.peticion_work_item_state
          SET requires_manual_review = true
          WHERE id = r.id AND requires_manual_review = false;
        v_manual := v_manual + 1;
      ELSE
        v_special_months := NULL;
        IF r.subtype_code = 'NORMA_ESPECIAL' AND r.special_term_value IS NOT NULL THEN
          v_special_months := CASE r.special_term_unit
            WHEN 'MONTHS' THEN r.special_term_value
            WHEN 'CALENDAR_DAYS' THEN r.special_term_value / 30.0
            ELSE r.special_term_value / 20.0  -- business days ≈ 20 per month
          END;
        END IF;

        IF v_special_months IS NOT NULL AND v_special_months > 3 THEN
          -- Ley 1437 art. 83: one month after the decision was due
          v_silence_date := (COALESCE(r.deadline_date, v_anchor) + interval '1 month')::date;
        ELSE
          v_silence_date := (v_anchor + interval '3 months')::date;
        END IF;

        IF CURRENT_DATE >= v_silence_date AND NOT EXISTS (
          SELECT 1 FROM public.peticion_events e
          WHERE e.work_item_id = r.work_item_id
            AND e.event_code = 'SILENCIO_NEGATIVO_CONFIGURADO')
        THEN
          INSERT INTO public.peticion_events
            (work_item_id, organization_id, owner_id, event_code, event_date, source, legal_effect, notes)
          VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'SILENCIO_NEGATIVO_CONFIGURADO', v_silence_date, 'SYSTEM',
                  'SILENCIO_NEGATIVO',
                  'Ley 1437 de 2011, art. 83 — existe acto ficto demandable. El silencio no exonera a la autoridad del deber de decidir.');

          UPDATE public.peticion_work_item_state
            SET legal_effect = 'SILENCIO_NEGATIVO', attention_status = 'ACTION_REQUIRED'
            WHERE id = r.id;

          v_silence := v_silence + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'term_expired', v_expired,
    'deemed_accepted', v_deemed,
    'silence_events', v_silence,
    'manual_review', v_manual,
    'evaluated_at', now()
  );
END; $function$;

REVOKE EXECUTE ON FUNCTION public.evaluate_peticion_system_events() FROM anon;

SELECT cron.unschedule('peticion-system-events')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'peticion-system-events');

SELECT cron.schedule(
  'peticion-system-events',
  '20 12 * * *',
  $$SELECT public.evaluate_peticion_system_events();$$
);