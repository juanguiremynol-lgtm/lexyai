-- Fix notify_new_estado: wrong column references
-- NEW.descripcion → NEW.title
-- NEW.tipo → NEW.tipo_publicacion  
-- NEW.fecha_publicacion → NEW.fecha_fijacion
-- Also add EXCEPTION handler to prevent silent insert failures

CREATE OR REPLACE FUNCTION notify_new_estado()
RETURNS TRIGGER AS $$
DECLARE
  v_radicado text; v_recipient uuid; v_existing_id uuid; v_current_count int;
  v_hour_bucket text;
BEGIN
  SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;
  v_hour_bucket := to_char(now(), 'YYYY-MM-DD:HH24');

  FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(NEW.work_item_id)
  LOOP
    SELECT id, COALESCE((metadata->>'aggregated_count')::int, 1)
    INTO v_existing_id, v_current_count
    FROM notifications
    WHERE work_item_id = NEW.work_item_id AND user_id = v_recipient
      AND type = 'ESTADO_NUEVO' AND created_at > now() - interval '60 minutes'
      AND dismissed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_existing_id IS NOT NULL THEN
      UPDATE notifications
      SET metadata = metadata || jsonb_build_object('aggregated_count', v_current_count + 1),
          body = 'Se detectaron ' || (v_current_count + 1)::text || ' nuevos estados en ' || COALESCE(v_radicado, 'proceso')
      WHERE id = v_existing_id;
    ELSE
      PERFORM insert_notification(
        'USER', v_recipient, 'WORK_ITEM_ALERTS', 'ESTADO_NUEVO',
        'Nuevo estado en ' || COALESCE(v_radicado, 'proceso'),
        COALESCE(LEFT(NEW.title, 200), 'Nuevo estado registrado'), 'info',
        jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
          'tipo', NEW.tipo_publicacion, 'fecha', NEW.fecha_fijacion),
        build_dedupe_key('estado_new', NEW.work_item_id::text, v_hour_bucket),
        '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
      );
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_new_estado failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Also add EXCEPTION handler to handle_actuacion_notifiability so it never blocks inserts
CREATE OR REPLACE FUNCTION handle_actuacion_notifiability()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_severity text;
  v_alert_type text;
BEGIN
  SELECT created_at, acts_initial_sync_completed_at, owner_id, organization_id
    INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;

  IF TG_OP = 'INSERT' THEN
    IF v_work_item.acts_initial_sync_completed_at IS NULL THEN
      NEW.is_notifiable := false;
      RETURN NEW;
    END IF;

    NEW.is_notifiable := (
      NEW.act_date IS NOT NULL
      AND NEW.act_date >= v_work_item.created_at::date
    );

    IF NEW.is_notifiable THEN
      v_severity := CASE
        WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%SENTENCIA%' THEN 'CRITICAL'
        WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%AUTO ADMISORIO%' THEN 'WARNING'
        WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%AUDIENCIA%' THEN 'WARNING'
        WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%RECHAZA%' THEN 'CRITICAL'
        WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%INADMITE%' THEN 'WARNING'
        ELSE 'INFO'
      END;

      BEGIN
        INSERT INTO alert_instances (
          owner_id, organization_id, entity_id, entity_type,
          severity, alert_type, title, message, status, fingerprint, payload
        ) VALUES (
          v_work_item.owner_id, v_work_item.organization_id,
          NEW.work_item_id, 'WORK_ITEM',
          v_severity, 'ACTUACION_NEW',
          'Nueva actuación detectada',
          LEFT(NEW.description, 200),
          'PENDING',
          'act_new_' || NEW.id,
          jsonb_build_object(
            'act_id', NEW.id,
            'act_date', NEW.act_date,
            'source', NEW.source,
            'detected_at', NEW.detected_at
          )
        ) ON CONFLICT (fingerprint) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_actuacion_notifiability alert_instances insert failed: %', SQLERRM;
      END;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.content_hash IS DISTINCT FROM NEW.content_hash AND NEW.changed_at IS NOT NULL THEN
      IF v_work_item.acts_initial_sync_completed_at IS NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.act_date IS NOT NULL AND NEW.act_date >= v_work_item.created_at::date THEN
        v_severity := 'INFO';
        v_alert_type := 'ACTUACION_MODIFIED';

        BEGIN
          INSERT INTO alert_instances (
            owner_id, organization_id, entity_id, entity_type,
            severity, alert_type, title, message, status, fingerprint, payload
          ) VALUES (
            v_work_item.owner_id, v_work_item.organization_id,
            NEW.work_item_id, 'WORK_ITEM',
            v_severity, v_alert_type,
            'Actuación modificada',
            'Cambio detectado: ' || LEFT(NEW.description, 150),
            'PENDING',
            'act_mod_' || NEW.id || '_' || extract(epoch from NEW.changed_at)::bigint,
            jsonb_build_object(
              'act_id', NEW.id,
              'act_date', NEW.act_date,
              'old_content_hash', OLD.content_hash,
              'new_content_hash', NEW.content_hash,
              'changed_at', NEW.changed_at
            )
          ) ON CONFLICT (fingerprint) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'handle_actuacion_notifiability alert_mod insert failed: %', SQLERRM;
        END;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_actuacion_notifiability failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Same safety for handle_publicacion_notifiability
