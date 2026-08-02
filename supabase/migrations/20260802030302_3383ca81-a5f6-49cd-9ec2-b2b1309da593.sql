-- ============================================================
-- ITERATION 10 — REMOVE NOISE EMISSION PATHS AT SOURCE
-- ============================================================

-- (1) work_item_acts: notifiability only, no alert emission
CREATE OR REPLACE FUNCTION public.handle_actuacion_notifiability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_work_item RECORD;
  v_is_annulled boolean;
BEGIN
  BEGIN
    SELECT created_at, acts_initial_sync_completed_at, owner_id, organization_id
      INTO v_work_item
      FROM work_items WHERE id = NEW.work_item_id;

    v_is_annulled := COALESCE((NEW.raw_data->>'is_annulled')::boolean, false)
                     OR UPPER(COALESCE(NEW.raw_data->>'estado', '')) = 'ANULADA';

    IF TG_OP = 'INSERT' THEN
      IF v_work_item.acts_initial_sync_completed_at IS NULL OR v_is_annulled THEN
        NEW.is_notifiable := false;
        RETURN NEW;
      END IF;
      -- ITER10: alert emission removed (doctrine: timeline content, not an alert)
      NEW.is_notifiable := (
        NEW.act_date IS NOT NULL
        AND NEW.act_date >= v_work_item.created_at::date
      );
    ELSIF TG_OP = 'UPDATE' THEN
      IF v_is_annulled THEN
        NEW.is_notifiable := false;
      END IF;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] handle_actuacion_notifiability failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    RETURN NEW;
  END;
END;
$function$;

-- (2) work_item_publicaciones: notifiability only, no alert emission
CREATE OR REPLACE FUNCTION public.handle_publicacion_notifiability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_work_item RECORD;
BEGIN
  BEGIN
    SELECT created_at, pubs_initial_sync_completed_at
      INTO v_work_item
      FROM public.work_items WHERE id = NEW.work_item_id;

    IF TG_OP = 'INSERT' THEN
      IF v_work_item.pubs_initial_sync_completed_at IS NULL THEN
        NEW.is_notifiable := false;
        RETURN NEW;
      END IF;

      IF NEW.fecha_fijacion IS NOT NULL
         AND NEW.fecha_fijacion::date < v_work_item.created_at::date THEN
        NEW.is_notifiable := false;
        RETURN NEW;
      END IF;

      -- ITER10: alert emission removed (doctrine: timeline content, not an alert)
      NEW.is_notifiable := true;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] % on % failed: % (SQLSTATE: %)', TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE;
    RETURN NEW;
  END;
END; $function$;

-- (3) notify_new_actuacion: alert only for retroactive or adverse acts
CREATE OR REPLACE FUNCTION public.notify_new_actuacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_work_item RECORD;
  v_radicado TEXT;
  v_hour_bucket TEXT;
  v_portal TEXT;
  v_discovery TEXT := COALESCE(NEW.discovery_type, 'NOVEDAD');
  v_retro BOOLEAN;
  v_adverse BOOLEAN;
  v_severity TEXT;
  v_alert_type TEXT;
  v_title TEXT;
  v_gap INT := COALESCE(NEW.retro_gap_days, 0);
BEGIN
  IF v_discovery = 'HISTORICO_DETECTADO' THEN
    RETURN NEW;
  END IF;

  v_retro := (v_discovery = 'ACTUACION_RETROACTIVA');

  BEGIN
    SELECT owner_id, organization_id, radicado, demandantes, demandados, authority_name
      INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    v_radicado := v_work_item.radicado;
    v_hour_bucket := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD-HH24');
    v_portal := normalize_alert_source(NEW.source);
    v_adverse := public.is_adverse_or_term_opening_text(
      COALESCE(NEW.description,'') || ' ' || COALESCE(NEW.act_type,''));

    -- Notification centre / timeline keeps every movement
    PERFORM insert_notification(
      'USER', v_work_item.owner_id, 'WORK_ITEM_ALERTS',
      CASE WHEN v_retro THEN 'ACTUACION_RETROACTIVA' ELSE 'ACTUACION_NUEVA' END,
      CASE WHEN v_retro
        THEN 'Actuación con fecha retroactiva (' || v_gap || ' días) en ' || COALESCE(v_radicado, 'proceso')
        ELSE 'Nueva actuación en ' || COALESCE(v_radicado, 'proceso') END,
      COALESCE(LEFT(NEW.description, 200), 'Actuación registrada'),
      CASE WHEN v_retro AND v_adverse THEN 'error' WHEN v_retro THEN 'warning' ELSE 'info' END,
      jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
        'act_date', NEW.act_date, 'source', NEW.source, 'aggregated_count', 1,
        'discovery_type', v_discovery, 'retro_gap_days', v_gap),
      build_dedupe_key(
        CASE WHEN v_retro THEN 'actuacion_retroactiva' ELSE 'actuacion_nueva' END,
        NEW.work_item_id::text, v_hour_bucket),
      '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
    );

    -- ITER10 doctrine: an alert only when the lawyer must decide
    IF v_retro THEN
      v_alert_type := 'ACTUACION_RETROACTIVA';
      v_severity   := CASE WHEN v_adverse THEN 'CRITICAL' ELSE 'WARNING' END;
      v_title      := 'Actuación con fecha retroactiva (' || v_gap || ' días) en ' || COALESCE(v_radicado, 'proceso');
    ELSIF v_adverse THEN
      v_alert_type := 'ACTUACION_CRITICA';
      v_severity   := 'CRITICAL';
      v_title      := COALESCE(LEFT(NEW.description, 120), 'Actuación relevante')
                      || ' — ' || COALESCE(v_radicado, 'proceso');
    ELSE
      RETURN NEW; -- routine movement: timeline only
    END IF;

    BEGIN
      INSERT INTO alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        v_work_item.owner_id, v_work_item.organization_id,
        NEW.work_item_id, 'WORK_ITEM',
        v_severity, v_alert_type, v_portal,
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
  END;

  RETURN NEW;
END;
$function$;

-- (4) legacy, unattached emitter: neutralised
CREATE OR REPLACE FUNCTION public.set_actuacion_notifiable_and_alert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_created_at timestamptz;
BEGIN
  SELECT created_at INTO v_created_at FROM work_items WHERE id = NEW.work_item_id;
  -- ITER10: alert emission removed; notifiability flag only
  NEW.is_notifiable := (NEW.act_date IS NOT NULL AND NEW.act_date > v_created_at::date);
  RETURN NEW;
END;
$function$;