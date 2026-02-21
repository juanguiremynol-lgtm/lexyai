-- ============================================================
-- TRIGGER SAFETY HARDENING — Layers 1 & 5
-- ============================================================

-- LAYER 5A: Create trigger_error_log table for observability
CREATE TABLE IF NOT EXISTS trigger_error_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  error_message TEXT NOT NULL,
  sqlstate TEXT,
  work_item_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trigger_error_log_created ON trigger_error_log (created_at DESC);

ALTER TABLE trigger_error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read trigger errors"
  ON trigger_error_log FOR SELECT
  USING (is_platform_admin());

CREATE POLICY "Service role can insert trigger errors"
  ON trigger_error_log FOR INSERT
  WITH CHECK (true);

-- Auto-cleanup: keep only last 7 days
CREATE OR REPLACE FUNCTION cleanup_trigger_error_log()
RETURNS void AS $$
BEGIN
  DELETE FROM trigger_error_log WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- LAYER 1: Harden all notification/side-effect triggers
-- ============================================================

-- 1. update_actuaciones_count — AFTER INSERT/UPDATE, missing EXCEPTION handler
CREATE OR REPLACE FUNCTION update_actuaciones_count()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    UPDATE work_items
    SET total_actuaciones = (
      SELECT COUNT(*)
      FROM work_item_acts
      WHERE work_item_id = COALESCE(NEW.work_item_id, OLD.work_item_id)
        AND is_archived = false
    )
    WHERE id = COALESCE(NEW.work_item_id, OLD.work_item_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] % on % failed: % (SQLSTATE: %)',
      TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE;
    BEGIN
      INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
      VALUES (TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE, COALESCE(NEW.work_item_id, OLD.work_item_id));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. handle_actuacion_notifiability — upgrade with trigger_error_log writes
CREATE OR REPLACE FUNCTION handle_actuacion_notifiability()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_severity text;
  v_alert_type text;
BEGIN
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
          RAISE WARNING '[TRIGGER_SAFE] % alert_instances insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
          BEGIN
            INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
            VALUES (TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE, NEW.work_item_id);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
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
            RAISE WARNING '[TRIGGER_SAFE] % alert_mod insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
            BEGIN
              INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
              VALUES (TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE, NEW.work_item_id);
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END;
        END IF;
      END IF;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] % on % failed: % (SQLSTATE: %)', TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE;
    BEGIN
      INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
      VALUES (TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE, NEW.work_item_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. notify_new_actuacion — upgrade with trigger_error_log
CREATE OR REPLACE FUNCTION notify_new_actuacion()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_radicado TEXT;
  v_recipient UUID;
  v_hour_bucket TEXT;
BEGIN
  BEGIN
    SELECT owner_id, radicado INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;
    
    IF NOT FOUND THEN RETURN NEW; END IF;
    
    v_recipient := v_work_item.owner_id;
    v_radicado := v_work_item.radicado;
    v_hour_bucket := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD-HH24');

    PERFORM insert_notification(
      'USER', v_recipient, 'WORK_ITEM_ALERTS', 'ACTUACION_NUEVA',
      'Nueva actuación en ' || COALESCE(v_radicado, 'proceso'),
      COALESCE(LEFT(NEW.description, 200), 'Nueva actuación registrada'), 'info',
      jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
        'act_date', NEW.act_date, 'source', NEW.source, 'aggregated_count', 1),
      build_dedupe_key('actuacion_new', NEW.work_item_id::text, v_hour_bucket),
      '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
    );
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. handle_publicacion_notifiability — upgrade with trigger_error_log
CREATE OR REPLACE FUNCTION handle_publicacion_notifiability()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_severity text;
  v_alert_type text;
BEGIN
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
          RAISE WARNING '[TRIGGER_SAFE] % alert insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
          BEGIN
            INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
            VALUES (TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE, NEW.work_item_id);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
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
            RAISE WARNING '[TRIGGER_SAFE] % alert_mod insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
            BEGIN
              INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
              VALUES (TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE, NEW.work_item_id);
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END;
        END IF;
      END IF;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] % on % failed: % (SQLSTATE: %)', TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE;
    BEGIN
      INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
      VALUES (TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE, NEW.work_item_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. notify_new_estado — upgrade with trigger_error_log + fixed column refs
CREATE OR REPLACE FUNCTION notify_new_estado()
RETURNS TRIGGER AS $$
DECLARE
  v_radicado text; v_recipient uuid; v_existing_id uuid; v_current_count int;
  v_hour_bucket text;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. set_archive_audit — already has inner exception, add outer + error log
CREATE OR REPLACE FUNCTION set_archive_audit()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    IF NEW.is_archived = true AND (OLD.is_archived IS DISTINCT FROM true) THEN
      NEW.archived_at = now();
      BEGIN
        NEW.archived_by = auth.uid();
      EXCEPTION WHEN OTHERS THEN
        NEW.archived_by = NULL;
      END;
    END IF;
    IF NEW.is_archived = false AND OLD.is_archived = true THEN
      NEW.archived_at = NULL;
      NEW.archived_by = NULL;
    END IF;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- NOTE: guard_sync_append_only, prevent_delete_*, protect_core_fields_* are
-- intentional guards that SHOULD raise exceptions to block invalid operations.
-- These are NOT wrapped in EXCEPTION handlers because their purpose IS to block.
-- They only fire on DELETE or UPDATE of immutable fields, never on INSERT.