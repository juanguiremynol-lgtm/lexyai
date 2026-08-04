-- 1. Standing (state) alert types: fingerprint / dedupe key without a date component
CREATE OR REPLACE FUNCTION public.alert_is_standing(p_alert_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p_alert_type,'') IN (
    'SUGERENCIA_PENDIENTE','MONITOREO_DESACTIVADO',
    'MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR')
$$;

CREATE OR REPLACE FUNCTION public.alert_source_event_key(
  p_entity_id uuid, p_alert_type text, p_title text, p_message text,
  p_payload jsonb, p_fired_at timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p_entity_id::text,'-') || ':'
      || public.alert_family(p_alert_type, p_title) || ':'
      || CASE
           WHEN public.alert_is_standing(p_alert_type) THEN 'STANDING'
           WHEN public.alert_family(p_alert_type, p_title) IN ('ESTADO','ACTUACION')
             THEN md5(lower(left(COALESCE(NULLIF(p_message,''), p_title, ''), 200)))
           ELSE COALESCE(
             p_payload->>'pub_id', p_payload->>'act_id', p_payload->>'source_event_id',
             md5(lower(left(COALESCE(NULLIF(p_message,''), p_title, ''), 200))))
         END
      || CASE WHEN public.alert_is_standing(p_alert_type) THEN ''
              ELSE ':' || to_char((COALESCE(p_fired_at, now()) AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') END
$$;

-- 2. Doctrine guard: standing types get a date-free fingerprint
CREATE OR REPLACE FUNCTION public.alert_standing_fingerprint(
  p_owner_id uuid, p_entity_id uuid, p_alert_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT md5(COALESCE(p_owner_id::text,'') || '|' || COALESCE(p_entity_id::text,'')
             || '|' || COALESCE(p_alert_type,'') || '|STANDING')
$$;

CREATE OR REPLACE FUNCTION public.alert_instances_doctrine_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_text          text;
  v_adverse       boolean;
  v_run_type      text;
  v_discovery     text;
  v_event_date    date;
  v_enrolled_at   date;
  v_recent_count  int;
  v_reason        text;
  v_agg_id        uuid;
  v_agg_items     int;
BEGIN
  NEW.fired_at := COALESCE(NEW.fired_at, now());

  NEW.severity := UPPER(COALESCE(NEW.severity, 'INFO'));
  IF NEW.severity = 'WARN' THEN NEW.severity := 'WARNING'; END IF;
  IF NEW.severity NOT IN ('INFO','WARNING','CRITICAL') THEN NEW.severity := 'INFO'; END IF;

  NEW.entity_type := UPPER(COALESCE(NEW.entity_type, 'WORK_ITEM'));
  IF NEW.entity_type NOT IN ('WORK_ITEM','CLIENT','USER','SYSTEM','HEARING') THEN
    NEW.entity_type := 'WORK_ITEM';
  END IF;

  IF NEW.alert_type IS NULL OR btrim(NEW.alert_type) = '' THEN
    NEW.alert_type := CASE
      WHEN NEW.title ILIKE 'Nuevo Estado%' OR NEW.title ILIKE '%estado electr%' THEN 'ESTADO_NUEVO'
      WHEN NEW.title ILIKE '%actuaci%' THEN 'ACTUACION_NUEVA'
      ELSE 'SYSTEM_UNTYPED'
    END;
  END IF;

  v_text := COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.message,'') || ' '
            || COALESCE(NEW.payload->>'description','') || ' '
            || COALESCE(NEW.payload->>'tipo_actuacion','');
  v_adverse := public.is_adverse_or_term_opening_text(v_text);

  IF NEW.alert_type IN ('ACTUACION_NUEVA','ACTUACION_MODIFIED') THEN
    IF v_adverse AND NEW.severity IN ('WARNING','CRITICAL') THEN
      NEW.alert_type := 'ACTUACION_CRITICA';
    ELSE
      v_reason := 'DOCTRINE_NON_ACTIONABLE';
    END IF;
  ELSIF NEW.alert_type IN ('ESTADO_NUEVO','ESTADO_MODIFIED','PUBLICACIONES_NUEVAS','SYSTEM_UNTYPED') THEN
    v_reason := 'DOCTRINE_TIMELINE_ONLY';
  END IF;

  IF v_reason IS NULL THEN
    v_run_type  := UPPER(COALESCE(NEW.payload->>'run_type',''));
    v_discovery := UPPER(COALESCE(NEW.payload->>'discovery_type',''));
    IF v_run_type IN ('BACKFILL','FULL_SWEEP','IMPORT','INITIAL_SYNC','HISTORICO','SWEEP')
       OR v_discovery = 'HISTORICO_DETECTADO' THEN
      v_reason := 'BULK_RUN_' || COALESCE(NULLIF(v_run_type,''), v_discovery);
    END IF;
  END IF;

  IF v_reason IS NULL
     AND NEW.entity_type = 'WORK_ITEM'
     AND NEW.alert_type NOT IN ('TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO',
                                'MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR',
                                'SUGERENCIA_PENDIENTE','LEXY_DAILY','INGESTA_MASIVA') THEN
    v_event_date := NULLIF(COALESCE(
      NEW.payload->>'act_date', NEW.payload->>'fecha_fijacion',
      NEW.payload->>'fecha_auto', NEW.payload->>'event_date'), '')::date;
    IF v_event_date IS NOT NULL THEN
      SELECT created_at::date INTO v_enrolled_at FROM public.work_items WHERE id = NEW.entity_id;
      IF v_enrolled_at IS NOT NULL AND v_event_date < v_enrolled_at THEN
        v_reason := 'PRE_ENROLLMENT';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NULL
     AND NEW.alert_type <> 'INGESTA_MASIVA'
     AND NOT public.alert_breaker_bypass_enabled() THEN
    SELECT count(*) INTO v_recent_count
      FROM public.alert_instances
     WHERE owner_id = NEW.owner_id
       AND created_at > now() - interval '15 minutes';

    IF v_recent_count >= 20 THEN
      v_reason := 'CIRCUIT_BREAKER';

      SELECT id INTO v_agg_id
        FROM public.alert_instances
       WHERE owner_id = NEW.owner_id
         AND alert_type = 'INGESTA_MASIVA'
         AND status IN ('PENDING','SENT','ACKNOWLEDGED')
         AND created_at > now() - interval '6 hours'
       ORDER BY created_at DESC LIMIT 1;

      IF v_agg_id IS NULL THEN
        INSERT INTO public.alert_instances (
          owner_id, organization_id, entity_id, entity_type, severity,
          alert_type, status, title, message, payload, fingerprint
        ) VALUES (
          NEW.owner_id, NEW.organization_id, NEW.entity_id, 'WORK_ITEM', 'WARNING',
          'INGESTA_MASIVA', 'PENDING',
          '1 novedades ingestadas en 1 expedientes — revisar en la cronología',
          'Se suprimieron alertas individuales por volumen. Consulte la Línea procesal de cada expediente.',
          jsonb_build_object('suppressed_count', 1,
                             'work_item_ids', jsonb_build_array(NEW.entity_id)),
          'ingesta_masiva_' || NEW.owner_id::text || '_'
            || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD-HH24')
        );
      ELSE
        UPDATE public.alert_instances a
           SET payload = jsonb_set(
                 jsonb_set(COALESCE(a.payload,'{}'::jsonb), '{suppressed_count}',
                   to_jsonb(COALESCE((a.payload->>'suppressed_count')::int,0) + 1)),
                 '{work_item_ids}',
                 CASE WHEN COALESCE(a.payload->'work_item_ids','[]'::jsonb)
                             @> to_jsonb(NEW.entity_id)
                      THEN COALESCE(a.payload->'work_item_ids','[]'::jsonb)
                      ELSE COALESCE(a.payload->'work_item_ids','[]'::jsonb)
                             || to_jsonb(NEW.entity_id) END)
         WHERE a.id = v_agg_id
        RETURNING COALESCE((payload->>'suppressed_count')::int,1),
                  jsonb_array_length(COALESCE(payload->'work_item_ids','[]'::jsonb))
          INTO v_recent_count, v_agg_items;

        UPDATE public.alert_instances
           SET title = v_recent_count::text || ' novedades ingestadas en '
                       || GREATEST(v_agg_items,1)::text
                       || ' expedientes — revisar en la cronología'
         WHERE id = v_agg_id;
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.alert_suppression_log
      (owner_id, organization_id, entity_id, alert_type, severity, title, reason, payload)
    VALUES (NEW.owner_id, NEW.organization_id, NEW.entity_id, NEW.alert_type,
            NEW.severity, NEW.title, v_reason, NEW.payload);
    RETURN NULL;
  END IF;

  IF NEW.fingerprint IS NULL THEN
    IF public.alert_is_standing(NEW.alert_type) THEN
      NEW.fingerprint := public.alert_standing_fingerprint(
        NEW.owner_id, NEW.entity_id, NEW.alert_type);
    ELSE
      NEW.fingerprint := md5(
        COALESCE(NEW.owner_id::text,'') || '|' || COALESCE(NEW.entity_id::text,'') || '|'
        || NEW.alert_type || '|'
        || COALESCE(NEW.payload->>'act_id', NEW.payload->>'pub_id',
                    NEW.payload->>'deadline_id', NEW.payload->>'hearing_id',
                    NEW.payload->>'fingerprint', NEW.payload->>'source_row_hash',
                    NEW.title, '') || '|'
        || to_char((NEW.fired_at AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD'));
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

-- 3. Aggregate maintenance: exactly one standing row per work item, count kept fresh
CREATE OR REPLACE FUNCTION public.sync_suggestion_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_updated int := 0; v_inserted int := 0; v_resolved int := 0;
BEGIN
  PERFORM set_config('app.alert_bypass_breaker', 'on', true);

  CREATE TEMP TABLE _sugg_agg ON COMMIT DROP AS
  SELECT w.id AS work_item_id, w.owner_id, w.organization_id, w.radicado,
         COALESCE(st.n,0) + COALESCE(dl.n,0) AS n
    FROM public.work_items w
    LEFT JOIN (SELECT work_item_id, count(*) n
                 FROM public.work_item_stage_suggestions
                WHERE status = 'PENDING' GROUP BY 1) st ON st.work_item_id = w.id
    LEFT JOIN (SELECT work_item_id, count(*) n
                 FROM public.work_item_deadlines
                WHERE status = 'SUGGESTED_BY_EMAIL' GROUP BY 1) dl ON dl.work_item_id = w.id
   WHERE COALESCE(w.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED')
     AND w.owner_id IS NOT NULL
     AND COALESCE(st.n,0) + COALESCE(dl.n,0) > 0;

  -- refresh the count on the standing row
  WITH upd AS (
    UPDATE public.alert_instances a
       SET title = g.n || ' sugerencia(s) pendientes de revisión',
           message = 'Radicado ' || COALESCE(g.radicado,'—') || ' — hay cambios sugeridos sin decidir.',
           payload = COALESCE(a.payload,'{}'::jsonb)
                     || jsonb_build_object('radicado', g.radicado, 'pending_count', g.n),
           severity = 'WARNING'
      FROM _sugg_agg g
     WHERE a.alert_type = 'SUGERENCIA_PENDIENTE'
       AND a.entity_id = g.work_item_id
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
    RETURNING 1)
  SELECT count(*) INTO v_updated FROM upd;

  -- create the standing row where none is open
  WITH ins AS (
    INSERT INTO public.alert_instances (
      owner_id, organization_id, entity_id, entity_type, severity, alert_type,
      status, title, message, payload, alert_source, fingerprint)
    SELECT g.owner_id, g.organization_id, g.work_item_id, 'WORK_ITEM', 'WARNING',
      'SUGERENCIA_PENDIENTE', 'PENDING',
      g.n || ' sugerencia(s) pendientes de revisión',
      'Radicado ' || COALESCE(g.radicado,'—') || ' — hay cambios sugeridos sin decidir.',
      jsonb_build_object('radicado', g.radicado, 'pending_count', g.n),
      'SUGGESTIONS',
      public.alert_standing_fingerprint(g.owner_id, g.work_item_id, 'SUGERENCIA_PENDIENTE')
      FROM _sugg_agg g
     WHERE NOT EXISTS (
       SELECT 1 FROM public.alert_instances a
        WHERE a.alert_type = 'SUGERENCIA_PENDIENTE'
          AND a.entity_id = g.work_item_id
          AND a.status IN ('PENDING','SENT','ACKNOWLEDGED'))
    ON CONFLICT (fingerprint) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_inserted FROM ins;

  -- auto-resolve when the work item has zero pending suggestions
  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type = 'SUGERENCIA_PENDIENTE'
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND NOT EXISTS (SELECT 1 FROM _sugg_agg g WHERE g.work_item_id = a.entity_id)
    RETURNING 1)
  SELECT count(*) INTO v_resolved FROM upd;

  PERFORM set_config('app.alert_bypass_breaker', 'off', true);
  RETURN jsonb_build_object('updated', v_updated, 'inserted', v_inserted, 'resolved', v_resolved);
END
$fn$;

GRANT EXECUTE ON FUNCTION public.sync_suggestion_alerts() TO service_role;

-- 4. regenerate_doctrine_alerts delegates the suggestion block to the aggregator
CREATE OR REPLACE FUNCTION public.regenerate_doctrine_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_terms int := 0; v_hearings int := 0; v_sugg jsonb;
BEGIN
  PERFORM set_config('app.alert_bypass_breaker', 'on', true);

  WITH cand AS (
    SELECT d.id, d.owner_id, d.organization_id, d.work_item_id, d.label, d.deadline_date,
           w.radicado,
           public.business_days_between_sql(
             (now() AT TIME ZONE 'America/Bogota')::date, d.deadline_date) AS bd
      FROM public.work_item_deadlines d
      JOIN public.work_items w ON w.id = d.work_item_id
     WHERE d.status = 'PENDING'
       AND d.deadline_date IS NOT NULL
       AND COALESCE(w.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED')
  ), ins AS (
    INSERT INTO public.alert_instances (
      owner_id, organization_id, entity_id, entity_type, severity, alert_type,
      status, title, message, payload, alert_source)
    SELECT c.owner_id, c.organization_id, c.work_item_id, 'WORK_ITEM',
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date THEN 'CRITICAL'
           WHEN c.bd <= 3 THEN 'CRITICAL' ELSE 'WARNING' END,
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date THEN 'TERMINO_VENCIDO'
           WHEN c.bd <= 3 THEN 'TERMINO_CRITICO' ELSE 'TERMINO_POR_VENCER' END,
      'PENDING',
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date
             THEN 'Término vencido: ' || c.label
           ELSE 'Término por vencer (' || c.bd || ' días hábiles): ' || c.label END,
      'Radicado ' || COALESCE(c.radicado,'—') || ' — vence ' || to_char(c.deadline_date,'DD/MM/YYYY'),
      jsonb_build_object('deadline_id', c.id, 'radicado', c.radicado,
                         'deadline_date', c.deadline_date, 'business_days', c.bd),
      'DEADLINE_ENGINE'
      FROM cand c
     WHERE c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date OR c.bd <= 8
    ON CONFLICT (fingerprint) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_terms FROM ins;

  WITH ins AS (
    INSERT INTO public.alert_instances (
      owner_id, organization_id, entity_id, entity_type, severity, alert_type,
      status, title, message, payload, alert_source)
    SELECT h.owner_id, h.organization_id, COALESCE(h.work_item_id, h.id), 'WORK_ITEM',
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date
                = (now() AT TIME ZONE 'America/Bogota')::date THEN 'CRITICAL' ELSE 'WARNING' END,
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date
                = (now() AT TIME ZONE 'America/Bogota')::date THEN 'HEARING_TODAY' ELSE 'HEARING_UPCOMING' END,
      'PENDING',
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date
                = (now() AT TIME ZONE 'America/Bogota')::date
           THEN 'Audiencia hoy: ' || COALESCE(h.title,'sin título')
           ELSE 'Audiencia próxima: ' || COALESCE(h.title,'sin título') END,
      'Radicado ' || COALESCE(w.radicado,'—') || ' — '
        || to_char(h.scheduled_at AT TIME ZONE 'America/Bogota','DD/MM/YYYY HH24:MI'),
      jsonb_build_object('hearing_id', h.id, 'radicado', w.radicado,
                         'scheduled_at', h.scheduled_at),
      'HEARINGS'
      FROM public.hearings h
      LEFT JOIN public.work_items w ON w.id = h.work_item_id
     WHERE h.deleted_at IS NULL
       AND COALESCE(h.status,'SCHEDULED') NOT IN ('CANCELLED','COMPLETED')
       AND h.scheduled_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota')
       AND h.scheduled_at < date_trunc('day', now() AT TIME ZONE 'America/Bogota') + interval '8 days'
       AND h.owner_id IS NOT NULL
    ON CONFLICT (fingerprint) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_hearings FROM ins;

  v_sugg := public.sync_suggestion_alerts();

  PERFORM set_config('app.alert_bypass_breaker', 'off', true);

  RETURN jsonb_build_object('terminos', v_terms, 'audiencias', v_hearings, 'sugerencias', v_sugg);
END
$fn$;

-- 5. Lifecycle maintenance: suggestion auto-resolve also considers suggested deadlines
CREATE OR REPLACE FUNCTION public.alert_lifecycle_maintenance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_terms int := 0; v_hearings int := 0; v_sugg int := 0;
  v_monit int := 0; v_expired int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type IN ('TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO')
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND a.payload->>'deadline_id' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.work_item_deadlines d
          WHERE d.id = (a.payload->>'deadline_id')::uuid
            AND d.status = 'PENDING')
     RETURNING 1)
  SELECT count(*) INTO v_terms FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type IN ('HEARING_TODAY','HEARING_UPCOMING','HEARING_CREATED','HEARING_REMINDER')
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND a.payload->>'hearing_id' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.hearings h
          WHERE h.id = (a.payload->>'hearing_id')::uuid
            AND h.deleted_at IS NULL
            AND h.scheduled_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota'))
     RETURNING 1)
  SELECT count(*) INTO v_hearings FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type = 'SUGERENCIA_PENDIENTE'
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND NOT EXISTS (
         SELECT 1 FROM public.work_item_stage_suggestions s
          WHERE s.work_item_id = a.entity_id AND s.status = 'PENDING')
       AND NOT EXISTS (
         SELECT 1 FROM public.work_item_deadlines d
          WHERE d.work_item_id = a.entity_id AND d.status = 'SUGGESTED_BY_EMAIL')
     RETURNING 1)
  SELECT count(*) INTO v_sugg FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type IN ('MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR')
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND EXISTS (
         SELECT 1 FROM public.work_item_sources ws
          WHERE ws.work_item_id = a.entity_id
            AND ws.last_synced_at > a.fired_at)
     RETURNING 1)
  SELECT count(*) INTO v_monit FROM upd;

  -- MONITOREO_DESACTIVADO: resolve when monitoring is switched back on
  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type = 'MONITOREO_DESACTIVADO'
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND EXISTS (
         SELECT 1 FROM public.work_items w
          WHERE w.id = a.entity_id AND COALESCE(w.monitoring_enabled, false) IS TRUE)
     RETURNING 1)
  SELECT count(*) + v_monit INTO v_monit FROM upd;

  WITH upd AS (
    UPDATE public.alert_instances
       SET status = 'EXPIRED', dismissed_at = now(), dismissal_reason = 'RETENTION_30D'
     WHERE status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND fired_at < now() - interval '30 days'
     RETURNING 1)
  SELECT count(*) INTO v_expired FROM upd;

  RETURN jsonb_build_object('terminos', v_terms, 'audiencias', v_hearings,
    'sugerencias', v_sugg, 'monitoreo', v_monit, 'expiradas', v_expired);
END
$fn$;

-- 6. Data collapse: keep the newest standing row per work item, dismiss the rest
WITH ranked AS (
  SELECT id, entity_id,
         row_number() OVER (PARTITION BY owner_id, entity_id, alert_type
                            ORDER BY created_at DESC, id) AS rn
    FROM public.alert_instances
   WHERE alert_type IN ('SUGERENCIA_PENDIENTE','MONITOREO_DESACTIVADO',
                        'MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR')
     AND status IN ('PENDING','SENT','ACKNOWLEDGED')
)
UPDATE public.alert_instances a
   SET status = 'DISMISSED', dismissed_at = now(),
       read_at = COALESCE(a.read_at, now()), seen_at = COALESCE(a.seen_at, now()),
       dismissal_reason = 'AGREGADA_ITER13_2'
  FROM ranked r
 WHERE a.id = r.id AND r.rn > 1;

-- re-key the surviving rows to the standing fingerprint / dedupe key
UPDATE public.alert_instances a
   SET fingerprint = public.alert_standing_fingerprint(a.owner_id, a.entity_id, a.alert_type),
       source_event_key = public.alert_source_event_key(
         a.entity_id, a.alert_type, a.title, a.message, a.payload, a.fired_at)
 WHERE a.alert_type IN ('SUGERENCIA_PENDIENTE','MONITOREO_DESACTIVADO',
                        'MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR')
   AND a.status IN ('PENDING','SENT','ACKNOWLEDGED');

SELECT public.sync_suggestion_alerts();

-- 7. Keep the counts fresh more often than the daily doctrine run
SELECT cron.schedule('alert-suggestion-aggregate', '5 */3 * * *',
                     $$SELECT public.sync_suggestion_alerts();$$);