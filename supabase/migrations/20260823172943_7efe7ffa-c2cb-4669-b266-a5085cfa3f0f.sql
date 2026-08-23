-- NN1/NN2 — expired terms drain; attribution is computed in ONE place.

ALTER TABLE public.work_item_deadlines DROP CONSTRAINT IF EXISTS work_item_deadlines_status_check;
ALTER TABLE public.work_item_deadlines ADD CONSTRAINT work_item_deadlines_status_check CHECK (
  status = ANY (ARRAY['PENDING','PENDING_REVIEW','HISTORICAL_BACKFILL','MET','MISSED','CANCELLED',
    'REQUIERE_REVISION_MANUAL','SUGGESTED_BY_EMAIL','SUGGESTED_BY_PROVIDER','FULFILLED',
    'FULFILLED_BY_EMAIL_EVIDENCE','INVALID_NO_TERM','VENCIDO_SIN_SUBSANAR','DISMISSED',
    'SIN_ANCLA_DISPONIBLE','PRESUNCION_DESCARTADA_POR_AVANCE','VENCIDO_SIN_ACTUACION'])
);

CREATE OR REPLACE FUNCTION public.deadline_attribution(
  p_bound text, p_bound_source text, p_is_judge boolean,
  p_client_role text, p_client_role_source text, p_represents text
) RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE v_bound text := UPPER(COALESCE(p_bound,'DESCONOCIDO'));
        v_role  text := UPPER(COALESCE(p_client_role,''));
        v_rep   text := UPPER(COALESCE(p_represents,''));
        v_side  text;
        v_confirmed boolean := UPPER(COALESCE(p_client_role_source,'')) = 'CONFIRMADO';
        v_own boolean;
BEGIN
  IF COALESCE(p_is_judge,false) OR v_bound = 'JUEZ' THEN RETURN 'JUEZ'; END IF;
  IF UPPER(COALESCE(p_bound_source,'')) = 'CATALOGO_GENERICO' THEN RETURN 'DESCONOCIDO'; END IF;

  v_side := CASE
    WHEN v_role IN ('DEMANDANTE','ACCIONANTE') THEN 'ACTIVA'
    WHEN v_role IN ('DEMANDADO','ACCIONADO') THEN 'PASIVA'
    WHEN v_role = 'APODERADO_DE_OFICIO' AND v_rep = 'DEMANDANTE' THEN 'ACTIVA'
    WHEN v_role = 'APODERADO_DE_OFICIO' AND v_rep = 'DEMANDADO' THEN 'PASIVA'
    ELSE NULL END;

  IF v_bound = 'AMBAS' THEN
    RETURN CASE WHEN v_confirmed THEN 'PROPIO' ELSE 'DESCONOCIDO' END;
  END IF;
  IF v_side IS NULL OR v_bound NOT IN ('DEMANDANTE','DEMANDADO') THEN RETURN 'DESCONOCIDO'; END IF;

  v_own := (v_bound = 'DEMANDANTE' AND v_side = 'ACTIVA')
        OR (v_bound = 'DEMANDADO'  AND v_side = 'PASIVA');
  IF NOT v_own THEN RETURN 'CONTRAPARTE'; END IF;
  RETURN CASE WHEN v_confirmed THEN 'PROPIO' ELSE 'DESCONOCIDO' END;
END $$;

CREATE OR REPLACE VIEW public.v_deadline_attribution
WITH (security_invoker = on) AS
SELECT d.id AS deadline_id, d.work_item_id, d.owner_id, d.organization_id,
       d.status, d.deadline_type, d.label, d.trigger_date, d.deadline_date,
       d.bound_party_role, d.bound_party_source, d.is_judge_side,
       w.client_party_role, w.client_party_role_source, w.client_party_represents,
       public.deadline_attribution(d.bound_party_role, d.bound_party_source, d.is_judge_side,
         w.client_party_role, w.client_party_role_source, w.client_party_represents) AS attribution
FROM public.work_item_deadlines d
JOIN public.work_items w ON w.id = d.work_item_id;

GRANT SELECT ON public.v_deadline_attribution TO authenticated;
GRANT SELECT ON public.v_deadline_attribution TO service_role;

UPDATE public.work_item_deadlines
   SET bound_party_source = 'CATALOGO_FLUJO'
 WHERE bound_party_source IS NULL
   AND bound_party_role IS NOT NULL
   AND bound_party_role <> 'DESCONOCIDO';

CREATE OR REPLACE FUNCTION public.drain_expired_deadlines(p_grace_business_days int DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d record; v_drained int := 0; v_alerts int := 0; v_ids uuid[] := '{}';
BEGIN
  FOR d IN
    SELECT dl.id, dl.deadline_date, dl.status
      FROM public.work_item_deadlines dl
     WHERE dl.status = 'PENDING'
       AND dl.deadline_date IS NOT NULL
       AND dl.deadline_date < CURRENT_DATE
       AND public.business_days_between_sql(dl.deadline_date, CURRENT_DATE) > p_grace_business_days
  LOOP
    UPDATE public.work_item_deadlines
       SET status = 'VENCIDO_SIN_ACTUACION',
           calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
             'drained_at', now(),
             'drained_from_status', d.status,
             'drain_grace_business_days', p_grace_business_days,
             'drain_reason', 'EXPIRO_SIN_ACTUACION_POSTERIOR'),
           updated_at = now()
     WHERE id = d.id;
    v_drained := v_drained + 1;
    v_ids := v_ids || d.id;

    WITH x AS (
      UPDATE public.alert_instances
         SET status = 'CANCELLED'
       WHERE status IN ('PENDING','SENT','ACKNOWLEDGED')
         AND alert_type IN ('TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO')
         AND payload->>'deadline_id' = d.id::text
      RETURNING 1)
    SELECT v_alerts + COUNT(*) INTO v_alerts FROM x;
  END LOOP;

  RETURN jsonb_build_object('drained', v_drained, 'alerts_cancelled', v_alerts,
                            'grace_business_days', p_grace_business_days, 'ids', to_jsonb(v_ids));
END $$;

REVOKE ALL ON FUNCTION public.drain_expired_deadlines(int) FROM public;
GRANT EXECUTE ON FUNCTION public.drain_expired_deadlines(int) TO service_role;

CREATE OR REPLACE FUNCTION public.reopen_drained_deadline(p_deadline_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.work_item_deadlines WHERE id = p_deadline_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_status <> 'VENCIDO_SIN_ACTUACION' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_DRAINED', 'status', v_status);
  END IF;
  UPDATE public.work_item_deadlines
     SET status = 'PENDING',
         calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
           'reopened_at', now(), 'reopened_reason', COALESCE(p_reason,'ACTUACION_POSTERIOR')),
         updated_at = now()
   WHERE id = p_deadline_id;
  RETURN jsonb_build_object('ok', true, 'status', 'PENDING');
END $$;

GRANT EXECUTE ON FUNCTION public.reopen_drained_deadline(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_drained_deadline(uuid, text) TO service_role;