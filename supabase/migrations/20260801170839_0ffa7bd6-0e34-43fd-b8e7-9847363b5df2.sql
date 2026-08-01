
-- ============================================================================
-- ITERATION 8.2 — Retroactive actuaciones + stale monitoring
-- ============================================================================

-- 1) Ingest run mode: only sweep-sourced rows may be classified histórico.
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS ingest_run_mode text NOT NULL DEFAULT 'DAILY',
  ADD COLUMN IF NOT EXISTS retro_gap_days integer;

ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS ingest_run_mode text NOT NULL DEFAULT 'DAILY',
  ADD COLUMN IF NOT EXISTS discovery_type text,
  ADD COLUMN IF NOT EXISTS is_retroactive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retro_gap_days integer;

-- 2) Term-opening vocabulary → drives CRITICAL severity.
CREATE OR REPLACE FUNCTION public.unaccent_lower_safe(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(lower(COALESCE(p_text, '')),
                   'áéíóúüñÁÉÍÓÚÜÑ',
                   'aeiouunAEIOUUN');
$$;

CREATE OR REPLACE FUNCTION public.is_term_opening_text(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    unaccent_lower_safe(p_text) ~
      '(fijacion +estado|fijacion +en +estado|no +repone|decide +apelacion|decide +recurso|remision +al +superior|envio +a +superior|traslado|requiere|corre +traslado|concede +recurso|admite +demanda|mandamiento +de +pago)',
    false
  );
$$;

-- 3) Canonical discovery classifier.
--    NOVEDAD                — legal date inside the recency window.
--    ACTUACION_RETROACTIVA  — legal date outside the window but the row arrived
--                             in a NORMAL daily sync (court registered it late).
--    HISTORICO_DETECTADO    — only for rows arriving in an explicit sweep/backfill.
CREATE OR REPLACE FUNCTION public.classify_discovery(
  p_legal_date date,
  p_detected_at timestamptz,
  p_run_mode text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sweep boolean := COALESCE(upper(p_run_mode), 'DAILY') IN ('SWEEP', 'FULL_SWEEP', 'HISTORICAL', 'BACKFILL', 'IMPORT');
  v_recent boolean;
BEGIN
  v_recent := p_legal_date IS NOT NULL AND NOT public.is_historico_by_legal_date(p_legal_date);
  IF v_recent THEN
    RETURN 'NOVEDAD';
  END IF;
  IF v_sweep THEN
    RETURN 'HISTORICO_DETECTADO';
  END IF;
  -- Normal daily sync + old legal date = retroactive registration = NEWS.
  RETURN 'ACTUACION_RETROACTIVA';
END;
$$;

-- 4) BEFORE INSERT stamping on acts.
CREATE OR REPLACE FUNCTION public.stamp_act_discovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.discovery_type IS NULL THEN
    NEW.discovery_type := public.classify_discovery(
      NEW.act_date, COALESCE(NEW.detected_at, now()), NEW.ingest_run_mode
    );
  END IF;
  NEW.is_retroactive := (NEW.discovery_type = 'ACTUACION_RETROACTIVA');
  IF NEW.act_date IS NOT NULL THEN
    NEW.retro_gap_days := GREATEST(
      0,
      (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date - NEW.act_date
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_act_discovery ON public.work_item_acts;
CREATE TRIGGER trg_stamp_act_discovery
BEFORE INSERT ON public.work_item_acts
FOR EACH ROW EXECUTE FUNCTION public.stamp_act_discovery();

-- 5) BEFORE INSERT stamping on publicaciones (legal date = fijación).
CREATE OR REPLACE FUNCTION public.stamp_pub_discovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_legal date := COALESCE(NEW.fecha_fijacion, NEW.fecha_desfijacion, NEW.published_at::date);
BEGIN
  IF NEW.discovery_type IS NULL THEN
    NEW.discovery_type := public.classify_discovery(
      v_legal, COALESCE(NEW.detected_at, now()), NEW.ingest_run_mode
    );
  END IF;
  NEW.is_retroactive := (NEW.discovery_type = 'ACTUACION_RETROACTIVA');
  IF v_legal IS NOT NULL THEN
    NEW.retro_gap_days := GREATEST(
      0, (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date - v_legal
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_pub_discovery ON public.work_item_publicaciones;
CREATE TRIGGER trg_stamp_pub_discovery
BEFORE INSERT ON public.work_item_publicaciones
FOR EACH ROW EXECUTE FUNCTION public.stamp_pub_discovery();

-- 6) Alerting: retroactive rows are NEWS. Only sweep-sourced histórico stays silent.
CREATE OR REPLACE FUNCTION public.notify_new_actuacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_work_item RECORD;
  v_radicado TEXT;
  v_recipient UUID;
  v_hour_bucket TEXT;
  v_portal TEXT;
  v_discovery TEXT := COALESCE(NEW.discovery_type, 'NOVEDAD');
  v_retro BOOLEAN;
  v_severity TEXT;
  v_alert_type TEXT;
  v_title TEXT;
  v_gap INT := COALESCE(NEW.retro_gap_days, 0);
BEGIN
  -- Genuine historical backfill (explicit sweep) never alerts.
  IF v_discovery = 'HISTORICO_DETECTADO' THEN
    RETURN NEW;
  END IF;

  v_retro := (v_discovery = 'ACTUACION_RETROACTIVA');

  BEGIN
    SELECT owner_id, organization_id, radicado, demandantes, demandados, authority_name
      INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    v_recipient := v_work_item.owner_id;
    v_radicado := v_work_item.radicado;
    v_hour_bucket := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD-HH24');
    v_portal := normalize_alert_source(NEW.source);

    IF v_retro THEN
      v_alert_type := 'ACTUACION_RETROACTIVA';
      v_severity := CASE
        WHEN public.is_term_opening_text(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.act_type, ''))
        THEN 'CRITICAL' ELSE 'WARN' END;
      v_title := 'Actuación con fecha retroactiva (' || v_gap || ' días) en ' || COALESCE(v_radicado, 'proceso');
    ELSE
      v_alert_type := 'ACTUACION_NUEVA';
      v_severity := 'INFO';
      v_title := 'Nueva actuación en ' || COALESCE(v_radicado, 'proceso');
    END IF;

    PERFORM insert_notification(
      'USER', v_recipient, 'WORK_ITEM_ALERTS', v_alert_type,
      v_title,
      COALESCE(LEFT(NEW.description, 200), 'Actuación registrada'),
      CASE WHEN v_severity = 'CRITICAL' THEN 'error' WHEN v_severity = 'WARN' THEN 'warning' ELSE 'info' END,
      jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
        'act_date', NEW.act_date, 'source', NEW.source, 'aggregated_count', 1,
        'discovery_type', v_discovery, 'retro_gap_days', v_gap),
      build_dedupe_key(lower(v_alert_type), NEW.work_item_id::text, v_hour_bucket),
      '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
    );

    BEGIN
      INSERT INTO alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        v_work_item.owner_id, v_work_item.organization_id,
        NEW.work_item_id, 'WORK_ITEM',
        v_severity::alert_severity, v_alert_type, v_portal,
        v_title,
        COALESCE(LEFT(NEW.description, 200), 'Actuación registrada'),
        'PENDING',
        build_dedupe_key(lower(v_alert_type), NEW.work_item_id::text, v_hour_bucket),
        jsonb_build_object(
          'radicado', v_radicado, 'portal', v_portal,
          'despacho', COALESCE(NEW.despacho, v_work_item.authority_name),
          'demandante', v_work_item.demandantes, 'demandado', v_work_item.demandados,
          'tipo_actuacion', NEW.act_type, 'fecha_auto', NEW.act_date,
          'fingerprint', NEW.hash_fingerprint, 'source', NEW.source, 'act_id', NEW.id,
          'description', COALESCE(NEW.description, ''),
          'discovery_type', v_discovery, 'retro_gap_days', v_gap,
          'detected_on', (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date
        )
      ) ON CONFLICT (fingerprint) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[TRIGGER_SAFE] % alert_instance insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
    END;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] % on % failed: % (SQLSTATE: %)', TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE;
    BEGIN
      INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
      VALUES (TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE, NEW.work_item_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;

  RETURN NEW;
END;
$function$;

-- 7) Retroactive feed view (daily report section + UI).
CREATE OR REPLACE VIEW public.retroactive_actuaciones_v AS
SELECT
  a.id,
  a.work_item_id,
  a.organization_id,
  w.radicado,
  w.title AS work_item_title,
  'ACTUACION'::text AS kind,
  a.act_date AS legal_date,
  (a.detected_at AT TIME ZONE 'America/Bogota')::date AS detected_on,
  a.retro_gap_days AS gap_days,
  a.description AS title,
  a.source,
  public.is_term_opening_text(COALESCE(a.description,'') || ' ' || COALESCE(a.act_type,'')) AS opens_term
