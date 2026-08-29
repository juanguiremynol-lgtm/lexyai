ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS 'GHOST_SUSPECTED';

-- IQ1(c): remove the CASE that filled monitoring_disabled_reason with
-- 'EXPEDIENTE_NO_ACTIVO' from our own lifecycle_state. A label that reads
-- "not active because it is not active" is a second-order inference, not a
-- finding, and must not reach a lawyer's screen.
-- IQ1(d): historical rows carrying it are NOT rewritten. They are the record.
CREATE OR REPLACE FUNCTION public.apply_monitoring_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_provider_workflow boolean;
  v_active boolean;
  v_has_radicado boolean;
  v_eligible boolean;
  v_suspended boolean;
BEGIN
  v_provider_workflow := public.is_provider_monitored_workflow(NEW.workflow_type::text);
  v_active := NEW.deleted_at IS NULL
              AND COALESCE(NEW.lifecycle_state::text,'ACTIVE') = 'ACTIVE';
  v_has_radicado := NULLIF(btrim(COALESCE(NEW.radicado,'')), '') IS NOT NULL;
  v_eligible := v_provider_workflow AND v_active AND v_has_radicado;

  v_suspended := COALESCE(NEW.monitoring_disabled_by, '') = 'USER'
                 AND COALESCE(btrim(NEW.monitoring_disabled_reason), '') <> '';

  IF NOT v_eligible THEN
    NEW.monitoring_enabled := false;
    IF COALESCE(btrim(NEW.monitoring_disabled_reason), '') = '' THEN
      NEW.monitoring_disabled_reason := CASE
        WHEN NOT v_provider_workflow THEN 'WORKFLOW_SIN_PROVEEDOR'
        WHEN NEW.deleted_at IS NOT NULL THEN 'ASUNTO_ELIMINADO'
        -- State the verifiable fact (our own lifecycle value), never an
        -- inference about the expediente.
        WHEN NOT v_active THEN 'CICLO_DE_VIDA_' || COALESCE(NEW.lifecycle_state::text,'DESCONOCIDO')
        ELSE 'PENDIENTE_DE_RADICACION'
      END;
      NEW.monitoring_disabled_at := COALESCE(NEW.monitoring_disabled_at, now());
      NEW.monitoring_disabled_by := COALESCE(NEW.monitoring_disabled_by, 'SYSTEM');
    END IF;
  ELSIF NOT v_suspended THEN
    NEW.monitoring_enabled := true;
    NEW.monitoring_disabled_reason := NULL;
    NEW.monitoring_disabled_at := NULL;
    NEW.monitoring_disabled_by := NULL;
    NEW.demonitor_reason := NULL;
    NEW.demonitor_at := NULL;
  ELSE
    NEW.monitoring_enabled := false;
  END IF;

  RETURN NEW;
END;
$function$;

