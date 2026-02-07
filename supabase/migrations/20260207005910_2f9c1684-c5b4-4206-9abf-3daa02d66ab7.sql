-- FIX: Triggers use status='FIRED' but check constraint only allows PENDING/SENT/ACKNOWLEDGED/RESOLVED/CANCELLED/DISMISSED
-- Solution: Update both trigger functions to use 'PENDING' instead of 'FIRED'

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

  NEW.is_notifiable := (
    NEW.act_date IS NOT NULL
    AND NEW.act_date > v_work_item.created_at::date
  );

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
      'PENDING',
      NOW(),
      'ACTUACION_NUEVA',
      COALESCE(NEW.source, 'unknown')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
      'PENDING',
      NOW(),
      'PUBLICACION_NUEVA',
      'publicaciones'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;