
-- ============================================================
-- ITERATION 14 — monitoring is a derived property
-- ============================================================

-- 1. Routing matrix as data ----------------------------------
CREATE OR REPLACE FUNCTION public.provider_chain_for_workflow(p_workflow text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE upper(COALESCE(p_workflow,''))
    WHEN 'CPACA'  THEN ARRAY['samai','samai_estados']
    WHEN 'TUTELA' THEN ARRAY['cpnu','samai','publicaciones','samai_estados']
    WHEN 'CGP'    THEN ARRAY['cpnu','publicaciones']
    WHEN 'LABORAL' THEN ARRAY['cpnu','publicaciones']
    WHEN 'PENAL'  THEN ARRAY['cpnu','publicaciones']
    WHEN 'PENAL_906' THEN ARRAY['cpnu','publicaciones']
    ELSE ARRAY[]::text[]
  END
$$;

CREATE OR REPLACE FUNCTION public.is_provider_monitored_workflow(p_workflow text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(array_length(public.provider_chain_for_workflow(p_workflow),1),0) > 0
$$;

CREATE OR REPLACE FUNCTION public.provider_scope(p_provider text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE lower(COALESCE(p_provider,''))
    WHEN 'cpnu' THEN 'ACTS'
    WHEN 'samai' THEN 'ACTS'
    ELSE 'PUBS' END
$$;

-- 2. Explicit enrollment rows --------------------------------
CREATE TABLE IF NOT EXISTS public.work_item_provider_enrollment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  provider_key text NOT NULL,
  scope text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, provider_key)
);
GRANT SELECT ON public.work_item_provider_enrollment TO authenticated;
GRANT ALL ON public.work_item_provider_enrollment TO service_role;
ALTER TABLE public.work_item_provider_enrollment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members read enrollment" ON public.work_item_provider_enrollment;
CREATE POLICY "org members read enrollment" ON public.work_item_provider_enrollment
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id = public.get_user_organization_id());

CREATE INDEX IF NOT EXISTS idx_wipe_work_item ON public.work_item_provider_enrollment(work_item_id);