CREATE OR REPLACE FUNCTION handle_publicacion_notifiability()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_severity text;
  v_alert_type text;
BEGIN
  SELECT created_at, pubs_initial_sync_completed_at, owner_id, organization_id
    INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;

  IF TG_OP = 'INSERT' THEN
    IF v_work_item.pubs_initial_sync_completed_at IS NULL THEN
      NEW.is_notifiable := false;
      RETURN NEW;
    END IF;

    NEW.is_notifiable := (
      NEW.fecha_fijacion IS NOT NULL
      AND NEW.fecha_fijacion::date >= v_work_item.created_at::date
    );

    IF NEW.is_notifiable THEN
      v_severity := CASE
        WHEN UPPER(COALESCE(NEW.tipo_publicacion, '')) LIKE '%EDICTO%' THEN 'WARNING'
        WHEN UPPER(COALESCE(NEW.title, '')) LIKE '%SENTENCIA%' THEN 'CRITICAL'
        ELSE 'INFO'
      END;

      BEGIN
        INSERT INTO alert_instances (
          owner_id, organization_id, entity_id, entity_type,
          severity, alert_type, title, message, status, fingerprint, payload
        ) VALUES (
          v_work_item.owner_id, v_work_item.organization_id,
          NEW.work_item_id, 'WORK_ITEM',
          v_severity, 'PUBLICACION_NEW',
          'Nuevo estado detectado',
          LEFT(NEW.title, 200),
          'PENDING',
          'pub_new_' || NEW.id,
          jsonb_build_object(
            'pub_id', NEW.id,
            'fecha_fijacion', NEW.fecha_fijacion,
            'source', NEW.source,
            'detected_at', NEW.detected_at
          )
        ) ON CONFLICT (fingerprint) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_publicacion_notifiability alert insert failed: %', SQLERRM;
      END;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.content_hash IS DISTINCT FROM NEW.content_hash AND NEW.changed_at IS NOT NULL THEN
      IF v_work_item.pubs_initial_sync_completed_at IS NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.fecha_fijacion IS NOT NULL AND NEW.fecha_fijacion::date >= v_work_item.created_at::date THEN
        v_severity := 'INFO';

        BEGIN
          INSERT INTO alert_instances (
            owner_id, organization_id, entity_id, entity_type,
            severity, alert_type, title, message, status, fingerprint, payload
          ) VALUES (
            v_work_item.owner_id, v_work_item.organization_id,
            NEW.work_item_id, 'WORK_ITEM',
            v_severity, 'PUBLICACION_MODIFIED',
            'Estado modificado',
            'Cambio detectado: ' || LEFT(NEW.title, 150),
            'PENDING',
            'pub_mod_' || NEW.id || '_' || extract(epoch from NEW.changed_at)::bigint,
            jsonb_build_object(
              'pub_id', NEW.id,
              'fecha_fijacion', NEW.fecha_fijacion,
              'old_content_hash', OLD.content_hash,
              'new_content_hash', NEW.content_hash,
              'changed_at', NEW.changed_at
            )
          ) ON CONFLICT (fingerprint) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'handle_publicacion_notifiability alert_mod insert failed: %', SQLERRM;
        END;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_publicacion_notifiability failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;