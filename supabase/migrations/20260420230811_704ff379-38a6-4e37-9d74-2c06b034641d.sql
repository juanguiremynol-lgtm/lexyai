CREATE OR REPLACE FUNCTION public.normalize_alert_source(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE UPPER(COALESCE(raw, ''))
    WHEN 'CPNU' THEN 'CPNU'
    WHEN 'SAMAI' THEN 'SAMAI'
    WHEN 'SAMAI_ESTADOS' THEN 'SAMAI_ESTADOS'
    WHEN 'PUBLICACIONES' THEN 'PP'
    WHEN 'PP' THEN 'PP'
    WHEN 'ICARUS_IMPORT' THEN 'ICARUS'
    WHEN 'ICARUS' THEN 'ICARUS'
    WHEN 'MANUAL' THEN 'MANUAL'
    WHEN '' THEN 'UNKNOWN'
    ELSE 'UNKNOWN'
  END;
$$;

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
BEGIN
  BEGIN
    SELECT owner_id, organization_id, radicado, demandantes, demandados, authority_name
      INTO v_work_item
    FROM work_items WHERE id = NEW.work_item_id;

    IF NOT FOUND THEN RETURN NEW; END IF;

    v_recipient := v_work_item.owner_id;
    v_radicado := v_work_item.radicado;
    v_hour_bucket := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD-HH24');
    v_portal := normalize_alert_source(NEW.source);

    PERFORM insert_notification(
      'USER', v_recipient, 'WORK_ITEM_ALERTS', 'ACTUACION_NUEVA',
      'Nueva actuación en ' || COALESCE(v_radicado, 'proceso'),
      COALESCE(LEFT(NEW.description, 200), 'Nueva actuación registrada'), 'info',
      jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
        'act_date', NEW.act_date, 'source', NEW.source, 'aggregated_count', 1),
      build_dedupe_key('actuacion_new', NEW.work_item_id::text, v_hour_bucket),
      '/app/work-items/' || NEW.work_item_id, NEW.work_item_id
    );

    BEGIN
      INSERT INTO alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        v_work_item.owner_id, v_work_item.organization_id,
        NEW.work_item_id, 'WORK_ITEM',
        'INFO', 'ACTUACION_NUEVA', v_portal,
        'Nueva actuación en ' || COALESCE(v_radicado, 'proceso'),
        COALESCE(LEFT(NEW.description, 200), 'Nueva actuación registrada'),
        'PENDING',
        build_dedupe_key('actuacion_new', NEW.work_item_id::text, v_hour_bucket),
        jsonb_build_object(
          'radicado', v_radicado,
          'portal', v_portal,
          'despacho', COALESCE(NEW.despacho, v_work_item.authority_name),
          'demandante', v_work_item.demandantes,
          'demandado', v_work_item.demandados,
          'tipo_actuacion', NEW.act_type,
          'fecha_auto', NEW.act_date,
          'fingerprint', NEW.hash_fingerprint,
          'source', NEW.source,
          'act_id', NEW.id
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

CREATE OR REPLACE FUNCTION public.handle_publicacion_notifiability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_work_item RECORD;
  v_severity text;
  v_portal text;
BEGIN
  BEGIN
    SELECT created_at, pubs_initial_sync_completed_at, owner_id, organization_id,
           radicado, demandantes, demandados, authority_name
      INTO v_work_item
      FROM work_items WHERE id = NEW.work_item_id;

    v_portal := normalize_alert_source(NEW.source);

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
            severity, alert_type, alert_source, title, message, status, fingerprint, payload
          ) VALUES (
            v_work_item.owner_id, v_work_item.organization_id,
            NEW.work_item_id, 'WORK_ITEM',
            v_severity, 'PUBLICACION_NEW', v_portal,
            'Nuevo estado detectado',
            LEFT(NEW.title, 200),
            'PENDING',
            'pub_new_' || NEW.id,
            jsonb_build_object(
              'radicado', v_work_item.radicado,
              'portal', v_portal,
              'despacho', v_work_item.authority_name,
              'demandante', v_work_item.demandantes,
              'demandado', v_work_item.demandados,
              'tipo_actuacion', NEW.tipo_publicacion,
              'fecha_auto', NEW.fecha_fijacion,
              'pub_id', NEW.id,
              'fecha_fijacion', NEW.fecha_fijacion,
              'source', NEW.source,
              'detected_at', NEW.detected_at
            )
          ) ON CONFLICT (fingerprint) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[TRIGGER_SAFE] % alert insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
        END;
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.content_hash IS DISTINCT FROM NEW.content_hash AND NEW.changed_at IS NOT NULL THEN
        IF v_work_item.pubs_initial_sync_completed_at IS NULL THEN
          RETURN NEW;
        END IF;

        IF NEW.fecha_fijacion IS NOT NULL AND NEW.fecha_fijacion::date >= v_work_item.created_at::date THEN
          BEGIN
            INSERT INTO alert_instances (
              owner_id, organization_id, entity_id, entity_type,
              severity, alert_type, alert_source, title, message, status, fingerprint, payload
            ) VALUES (
              v_work_item.owner_id, v_work_item.organization_id,
              NEW.work_item_id, 'WORK_ITEM',
              'INFO', 'PUBLICACION_MODIFIED', v_portal,
              'Estado modificado',
              'Cambio detectado: ' || LEFT(NEW.title, 150),
              'PENDING',
              'pub_mod_' || NEW.id || '_' || extract(epoch from NEW.changed_at)::text,
              jsonb_build_object(
                'radicado', v_work_item.radicado,
                'portal', v_portal,
                'despacho', v_work_item.authority_name,
                'demandante', v_work_item.demandantes,
                'demandado', v_work_item.demandados,
                'tipo_actuacion', NEW.tipo_publicacion,
                'fecha_auto', NEW.fecha_fijacion,
                'pub_id', NEW.id,
                'fecha_fijacion', NEW.fecha_fijacion,
                'source', NEW.source,
                'changed_at', NEW.changed_at
              )
            ) ON CONFLICT (fingerprint) DO NOTHING;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[TRIGGER_SAFE] % alert insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
          END;
        END IF;
      END IF;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] % on % failed: % (SQLSTATE: %)', TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE;
    RETURN NEW;
  END;
