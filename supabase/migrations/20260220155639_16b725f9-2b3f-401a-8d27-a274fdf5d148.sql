
-- ============================================================
-- Phase 3.12: Detection tracking + initial sync guard columns
-- ============================================================

-- 1) work_item_acts: add detection tracking columns
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS detected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS changed_at timestamptz NULL;

-- 2) work_item_publicaciones: add detection tracking columns
ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS detected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS changed_at timestamptz NULL;

-- 3) work_items: add initial sync completion markers
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS acts_initial_sync_completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pubs_initial_sync_completed_at timestamptz NULL;

-- 4) Backfill existing rows: detected_at = created_at
UPDATE work_item_acts SET detected_at = created_at, last_seen_at = created_at WHERE detected_at = now() OR content_hash = '';
UPDATE work_item_publicaciones SET detected_at = created_at, last_seen_at = created_at WHERE detected_at = now() OR content_hash = '';

-- 5) Indexes for "detected today" queries
CREATE INDEX IF NOT EXISTS idx_work_item_acts_detected_at
  ON work_item_acts (organization_id, detected_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_work_item_acts_changed_at
  ON work_item_acts (work_item_id, changed_at DESC)
  WHERE changed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_item_pubs_detected_at
  ON work_item_publicaciones (organization_id, detected_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_work_item_pubs_changed_at
  ON work_item_publicaciones (work_item_id, changed_at DESC)
  WHERE changed_at IS NOT NULL;

-- 6) Add is_notified_email flag to alert_instances for email dispatch idempotency
ALTER TABLE public.alert_instances
  ADD COLUMN IF NOT EXISTS is_notified_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notified_email_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_alert_instances_email_pending
  ON alert_instances (created_at DESC)
  WHERE is_notified_email = false AND status = 'PENDING';

-- 7) Update notifiability triggers to support MODIFIED alerts and initial sync guard

-- Drop old triggers first
DROP TRIGGER IF EXISTS trg_actuacion_notifiable ON work_item_acts;
DROP TRIGGER IF EXISTS trg_publicacion_notifiable ON work_item_publicaciones;
DROP FUNCTION IF EXISTS set_actuacion_notifiable_and_alert() CASCADE;
DROP FUNCTION IF EXISTS set_publicacion_notifiable_and_alert() CASCADE;

-- New: Combined INSERT + UPDATE trigger for actuaciones
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
    -- Initial sync guard: if initial sync not yet completed, suppress notifications
    IF v_work_item.acts_initial_sync_completed_at IS NULL THEN
      NEW.is_notifiable := false;
      RETURN NEW;
    END IF;

    -- Date-based notifiability: act_date must be after tracking start
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
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Only fire on content_hash change (modification detected)
    IF OLD.content_hash IS DISTINCT FROM NEW.content_hash AND NEW.changed_at IS NOT NULL THEN
      -- Same initial sync guard
      IF v_work_item.acts_initial_sync_completed_at IS NULL THEN
        RETURN NEW;
      END IF;

      -- Same date-based notifiability
      IF NEW.act_date IS NOT NULL AND NEW.act_date >= v_work_item.created_at::date THEN
        v_severity := 'INFO';
        v_alert_type := 'ACTUACION_MODIFIED';

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
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_actuacion_notifiable
  BEFORE INSERT OR UPDATE ON work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION handle_actuacion_notifiability();

-- New: Combined INSERT + UPDATE trigger for publicaciones
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
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.content_hash IS DISTINCT FROM NEW.content_hash AND NEW.changed_at IS NOT NULL THEN
      IF v_work_item.pubs_initial_sync_completed_at IS NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.fecha_fijacion IS NOT NULL AND NEW.fecha_fijacion::date >= v_work_item.created_at::date THEN
        v_severity := 'INFO';

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
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_publicacion_notifiable
  BEFORE INSERT OR UPDATE ON work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION handle_publicacion_notifiability();