-- 3. Known coverage gaps as data -----------------------------
CREATE TABLE IF NOT EXISTS public.despacho_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radicado_prefix text NOT NULL,
  despacho_label text NOT NULL,
  workflow_type text,
  provider_key text NOT NULL,
  publishes boolean NOT NULL DEFAULT false,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (radicado_prefix, provider_key, workflow_type)
);
GRANT SELECT ON public.despacho_coverage TO authenticated;
GRANT ALL ON public.despacho_coverage TO service_role;
ALTER TABLE public.despacho_coverage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read despacho coverage" ON public.despacho_coverage;
CREATE POLICY "authenticated read despacho coverage" ON public.despacho_coverage
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.despacho_coverage (radicado_prefix, despacho_label, workflow_type, provider_key, publishes, note)
VALUES
  ('05607','Juzgados de El Retiro (Antioquia)', NULL, 'cpnu', false,
   'Los juzgados de El Retiro no publican en CPNU: el silencio de esta fuente es esperado, no una falla.'),
  ('05607','Juzgados de El Retiro (Antioquia)', NULL, 'publicaciones', false,
   'Los juzgados de El Retiro no publican en Publicaciones Procesales: el silencio de esta fuente es esperado.'),
  ('08001','Despachos de Barranquilla', 'CGP', 'cpnu', false,
   'Patrón conocido en Barranquilla: los procesos CGP arrojan publicaciones pero no actuaciones en CPNU.')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.despacho_silence_note(p_radicado text, p_workflow text, p_provider text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT dc.note
    FROM public.despacho_coverage dc
   WHERE dc.publishes = false
     AND lower(dc.provider_key) = lower(COALESCE(p_provider,''))
     AND regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g') LIKE dc.radicado_prefix || '%'
     AND (dc.workflow_type IS NULL OR upper(dc.workflow_type) = upper(COALESCE(p_workflow,'')))
   ORDER BY dc.workflow_type NULLS LAST
   LIMIT 1
$$;

-- 4. Enrollment sync -----------------------------------------
CREATE OR REPLACE FUNCTION public.sync_work_item_enrollment(p_work_item_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  w public.work_items%ROWTYPE;
  v_chain text[];
  n int := 0;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_chain := public.provider_chain_for_workflow(w.workflow_type::text);

  DELETE FROM public.work_item_provider_enrollment e
   WHERE e.work_item_id = p_work_item_id
     AND NOT (e.provider_key = ANY (v_chain));

  IF COALESCE(array_length(v_chain,1),0) = 0 OR w.radicado IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.work_item_provider_enrollment (work_item_id, organization_id, provider_key, scope, enabled)
  SELECT p_work_item_id, w.organization_id, p, public.provider_scope(p),
         COALESCE(w.monitoring_enabled, true)
    FROM unnest(v_chain) p
  ON CONFLICT (work_item_id, provider_key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        organization_id = EXCLUDED.organization_id,
        scope = EXCLUDED.scope,
        updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 5. The invariant: monitoring derived, never asked ----------
CREATE OR REPLACE FUNCTION public.apply_monitoring_invariant()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_eligible boolean;
  v_suspended boolean;
BEGIN
  v_eligible := public.is_provider_monitored_workflow(NEW.workflow_type::text)
                AND NEW.radicado IS NOT NULL
                AND NEW.deleted_at IS NULL
                AND COALESCE(NEW.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED','CLOSED');

  -- Explicit, human suspension is the ONLY way monitoring stays off.
  v_suspended := (NEW.monitoring_disabled_by = 'USER' AND NEW.monitoring_disabled_reason IS NOT NULL);

  IF NOT v_eligible THEN
    NEW.monitoring_enabled := false;
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
END $$;

DROP TRIGGER IF EXISTS trg_apply_monitoring_invariant ON public.work_items;
CREATE TRIGGER trg_apply_monitoring_invariant
  BEFORE INSERT OR UPDATE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_monitoring_invariant();

CREATE OR REPLACE FUNCTION public.sync_enrollment_after_work_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.sync_work_item_enrollment(NEW.id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sync_enrollment_after_work_item ON public.work_items;
CREATE TRIGGER trg_sync_enrollment_after_work_item
  AFTER INSERT OR UPDATE OF workflow_type, radicado, monitoring_enabled, lifecycle_state
  ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_enrollment_after_work_item();

-- 6. Explicit suspension / resume RPCs -----------------------
CREATE OR REPLACE FUNCTION public.suspend_work_item_monitoring(p_work_item_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to suspend monitoring';
  END IF;
  UPDATE public.work_items
     SET monitoring_disabled_by = 'USER',
         monitoring_disabled_reason = btrim(p_reason),
         monitoring_disabled_at = now(),
         updated_at = now()
   WHERE id = p_work_item_id;
  RETURN jsonb_build_object('ok', true, 'suspended', true);
END $$;
GRANT EXECUTE ON FUNCTION public.suspend_work_item_monitoring(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resume_work_item_monitoring(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.work_items
     SET monitoring_disabled_by = NULL,
         monitoring_disabled_reason = NULL,
         monitoring_disabled_at = NULL,
         consecutive_404_count = 0,
         provider_reachable = true,
         updated_at = now()
   WHERE id = p_work_item_id;
  RETURN jsonb_build_object('ok', true, 'resumed', true);
END $$;
GRANT EXECUTE ON FUNCTION public.resume_work_item_monitoring(uuid) TO authenticated;

-- 7. Backfill -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monitoring_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  work_item_id uuid,
  radicado text,
  workflow_type text,
  drift text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.monitoring_reconciliation_log TO authenticated;
GRANT ALL ON public.monitoring_reconciliation_log TO service_role;
ALTER TABLE public.monitoring_reconciliation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform admins read reconciliation log" ON public.monitoring_reconciliation_log;
CREATE POLICY "platform admins read reconciliation log" ON public.monitoring_reconciliation_log
  FOR SELECT TO authenticated USING (public.is_platform_admin());

WITH target AS (
  SELECT id, radicado, workflow_type::text AS wt
    FROM public.work_items
   WHERE deleted_at IS NULL
     AND radicado IS NOT NULL
     AND public.is_provider_monitored_workflow(workflow_type::text)
     AND COALESCE(lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED','CLOSED')
     AND COALESCE(monitoring_enabled,false) = false
), logged AS (
  INSERT INTO public.monitoring_reconciliation_log (work_item_id, radicado, workflow_type, drift, detail)
  SELECT id, radicado, wt, 'AUTOENABLED_ITER14',
         jsonb_build_object('chain', public.provider_chain_for_workflow(wt))
    FROM target
  RETURNING work_item_id
)
UPDATE public.work_items w
   SET lifecycle_state = 'ACTIVE',
       status = 'ACTIVE'::public.item_status,
       monitoring_enabled = true,
       scraping_enabled = true,
       updated_at = now()
  FROM logged l
 WHERE w.id = l.work_item_id;

-- Enroll every eligible item
SELECT public.sync_work_item_enrollment(id)
  FROM public.work_items
 WHERE deleted_at IS NULL
   AND radicado IS NOT NULL
   AND public.is_provider_monitored_workflow(workflow_type::text);

-- 8. Remove the MONITOREO_DESACTIVADO surface -----------------
UPDATE public.alert_instances
   SET status = 'DISMISSED', dismissed_at = now(), dismissal_reason = 'MONITOREO_AUTOACTIVADO_ITER14'
 WHERE alert_type = 'MONITOREO_DESACTIVADO'
   AND status IN ('PENDING','SENT','ACKNOWLEDGED');

DROP FUNCTION IF EXISTS public.detect_monitoring_disabled_live();
DROP FUNCTION IF EXISTS public.list_unmonitored_work_items();

CREATE OR REPLACE FUNCTION public.alert_is_standing(p_alert_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(p_alert_type,'') IN (
    'SUGERENCIA_PENDIENTE','MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR')
$$;

-- 9. Anomalous silence only ------------------------------------
CREATE OR REPLACE FUNCTION public.detect_stale_monitoring(p_threshold_days integer DEFAULT 45)
RETURNS TABLE(work_item_id uuid, radicado text, reason text, days_since_ingest integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r RECORD;
  v_day TEXT := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
  v_reason TEXT;
  v_title TEXT;
  v_explained boolean;
BEGIN
  FOR r IN
    SELECT * FROM public.monitoring_coverage_v
    WHERE monitoring_enabled
      AND public.is_provider_monitored_workflow(workflow_type)
      AND (
        coverage_status IN ('SIN_ENROLAMIENTO', 'ENROLAMIENTO_PARCIAL', 'SIN_RADICADO_VALIDO')
        OR last_ingest IS NULL
        OR last_ingest < now() - make_interval(days => p_threshold_days)
      )
  LOOP
    -- Silence from a source that is known never to publish for this despacho
    -- is expected, not anomalous: do not alarm.
    SELECT bool_and(public.despacho_silence_note(r.radicado, r.workflow_type, p) IS NOT NULL)
      INTO v_explained
      FROM unnest(public.provider_chain_for_workflow(r.workflow_type)) p
     WHERE public.provider_scope(p) = 'ACTS';
    IF COALESCE(v_explained, false) THEN
      CONTINUE;
    END IF;

    IF r.coverage_status = 'SIN_ENROLAMIENTO' OR r.coverage_status = 'SIN_RADICADO_VALIDO' THEN
      v_reason := r.coverage_status;
      v_title := 'Proceso monitoreado sin proveedor activo';
    ELSIF r.coverage_status = 'ENROLAMIENTO_PARCIAL' THEN
      v_reason := 'ENROLAMIENTO_PARCIAL';
      v_title := 'Cobertura incompleta de proveedores';
    ELSE
      v_reason := 'SIN_INGESTA';
      v_title := 'Sin ingesta desde ' ||
                 COALESCE(to_char(r.last_ingest AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'), 'nunca');
    END IF;

    BEGIN
      INSERT INTO alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        r.owner_id, r.organization_id, r.work_item_id, 'WORK_ITEM',
        'WARN'::alert_severity,
        CASE WHEN v_reason = 'SIN_INGESTA' THEN 'MONITOREO_SIN_INGESTA' ELSE 'MONITOREO_SIN_PROVEEDOR' END,
        'SISTEMA', v_title,
        'El proceso ' || COALESCE(r.radicado, '(sin radicado)') ||
        ' está monitoreado pero ' ||
        CASE WHEN v_reason = 'SIN_INGESTA'
             THEN 'no recibe filas nuevas de los proveedores hace ' || COALESCE(r.days_since_ingest, 9999) || ' días, pese a que reportan éxito.'
             ELSE 'no está inscrito con los proveedores esperados (' || array_to_string(r.missing_providers, ', ') || ').'
        END,
        'PENDING',
        build_dedupe_key('monitoreo_' || lower(v_reason), r.work_item_id::text, v_day),
        jsonb_build_object(
          'radicado', r.radicado, 'reason', v_reason,
          'days_since_ingest', r.days_since_ingest,
          'last_ingest', r.last_ingest, 'last_ok_run', r.last_ok_run,
          'expected_providers', r.expected_providers,
          'enrolled_providers', r.enrolled_providers,
          'missing_providers', r.missing_providers
        )
      ) ON CONFLICT (fingerprint) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[detect_stale_monitoring] alert insert failed: %', SQLERRM;
    END;

    work_item_id := r.work_item_id;
    radicado := r.radicado;
    reason := v_reason;
    days_since_ingest := COALESCE(r.days_since_ingest, 9999);
    RETURN NEXT;
  END LOOP;
END $$;

-- 10. Per-work-item coverage truth -----------------------------
CREATE OR REPLACE FUNCTION public.get_work_item_coverage(p_work_item_id uuid)
RETURNS TABLE(
  provider_key text, scope text, provider_label text,
  last_ok_run timestamptz, last_ingest timestamptz,
  status_code text, status_label text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  w public.work_items%ROWTYPE;
  p text;
  v_note text;
  v_acts timestamptz;
  v_pubs timestamptz;
  v_run timestamptz;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT (public.is_platform_admin() OR w.organization_id = public.get_user_organization_id()) THEN
    RETURN;
  END IF;

  SELECT max(a.created_at) INTO v_acts FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id AND a.is_archived IS NOT TRUE;
  SELECT max(pu.created_at) INTO v_pubs FROM public.work_item_publicaciones pu
   WHERE pu.work_item_id = p_work_item_id AND pu.is_archived IS NOT TRUE;
  SELECT max(s.created_at) INTO v_run FROM public.external_sync_runs s
   WHERE s.work_item_id = p_work_item_id AND s.status IN ('SUCCESS','PARTIAL');

  FOREACH p IN ARRAY public.provider_chain_for_workflow(w.workflow_type::text) LOOP
    provider_key := p;
    scope := public.provider_scope(p);
    provider_label := CASE p
      WHEN 'cpnu' THEN 'CPNU (actuaciones)'
      WHEN 'samai' THEN 'SAMAI (actuaciones)'
      WHEN 'publicaciones' THEN 'Publicaciones Procesales (estados)'
      WHEN 'samai_estados' THEN 'SAMAI Estados' ELSE p END;
    last_ok_run := v_run;
    last_ingest := CASE WHEN scope = 'ACTS' THEN v_acts ELSE v_pubs END;
    v_note := public.despacho_silence_note(w.radicado, w.workflow_type::text, p);

    IF last_ingest IS NOT NULL THEN
      status_code := 'CUBIERTO';
      status_label := 'Cubierto';
    ELSIF v_note IS NOT NULL THEN
      status_code := 'SILENCIO_CONOCIDO';
      status_label := v_note;
    ELSIF v_run IS NULL THEN
      status_code := 'SIN_RESPUESTA';
      status_label := 'Sin respuesta del proveedor';
    ELSE
      status_code := 'SIN_FILAS';
      status_label := CASE WHEN scope = 'ACTS'
        THEN 'Sin actuaciones: el proveedor responde, pero no reporta filas para este radicado.'
        ELSE 'Sin publicaciones: el proveedor responde, pero no reporta filas para este radicado.' END;
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.get_work_item_coverage(uuid) TO authenticated;

-- 11. Daily reconciliation, before the 7am sync ----------------
CREATE OR REPLACE FUNCTION public.reconcile_monitoring_invariant()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_fixed int := 0;
  v_enrolled int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, radicado, workflow_type::text AS wt
      FROM public.work_items
     WHERE deleted_at IS NULL
       AND radicado IS NOT NULL
       AND public.is_provider_monitored_workflow(workflow_type::text)
       AND COALESCE(lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED','CLOSED')
       AND COALESCE(monitoring_enabled,false) = false
       AND NOT (monitoring_disabled_by = 'USER' AND monitoring_disabled_reason IS NOT NULL)
  LOOP
    UPDATE public.work_items SET monitoring_enabled = true, updated_at = now() WHERE id = r.id;
    INSERT INTO public.monitoring_reconciliation_log (work_item_id, radicado, workflow_type, drift, detail)
    VALUES (r.id, r.radicado, r.wt, 'MONITORING_SILENTLY_OFF',
            jsonb_build_object('chain', public.provider_chain_for_workflow(r.wt)));
    v_fixed := v_fixed + 1;
  END LOOP;

  FOR r IN
    SELECT w.id, w.radicado, w.workflow_type::text AS wt
      FROM public.work_items w
     WHERE w.deleted_at IS NULL
       AND w.radicado IS NOT NULL
       AND public.is_provider_monitored_workflow(w.workflow_type::text)
       AND (
         SELECT count(*) FROM public.work_item_provider_enrollment e WHERE e.work_item_id = w.id
       ) <> COALESCE(array_length(public.provider_chain_for_workflow(w.workflow_type::text),1),0)
  LOOP
    PERFORM public.sync_work_item_enrollment(r.id);
    INSERT INTO public.monitoring_reconciliation_log (work_item_id, radicado, workflow_type, drift, detail)
    VALUES (r.id, r.radicado, r.wt, 'ENROLLMENT_MISSING',
            jsonb_build_object('chain', public.provider_chain_for_workflow(r.wt)));
    v_enrolled := v_enrolled + 1;
  END LOOP;

  RETURN jsonb_build_object('monitoring_fixed', v_fixed, 'enrollment_fixed', v_enrolled);
END $$;

SELECT cron.unschedule('detect-monitoring-disabled-live');
SELECT cron.schedule('reconcile-monitoring-invariant', '50 11 * * *',
  $$SELECT public.reconcile_monitoring_invariant();$$);