-- IQ2(d): monitoring_coverage_v no longer collapses the four channels into a
-- single scalar. get_work_item_coverage is already per-channel and correct;
-- this is a fix to the aggregate so it agrees with it.
DROP VIEW IF EXISTS public.monitoring_coverage_v;
CREATE VIEW public.monitoring_coverage_v AS
 WITH base AS (
         SELECT w.id, w.radicado, w.workflow_type, w.organization_id, w.owner_id,
            w.monitoring_enabled, w.status, w.lifecycle_state,
            provider_chain_for_workflow((w.workflow_type)::text) AS expected_providers
           FROM work_items w
          WHERE ((w.status = 'ACTIVE'::item_status)
             AND (w.lifecycle_state = 'ACTIVE'::work_item_lifecycle_state)
             AND (w.deleted_at IS NULL))
        ), scoped AS (
         SELECT b_1.id AS work_item_id,
            ARRAY(SELECT p FROM unnest(b_1.expected_providers) p WHERE public.provider_scope(p) = 'ACTS') AS expected_acts,
            ARRAY(SELECT p FROM unnest(b_1.expected_providers) p WHERE public.provider_scope(p) <> 'ACTS') AS expected_estados
           FROM base b_1
        ), last_row AS (
         SELECT u.work_item_id, max(u.created_at) AS last_ingest
           FROM ( SELECT a.work_item_id, a.created_at FROM work_item_acts a WHERE (a.is_archived IS NOT TRUE)
                UNION ALL
                 SELECT p.work_item_id, p.created_at FROM work_item_publicaciones p WHERE (p.is_archived IS NOT TRUE)) u
          GROUP BY u.work_item_id
        ), row_counts AS (
         SELECT b_1.id AS work_item_id,
            (SELECT count(*) FROM work_item_acts a WHERE ((a.work_item_id = b_1.id) AND (a.is_archived IS NOT TRUE))) AS act_count,
            (SELECT count(*) FROM work_item_publicaciones p WHERE ((p.work_item_id = b_1.id) AND (p.is_archived IS NOT TRUE))) AS publication_count
           FROM base b_1
        ), last_run AS (
         SELECT r.work_item_id,
            max(r.created_at) FILTER (WHERE (r.status = ANY (ARRAY['SUCCESS'::text, 'PARTIAL'::text]))) AS last_ok_run,
            max(r.created_at) AS last_run
           FROM external_sync_runs r
          GROUP BY r.work_item_id
        ), attempts AS (
         SELECT x.work_item_id, array_agg(DISTINCT lower((x.attempt ->> 'provider'::text))) AS providers
           FROM ( SELECT r.work_item_id,
                    jsonb_array_elements(CASE WHEN (jsonb_typeof(r.provider_attempts) = 'array'::text) THEN r.provider_attempts ELSE '[]'::jsonb END) AS attempt
                   FROM external_sync_runs r
                  WHERE (r.created_at > (now() - '30 days'::interval))) x
          WHERE ((x.attempt ->> 'provider'::text) IS NOT NULL)
          GROUP BY x.work_item_id
        )
 SELECT b.id AS work_item_id,
    b.radicado,
    (b.workflow_type)::text AS workflow_type,
    b.organization_id,
    b.owner_id,
    b.monitoring_enabled,
    b.expected_providers,
    sc.expected_acts AS expected_acts_providers,
    sc.expected_estados AS expected_estados_providers,
    COALESCE(at.providers, ARRAY[]::text[]) AS enrolled_providers,
    ARRAY(SELECT unnest(b.expected_providers) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))) AS missing_providers,
    ARRAY(SELECT unnest(sc.expected_acts) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))) AS missing_acts_providers,
    ARRAY(SELECT unnest(sc.expected_estados) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))) AS missing_estados_providers,
    lr.last_ingest,
    ru.last_ok_run,
    ru.last_run,
        CASE
            WHEN ((b.radicado IS NULL) OR (length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21)) THEN 'SIN_RADICADO_VALIDO'::text
            WHEN (COALESCE(array_length(at.providers, 1), 0) = 0) THEN 'SIN_ENROLAMIENTO'::text
            WHEN (array_length(ARRAY(SELECT unnest(b.expected_providers) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))), 1) > 0) THEN 'ENROLAMIENTO_PARCIAL'::text
            WHEN ((rc.act_count = 0) AND (rc.publication_count = 0) AND (ru.last_ok_run IS NOT NULL)) THEN 'LEIDO_Y_VACIO'::text
            ELSE 'OK'::text
        END AS coverage_status,
    -- Per-channel verdicts. Emptiness is reported, never graded as degraded.
        CASE
            WHEN ((b.radicado IS NULL) OR (length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21)) THEN 'SIN_RADICADO_VALIDO'::text
            WHEN (COALESCE(array_length(sc.expected_acts, 1), 0) = 0) THEN 'SIN_CANAL'::text
            WHEN (array_length(ARRAY(SELECT unnest(sc.expected_acts) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))), 1) > 0) THEN 'SIN_ENROLAMIENTO'::text
            WHEN (rc.act_count > 0) THEN 'CUBIERTO'::text
            WHEN (ru.last_ok_run IS NULL) THEN 'EN_VERIFICACION'::text
            ELSE 'SIN_FILAS'::text
        END AS acts_coverage_status,
        CASE
            WHEN ((b.radicado IS NULL) OR (length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21)) THEN 'SIN_RADICADO_VALIDO'::text
            WHEN (COALESCE(array_length(sc.expected_estados, 1), 0) = 0) THEN 'SIN_CANAL'::text
            WHEN (array_length(ARRAY(SELECT unnest(sc.expected_estados) EXCEPT SELECT unnest(COALESCE(at.providers, ARRAY[]::text[]))), 1) > 0) THEN 'SIN_ENROLAMIENTO'::text
            WHEN (rc.publication_count > 0) THEN 'CUBIERTO'::text
            WHEN (ru.last_ok_run IS NULL) THEN 'EN_VERIFICACION'::text
            ELSE 'SIN_FILAS'::text
        END AS estados_coverage_status,
    ((now())::date - (lr.last_ingest)::date) AS days_since_ingest,
    rc.act_count,
    rc.publication_count
   FROM (((((base b
     JOIN scoped sc ON ((sc.work_item_id = b.id)))
     LEFT JOIN last_row lr ON ((lr.work_item_id = b.id)))
     LEFT JOIN row_counts rc ON ((rc.work_item_id = b.id)))
     LEFT JOIN last_run ru ON ((ru.work_item_id = b.id)))
     LEFT JOIN attempts at ON ((at.work_item_id = b.id)));

-- IQ2(d) + IQ3(a): detect_stale_monitoring no longer alerts on emptiness at
-- all (LEIDO_Y_VACIO / SIN_FILAS are normal states), and evaluates the
-- explanation per channel instead of over ACTS only.
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