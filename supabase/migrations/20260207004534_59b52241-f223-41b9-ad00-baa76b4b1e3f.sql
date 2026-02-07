
-- Phase 1.1: is_notifiable triggers + indexes + backfill
-- Columns already exist, skip ALTER TABLE

-- Step B.1: Trigger function for work_item_acts
CREATE OR REPLACE FUNCTION set_actuacion_notifiable_and_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_severity TEXT;
  v_title TEXT;
BEGIN
  SELECT created_at, radicado, authority_name, owner_id, organization_id
    INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;

  -- Compute notifiability: act_date must be AFTER the day the work item was created
  NEW.is_notifiable := (
    NEW.act_date IS NOT NULL
    AND NEW.act_date > v_work_item.created_at::date
  );

  -- If notifiable, auto-create an alert
  IF NEW.is_notifiable THEN
    v_severity := CASE
      WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%SENTENCIA%' THEN 'CRITICAL'
      WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%FALLO%' THEN 'CRITICAL'
      WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%AUTO INTERLOCUTORIO%' THEN 'WARNING'
      WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%AUDIENCIA%' THEN 'WARNING'
      ELSE 'INFO'
    END;

    v_title := CASE
      WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%SENTENCIA%' THEN '⚖️ Nueva Sentencia'
      WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%FALLO%' THEN '⚖️ Nuevo Fallo'
      WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%AUDIENCIA%' THEN '📅 Audiencia Programada'
      ELSE '📋 Nueva Actuación'
    END;

    INSERT INTO alert_instances (
      entity_type, entity_id, organization_id, owner_id,
      severity, title, message, status, fired_at,
      alert_type, alert_source
    ) VALUES (
      'work_item',
      NEW.work_item_id,
      COALESCE(NEW.organization_id, v_work_item.organization_id),
      v_work_item.owner_id,
      v_severity,
      v_title,
      format('%s — Rad: %s — %s',
        COALESCE(LEFT(NEW.description, 200), ''),
        COALESCE(v_work_item.radicado, ''),
        COALESCE(v_work_item.authority_name, '')
      ),
      'FIRED',
      NOW(),
      'ACTUACION_NUEVA',
      COALESCE(NEW.source, 'unknown')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_actuacion_notifiable ON work_item_acts;

CREATE TRIGGER trg_set_actuacion_notifiable
  BEFORE INSERT ON work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION set_actuacion_notifiable_and_alert();

-- Step B.2: Trigger function for work_item_publicaciones
CREATE OR REPLACE FUNCTION set_publicacion_notifiable_and_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_severity TEXT;
  v_title TEXT;
BEGIN
  SELECT created_at, radicado, authority_name, owner_id, organization_id
    INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;

  NEW.is_notifiable := (
    NEW.fecha_fijacion IS NOT NULL
    AND NEW.fecha_fijacion > v_work_item.created_at::date
  );

  IF NEW.is_notifiable THEN
    v_severity := CASE
      WHEN UPPER(COALESCE(NEW.tipo_publicacion, '')) LIKE '%EDICTO%' THEN 'WARNING'
      ELSE 'INFO'
    END;

    v_title := CASE
      WHEN UPPER(COALESCE(NEW.tipo_publicacion, '')) LIKE '%EDICTO%' THEN '📢 Nuevo Edicto'
      ELSE '📄 Nuevo Estado'
    END;

    INSERT INTO alert_instances (
      entity_type, entity_id, organization_id, owner_id,
      severity, title, message, status, fired_at,
      alert_type, alert_source
    ) VALUES (
      'work_item',
      NEW.work_item_id,
      COALESCE(NEW.organization_id, v_work_item.organization_id),
      v_work_item.owner_id,
      v_severity,
      v_title,
      format('%s — Rad: %s — %s — Fijación: %s',
        COALESCE(NEW.title, NEW.tipo_publicacion, ''),
        COALESCE(v_work_item.radicado, ''),
        COALESCE(v_work_item.authority_name, ''),
        COALESCE(NEW.fecha_fijacion::text, '')
      ),
      'FIRED',
      NOW(),
      'PUBLICACION_NUEVA',
      'publicaciones'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_publicacion_notifiable ON work_item_publicaciones;

CREATE TRIGGER trg_set_publicacion_notifiable
  BEFORE INSERT ON work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION set_publicacion_notifiable_and_alert();

-- Step C: Indexes for notification queries
CREATE INDEX IF NOT EXISTS idx_work_item_acts_notifiable
  ON work_item_acts (organization_id, act_date DESC)
  WHERE is_notifiable = true AND is_archived = false;

CREATE INDEX IF NOT EXISTS idx_work_item_publicaciones_notifiable
  ON work_item_publicaciones (organization_id, fecha_fijacion DESC)
  WHERE is_notifiable = true AND is_archived = false;

CREATE INDEX IF NOT EXISTS idx_alert_instances_unseen
  ON alert_instances (owner_id, fired_at DESC)
  WHERE seen_at IS NULL AND status = 'FIRED';

-- Step D: Backfill existing records (UPDATE, not INSERT — won't fire BEFORE INSERT triggers)
UPDATE work_item_acts a
SET is_notifiable = (
  a.act_date IS NOT NULL
  AND a.act_date > (SELECT w.created_at::date FROM work_items w WHERE w.id = a.work_item_id)
)
WHERE a.is_notifiable = false OR a.is_notifiable IS NULL;

UPDATE work_item_publicaciones p
SET is_notifiable = (
  p.fecha_fijacion IS NOT NULL
  AND p.fecha_fijacion > (SELECT w.created_at::date FROM work_items w WHERE w.id = p.work_item_id)
)
WHERE p.is_notifiable = false OR p.is_notifiable IS NULL;

-- Enable realtime on alert_instances for live bell updates
ALTER PUBLICATION supabase_realtime ADD TABLE alert_instances;
