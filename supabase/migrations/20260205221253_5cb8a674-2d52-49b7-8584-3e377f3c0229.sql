
-- Add new columns to alert_instances for notification system
ALTER TABLE alert_instances
  ADD COLUMN IF NOT EXISTS alert_type TEXT,
  ADD COLUMN IF NOT EXISTS alert_source TEXT,
  ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;

-- Index for unread alert queries
CREATE INDEX IF NOT EXISTS idx_alert_instances_unseen
  ON alert_instances (owner_id, organization_id)
  WHERE status IN ('PENDING', 'SENT', 'FIRED') AND seen_at IS NULL;

-- Index for email digest queries
CREATE INDEX IF NOT EXISTS idx_alert_instances_unemailed
  ON alert_instances (owner_id)
  WHERE status = 'FIRED' AND emailed_at IS NULL;

-- Drop old simple triggers
DROP TRIGGER IF EXISTS trg_set_actuacion_notifiable ON work_item_acts;
DROP FUNCTION IF EXISTS set_actuacion_notifiable();

DROP TRIGGER IF EXISTS trg_set_publicacion_notifiable ON work_item_publicaciones;
DROP FUNCTION IF EXISTS set_publicacion_notifiable();

-- Extended trigger for actuaciones: set is_notifiable + auto-create alert
CREATE OR REPLACE FUNCTION set_actuacion_notifiable_and_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_work_item RECORD;
  v_severity TEXT;
  v_title TEXT;
BEGIN
  -- Fetch work item info
  SELECT created_at, radicado, authority_name, owner_id, organization_id
    INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;

  -- Compute notifiability
  NEW.is_notifiable := (
    NEW.act_date IS NOT NULL
    AND NEW.act_date > v_work_item.created_at::date
  );

  -- If notifiable, create alert_instance
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
        COALESCE(LEFT(NEW.description, 200), 'Actuación registrada'),
        COALESCE(v_work_item.radicado, '—'),
        COALESCE(v_work_item.authority_name, '—')
      ),
      'FIRED',
      NOW(),
      'ACTUACION_NUEVA',
      COALESCE(NEW.source, 'unknown')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_set_actuacion_notifiable_and_alert
  BEFORE INSERT ON work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION set_actuacion_notifiable_and_alert();

-- Extended trigger for publicaciones: set is_notifiable + auto-create alert
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
        COALESCE(NEW.title, NEW.tipo_publicacion, 'Estado publicado'),
        COALESCE(v_work_item.radicado, '—'),
        COALESCE(v_work_item.authority_name, '—'),
        COALESCE(NEW.fecha_fijacion::text, '—')
      ),
      'FIRED',
      NOW(),
      'PUBLICACION_NUEVA',
      'publicaciones'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_set_publicacion_notifiable_and_alert
  BEFORE INSERT ON work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION set_publicacion_notifiable_and_alert();