END;
$function$;

UPDATE alert_instances ai SET
  alert_source = COALESCE(ai.alert_source, src.portal),
  payload = COALESCE(ai.payload,'{}'::jsonb) || jsonb_build_object(
    'portal', src.portal,
    'despacho', src.authority_name,
    'demandante', src.demandantes,
    'demandado', src.demandados,
    'tipo_actuacion', src.tipo_actuacion,
    'fecha_auto', src.fecha_auto
  )
FROM (
  SELECT
    ai2.id,
    public.normalize_alert_source(COALESCE(wia.source, wip.source)) AS portal,
    COALESCE(wia.despacho, wi.authority_name) AS authority_name,
    wi.demandantes,
    wi.demandados,
    COALESCE(wia.act_type, wip.tipo_publicacion) AS tipo_actuacion,
    COALESCE(wia.act_date::text, wip.fecha_fijacion::text) AS fecha_auto
  FROM alert_instances ai2
  JOIN work_items wi ON wi.id = ai2.entity_id
  LEFT JOIN work_item_acts wia ON wia.id = NULLIF(ai2.payload->>'act_id','')::uuid
  LEFT JOIN work_item_publicaciones wip ON wip.id = NULLIF(ai2.payload->>'pub_id','')::uuid
  WHERE ai2.alert_type IN ('ACTUACION_NUEVA','ACTUACION_MODIFIED','PUBLICACION_NEW','PUBLICACION_MODIFIED','ESTADO_NUEVO')
    AND (ai2.alert_source IS NULL OR ai2.alert_source = '' OR NOT (ai2.payload ? 'despacho'))
) src
WHERE ai.id = src.id;