-- Canonical, idempotent installer/verifier for the three owner-applied repairs.
-- The view definition is never replaced; security_invoker remains true on future definitions.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '15s';

DO $guard$
DECLARE
  v_function_hash text;
BEGIN
  IF to_regclass('public.monitoring_coverage_v') IS NULL
    OR to_regclass('public.work_items') IS NULL
    OR to_regclass('public.work_item_provider_enrollment') IS NULL
    OR to_regclass('public.work_item_acts') IS NULL
    OR to_regclass('public.work_item_publicaciones') IS NULL
    OR to_regclass('public.external_sync_runs') IS NULL
    OR to_regclass('public.alert_instances') IS NULL THEN
    RAISE EXCEPTION 'Required monitoring schema is absent';
  END IF;
  IF to_regclass('public.idx_work_item_acts_owner') IS NULL
    OR to_regclass('public.idx_work_item_acts_work_item_id') IS NULL THEN
    RAISE EXCEPTION 'Equivalent retained indexes must exist before duplicate removal';
  END IF;
  IF to_regprocedure('public.detect_stale_monitoring(integer)') IS NOT NULL THEN
    SELECT md5(pg_get_functiondef(to_regprocedure('public.detect_stale_monitoring(integer)'))::oid)
      INTO v_function_hash;
    IF v_function_hash NOT IN ('b2b37d1e88f335e412326aa099f5b193','81078e852c70e526b9c80807abbae7f0') THEN
      RAISE EXCEPTION 'Unknown detect_stale_monitoring version: %', v_function_hash;
    END IF;
  END IF;
END
$guard$;

ALTER VIEW public.monitoring_coverage_v SET (security_invoker = true);

DROP INDEX IF EXISTS public.idx_work_item_acts_org;
DROP INDEX IF EXISTS public.idx_work_item_acts_work_item;

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
    WITH base AS MATERIALIZED (
      SELECT w.id AS work_item_id,w.radicado,w.workflow_type::text AS workflow_type,w.organization_id,w.owner_id,
        public.provider_chain_for_workflow(w.workflow_type::text) AS expected_providers,
        (w.radicado IS NULL OR length(regexp_replace(w.radicado,'\D','','g'))<21) AS invalid_radicado
      FROM public.work_items w
      WHERE w.deleted_at IS NULL AND w.lifecycle_state='ACTIVE' AND w.status='ACTIVE' AND w.monitoring_enabled
        AND public.is_provider_monitored_workflow(w.workflow_type::text)
    ), scoped AS MATERIALIZED (
      SELECT z.*,
        ARRAY(SELECT p FROM unnest(z.expected_providers)p WHERE public.provider_scope(p)='ACTS') AS expected_acts_providers,
        ARRAY(SELECT p FROM unnest(z.expected_providers)p WHERE public.provider_scope(p)<>'ACTS') AS expected_estados_providers,
        ARRAY(SELECT DISTINCT lower(e.provider_key) FROM public.work_item_provider_enrollment e
          WHERE e.work_item_id=z.work_item_id AND e.organization_id IS NOT DISTINCT FROM z.organization_id AND e.enabled
            AND e.scope=public.provider_scope(e.provider_key) ORDER BY lower(e.provider_key)) AS enrolled_providers
      FROM base z
    ), gaps AS MATERIALIZED (
      SELECT z.*,
        ARRAY(SELECT p FROM unnest(z.expected_acts_providers)p WHERE NOT(p=ANY(z.enrolled_providers))) AS missing_acts_providers,
        ARRAY(SELECT p FROM unnest(z.expected_estados_providers)p WHERE NOT(p=ANY(z.enrolled_providers))) AS missing_estados_providers
      FROM scoped z
    ), candidates AS MATERIALIZED (
      SELECT z.*,
        CASE WHEN z.invalid_radicado THEN 'SIN_RADICADO_VALIDO' WHEN cardinality(z.missing_acts_providers)>0 THEN 'SIN_ENROLAMIENTO' WHEN cardinality(z.expected_acts_providers)=0 THEN 'SIN_CANAL' ELSE 'CUBIERTO' END AS acts_coverage_status,
        CASE WHEN z.invalid_radicado THEN 'SIN_RADICADO_VALIDO' WHEN cardinality(z.missing_estados_providers)>0 THEN 'SIN_ENROLAMIENTO' WHEN cardinality(z.expected_estados_providers)=0 THEN 'SIN_CANAL' ELSE 'CUBIERTO' END AS estados_coverage_status
      FROM gaps z WHERE z.invalid_radicado OR cardinality(z.missing_acts_providers)>0 OR cardinality(z.missing_estados_providers)>0
    )
    SELECT c.*,aa.act_count,pp.publication_count,greatest(aa.last_act,pp.last_publication) AS last_ingest,
      rr.last_ok_run, now()::date-greatest(aa.last_act,pp.last_publication)::date AS days_since_ingest
    FROM candidates c
    LEFT JOIN LATERAL (SELECT count(*) AS act_count,max(x.created_at) AS last_act FROM public.work_item_acts x WHERE x.work_item_id=c.work_item_id AND x.is_archived IS NOT TRUE)aa ON true
    LEFT JOIN LATERAL (SELECT count(*) AS publication_count,max(x.created_at) AS last_publication FROM public.work_item_publicaciones x WHERE x.work_item_id=c.work_item_id AND x.is_archived IS NOT TRUE)pp ON true
    LEFT JOIN LATERAL (SELECT max(x.created_at) FILTER(WHERE x.status IN('SUCCESS','PARTIAL')) AS last_ok_run FROM public.external_sync_runs x WHERE x.work_item_id=c.work_item_id)rr ON true
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
        jsonb_build_object('enrollment_evidence_source','work_item_provider_enrollment','radicado', r.radicado, 'reason', v_reason,
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
DECLARE
  v_view_hash text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.monitoring_coverage_v'::regclass
      AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'monitoring_coverage_v is not security_invoker';
  END IF;
  IF md5(pg_get_functiondef('public.detect_stale_monitoring(integer)'::regprocedure))
    <> '81078e852c70e526b9c80807abbae7f0' THEN
    RAISE EXCEPTION 'detect_stale_monitoring hash mismatch';
  END IF;
  IF to_regclass('public.idx_work_item_acts_org') IS NOT NULL
    OR to_regclass('public.idx_work_item_acts_work_item') IS NOT NULL
    OR to_regclass('public.idx_work_item_acts_owner') IS NULL
    OR to_regclass('public.idx_work_item_acts_work_item_id') IS NULL THEN
    RAISE EXCEPTION 'final index state mismatch';
  END IF;
  v_view_hash := md5(pg_get_viewdef('public.monitoring_coverage_v'::regclass, true));
  IF v_view_hash IS DISTINCT FROM 'b8e7f50a2ab1b2235315818f6cdd51cb' THEN
    RAISE NOTICE 'Preserving later view definition with security_invoker=true; md5=%', v_view_hash;
  END IF;
END
$verify$;

COMMIT;
