
-- ================================================================
-- HARDENING: Make notification side-effects NON-FATAL to ingestion
-- ================================================================
-- If the alert_instances INSERT fails for ANY reason (constraint 
-- violation, missing FK, enum mismatch), the actuación/publicación
-- row still commits. The failure is logged to sync_traces.
-- ================================================================

-- 1) Harden actuaciones notification trigger
CREATE OR REPLACE FUNCTION public.set_actuacion_notifiable_and_alert()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
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

    -- NON-FATAL: alert creation must never block actuación ingestion
    BEGIN
      INSERT INTO alert_instances (
        entity_type, entity_id, organization_id, owner_id,
        severity, title, message, status, fired_at,
        alert_type, alert_source,
        fingerprint
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
        COALESCE(NEW.source, 'unknown'),
        -- Idempotent fingerprint: prevents duplicate alerts on reprocessing
        'act_alert_' || NEW.work_item_id || '_' || NEW.hash_fingerprint
      );
    EXCEPTION WHEN OTHERS THEN
      -- Log failure but DO NOT block the actuación insert
      BEGIN
        INSERT INTO sync_traces (
          work_item_id,
          organization_id,
          step,
          provider,
          success,
          error_code,
          error_message,
          metadata,
          created_at
        ) VALUES (
          NEW.work_item_id,
          COALESCE(NEW.organization_id, v_work_item.organization_id),
          'ALERT_INSERT_FAILED',
          'trigger',
          false,
          'ALERT_TRIGGER_ERROR',
          SQLERRM,
          jsonb_build_object(
            'trigger', 'set_actuacion_notifiable_and_alert',
            'severity', v_severity,
            'sqlstate', SQLSTATE,
            'hash_fingerprint', NEW.hash_fingerprint
          ),
          NOW()
        );
      EXCEPTION WHEN OTHERS THEN
        -- Even trace logging failed; just emit a WARNING
        RAISE WARNING 'Alert trigger failed AND trace logging failed: % (original: %)', SQLERRM, v_severity;
      END;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Harden publicaciones notification trigger  
CREATE OR REPLACE FUNCTION public.set_publicacion_notifiable_and_alert()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
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

    -- NON-FATAL: alert creation must never block publicación ingestion
    BEGIN
      INSERT INTO alert_instances (
        entity_type, entity_id, organization_id, owner_id,
        severity, title, message, status, fired_at,
        alert_type, alert_source,
        fingerprint
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
        'publicaciones',
        -- Idempotent fingerprint: prevents duplicate alerts on reprocessing
        'pub_alert_' || NEW.work_item_id || '_' || NEW.hash_fingerprint
      );
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO sync_traces (
          work_item_id,
          organization_id,
          step,
          provider,
          success,
          error_code,
          error_message,
          metadata,
          created_at
        ) VALUES (
          NEW.work_item_id,
          COALESCE(NEW.organization_id, v_work_item.organization_id),
          'ALERT_INSERT_FAILED',
          'trigger',
          false,
          'ALERT_TRIGGER_ERROR',
          SQLERRM,
          jsonb_build_object(
            'trigger', 'set_publicacion_notifiable_and_alert',
            'severity', v_severity,
            'sqlstate', SQLSTATE,
            'hash_fingerprint', NEW.hash_fingerprint
          ),
          NOW()
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alert trigger failed AND trace logging failed: % (original: %)', SQLERRM, v_severity;
      END;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
