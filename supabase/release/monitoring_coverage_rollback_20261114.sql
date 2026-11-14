-- Explicit rollback of the three audited manual repairs; not run by deployment.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '15s';

DO $guard$
BEGIN
  IF to_regprocedure('public.detect_stale_monitoring(integer)') IS NOT NULL
    AND md5(pg_get_functiondef('public.detect_stale_monitoring(integer)'::regprocedure))
      <> '81078e852c70e526b9c80807abbae7f0' THEN
    RAISE EXCEPTION 'Refusing to replace an unknown detect_stale_monitoring version';
  END IF;
END
$guard$;

ALTER VIEW public.monitoring_coverage_v RESET (security_invoker);

CREATE INDEX IF NOT EXISTS idx_work_item_acts_org
  ON public.work_item_acts USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_work_item_acts_work_item
  ON public.work_item_acts USING btree (work_item_id);

CREATE OR REPLACE FUNCTION public.detect_stale_monitoring(p_threshold_days integer DEFAULT 45)
 RETURNS TABLE(work_item_id uuid, radicado text, reason text, days_since_ingest integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_day text := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
  v_reason text; v_title text; v_acts_expl boolean; v_estados_expl boolean;
  v_missing text[];
BEGIN
  FOR r IN
    SELECT mc.* FROM public.monitoring_coverage_v mc
      JOIN public.v_monitored_work_items m ON m.id = mc.work_item_id
     WHERE mc.monitoring_enabled
       AND public.is_provider_monitored_workflow(mc.workflow_type)
       -- Enrolment problems only. Emptiness is never an alert (IQ1b/IQ3b):
       -- a new matter and a court that does not feed the expediente digital
       -- are both normal, and neither says anything about the expediente.
       AND (mc.acts_coverage_status IN ('SIN_ENROLAMIENTO','SIN_RADICADO_VALIDO')
         OR mc.estados_coverage_status IN ('SIN_ENROLAMIENTO','SIN_RADICADO_VALIDO'))
  LOOP
    -- Per-channel explanation: a channel this court is evidenced not to use
    -- explains its own absence and cannot make the other channel alertable.
    SELECT bool_and(
             public.despacho_silence_note(r.radicado, r.workflow_type, p) IS NOT NULL
             OR public.despacho_profile_explains_absence(r.radicado, 'ACTS', now()))
      INTO v_acts_expl
      FROM unnest(COALESCE(r.expected_acts_providers, ARRAY[]::text[])) p;

    SELECT bool_and(
             public.despacho_silence_note(r.radicado, r.workflow_type, p) IS NOT NULL
             OR public.despacho_profile_explains_absence(r.radicado, 'ESTADOS', now()))
      INTO v_estados_expl
      FROM unnest(COALESCE(r.expected_estados_providers, ARRAY[]::text[])) p;

    v_missing := ARRAY[]::text[];
    IF r.acts_coverage_status = 'SIN_ENROLAMIENTO' AND NOT COALESCE(v_acts_expl, false) THEN
      v_missing := v_missing || COALESCE(r.missing_acts_providers, ARRAY[]::text[]);
    END IF;
    IF r.estados_coverage_status = 'SIN_ENROLAMIENTO' AND NOT COALESCE(v_estados_expl, false) THEN
      v_missing := v_missing || COALESCE(r.missing_estados_providers, ARRAY[]::text[]);
    END IF;

    IF r.acts_coverage_status = 'SIN_RADICADO_VALIDO' OR r.estados_coverage_status = 'SIN_RADICADO_VALIDO' THEN
      v_reason := 'SIN_RADICADO_VALIDO'; v_title := 'Proceso monitoreado sin radicado válido';
    ELSIF array_length(v_missing, 1) > 0 THEN
      v_reason := 'SIN_ENROLAMIENTO'; v_title := 'Cobertura incompleta de proveedores';
    ELSE
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        r.owner_id, r.organization_id, r.work_item_id, 'WORK_ITEM',
        'WARN'::public.alert_severity,
        'MONITOREO_SIN_PROVEEDOR',
        'SISTEMA', v_title,
        'El proceso ' || COALESCE(r.radicado, '(sin radicado)') || ' está monitoreado pero ' ||
        CASE WHEN v_reason = 'SIN_RADICADO_VALIDO'
             THEN 'su radicado no permite consultar a los proveedores.'
             ELSE 'no está inscrito con los proveedores esperados (' || array_to_string(v_missing, ', ') || ').' END ||
        ' Esto no dice nada sobre el expediente: no significa que esté cerrado ni que no exista.',
        'PENDING',
        public.build_dedupe_key('monitoreo_' || lower(v_reason), r.work_item_id::text, v_day),
        jsonb_build_object('radicado', r.radicado, 'reason', v_reason,
          'acts_coverage_status', r.acts_coverage_status,
          'estados_coverage_status', r.estados_coverage_status,
          'act_count', r.act_count, 'publication_count', r.publication_count,
          'last_ingest', r.last_ingest, 'last_ok_run', r.last_ok_run,
          'expected_providers', r.expected_providers,
          'enrolled_providers', r.enrolled_providers,
          'missing_providers', v_missing)
      ) ON CONFLICT (fingerprint) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[detect_stale_monitoring] alert insert failed: %', SQLERRM;
    END;

    work_item_id := r.work_item_id; radicado := r.radicado; reason := v_reason;
    days_since_ingest := COALESCE(r.days_since_ingest, 9999);
    RETURN NEXT;
  END LOOP;
END $function$;

DO $verify$
BEGIN
  IF md5(pg_get_functiondef('public.detect_stale_monitoring(integer)'::regprocedure))
    <> 'b2b37d1e88f335e412326aa099f5b193' THEN
    RAISE EXCEPTION 'rollback function hash mismatch';
  END IF;
  IF to_regclass('public.idx_work_item_acts_org') IS NULL
    OR to_regclass('public.idx_work_item_acts_work_item') IS NULL THEN
    RAISE EXCEPTION 'rollback index state mismatch';
  END IF;
END
$verify$;

COMMIT;