FROM public.work_item_acts a
JOIN public.work_items w ON w.id = a.work_item_id
WHERE a.is_archived IS NOT TRUE
  AND a.discovery_type = 'ACTUACION_RETROACTIVA'
UNION ALL
SELECT
  p.id,
  p.work_item_id,
  p.organization_id,
  w.radicado,
  w.title,
  'ESTADO'::text,
  COALESCE(p.fecha_fijacion, p.fecha_desfijacion, p.published_at::date),
  (p.detected_at AT TIME ZONE 'America/Bogota')::date,
  p.retro_gap_days,
  p.title,
  p.source,
  public.is_term_opening_text(COALESCE(p.title,'') || ' ' || COALESCE(p.tipo_publicacion,''))
FROM public.work_item_publicaciones p
JOIN public.work_items w ON w.id = p.work_item_id
WHERE p.is_archived IS NOT TRUE
  AND p.discovery_type = 'ACTUACION_RETROACTIVA';

GRANT SELECT ON public.retroactive_actuaciones_v TO authenticated;
GRANT SELECT ON public.retroactive_actuaciones_v TO service_role;

-- 8) Stale monitoring + coverage reconciliation view.
--    Routing matrix: CPACA → SAMAI exclusive; CGP/PENAL_906/LABORAL → CPNU + PP;
--    TUTELA → full union (CPNU + PP + SAMAI).
CREATE OR REPLACE VIEW public.monitoring_coverage_v AS
WITH base AS (
  SELECT
    w.id, w.radicado, w.workflow_type, w.organization_id, w.owner_id,
    w.monitoring_enabled, w.status, w.lifecycle_state,
    CASE w.workflow_type::text
      WHEN 'CPACA' THEN ARRAY['samai']
      WHEN 'TUTELA' THEN ARRAY['cpnu','publicaciones','samai']
      ELSE ARRAY['cpnu','publicaciones']
    END AS expected_providers
  FROM public.work_items w
  WHERE w.status = 'ACTIVE' AND w.lifecycle_state = 'ACTIVE'
),
last_row AS (
  SELECT work_item_id, max(created_at) AS last_ingest FROM (
    SELECT work_item_id, created_at FROM public.work_item_acts WHERE is_archived IS NOT TRUE
    UNION ALL
    SELECT work_item_id, created_at FROM public.work_item_publicaciones WHERE is_archived IS NOT TRUE
  ) u GROUP BY work_item_id
),
last_run AS (
  SELECT work_item_id,
         max(created_at) FILTER (WHERE status IN ('SUCCESS','PARTIAL')) AS last_ok_run,
         max(created_at) AS last_run
  FROM public.external_sync_runs GROUP BY work_item_id
),
enrolled AS (
  SELECT ws.work_item_id, array_agg(DISTINCT lower(pc.key)) AS providers
  FROM public.work_item_sources ws
  JOIN public.provider_instances pi ON pi.id = ws.provider_instance_id
  JOIN public.provider_connectors pc ON pc.id = pi.connector_id
  WHERE ws.status = 'ACTIVE'
  GROUP BY ws.work_item_id
)
SELECT
  b.id AS work_item_id,
  b.radicado,
  b.workflow_type::text AS workflow_type,
  b.organization_id,
  b.owner_id,
  b.monitoring_enabled,
  b.expected_providers,
  COALESCE(e.providers, ARRAY[]::text[]) AS enrolled_providers,
  ARRAY(SELECT unnest(b.expected_providers) EXCEPT SELECT unnest(COALESCE(e.providers, ARRAY[]::text[]))) AS missing_providers,
  lr.last_ingest,
  ru.last_ok_run,
  ru.last_run,
  CASE
    WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D', '', 'g')) < 21 THEN 'SIN_RADICADO_VALIDO'
    WHEN COALESCE(array_length(e.providers, 1), 0) = 0 THEN 'SIN_ENROLAMIENTO'
    WHEN array_length(ARRAY(SELECT unnest(b.expected_providers) EXCEPT SELECT unnest(COALESCE(e.providers, ARRAY[]::text[]))), 1) > 0 THEN 'ENROLAMIENTO_PARCIAL'
    ELSE 'OK'
  END AS coverage_status,
  ((now()::date) - (lr.last_ingest)::date) AS days_since_ingest
FROM base b
LEFT JOIN last_row lr ON lr.work_item_id = b.id
LEFT JOIN last_run ru ON ru.work_item_id = b.id
LEFT JOIN enrolled e ON e.work_item_id = b.id;

GRANT SELECT ON public.monitoring_coverage_v TO authenticated;
GRANT SELECT ON public.monitoring_coverage_v TO service_role;

-- 9) Stale-monitoring detector — raises WARNING alerts, never auto-applies.
CREATE OR REPLACE FUNCTION public.detect_stale_monitoring(p_threshold_days integer DEFAULT 45)
RETURNS TABLE(work_item_id uuid, radicado text, reason text, days_since_ingest integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_day TEXT := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
  v_reason TEXT;
  v_title TEXT;
BEGIN
  FOR r IN
    SELECT * FROM public.monitoring_coverage_v
    WHERE monitoring_enabled
      AND (
        coverage_status IN ('SIN_ENROLAMIENTO', 'ENROLAMIENTO_PARCIAL', 'SIN_RADICADO_VALIDO')
        OR last_ingest IS NULL
        OR last_ingest < now() - make_interval(days => p_threshold_days)
      )
  LOOP
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
END;
$$;

-- 10) Backfill classification for existing rows (does not fire alerts — triggers are BEFORE INSERT only).
UPDATE public.work_item_acts a
SET discovery_type = 'ACTUACION_RETROACTIVA',
    is_retroactive = true,
    retro_gap_days = GREATEST(0, (a.detected_at AT TIME ZONE 'America/Bogota')::date - a.act_date)
WHERE a.is_archived IS NOT TRUE
  AND a.act_date IS NOT NULL
  AND a.detected_at IS NOT NULL
  AND COALESCE(a.discovery_type, '') <> 'HISTORICO_DETECTADO'
  AND (a.detected_at AT TIME ZONE 'America/Bogota')::date - a.act_date > 7
  AND COALESCE(a.source, '') <> 'icarus_import';

UPDATE public.work_item_acts a
SET discovery_type = 'NOVEDAD', is_retroactive = false,
    retro_gap_days = GREATEST(0, (a.detected_at AT TIME ZONE 'America/Bogota')::date - a.act_date)
WHERE a.discovery_type IS NULL AND a.act_date IS NOT NULL AND a.detected_at IS NOT NULL
  AND (a.detected_at AT TIME ZONE 'America/Bogota')::date - a.act_date <= 7;
