-- Keep historical discoveries and current changes in separate notification
-- groups. Existing preferences, recipients and the current-state dedupe key
-- remain unchanged; the displayed dates come from the actual publication.
CREATE OR REPLACE FUNCTION public.notify_new_estado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_radicado text; v_recipient uuid; v_existing_id uuid; v_current_count int;
  v_hour_bucket text; v_group text; v_title text; v_body text; v_date text; v_key_prefix text;
BEGIN
  BEGIN
    SELECT radicado INTO v_radicado FROM work_items WHERE id = NEW.work_item_id;
    v_hour_bucket := to_char(now(), 'YYYY-MM-DD:HH24');
    v_group := CASE
      WHEN NEW.raw_data->>'historical_replay' = 'true' OR NEW.discovery_type = 'HISTORICO_DETECTADO' THEN 'historical'
      WHEN NEW.discovery_type = 'ACTUACION_RETROACTIVA' THEN 'retroactive'
      ELSE 'current' END;
    v_date := CASE WHEN NEW.fecha_fijacion IS NOT NULL
      THEN to_char(NEW.fecha_fijacion AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY') ELSE 'fecha no informada' END;

    FOR v_recipient IN SELECT recipient_id FROM get_work_item_recipients(NEW.work_item_id)
    LOOP
      SELECT id, CASE WHEN metadata->>'aggregated_count' ~ '^\d{1,8}$'
                     THEN (metadata->>'aggregated_count')::int ELSE 1 END
      INTO v_existing_id, v_current_count
      FROM notifications
      WHERE work_item_id = NEW.work_item_id AND user_id = v_recipient
        AND type = 'ESTADO_NUEVO' AND created_at > now() - interval '60 minutes'
        AND dismissed_at IS NULL AND COALESCE(metadata->>'discovery_group', 'current') = v_group
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE SKIP LOCKED;

      IF v_existing_id IS NOT NULL THEN
        UPDATE notifications
        SET metadata = metadata || jsonb_build_object('aggregated_count', v_current_count + 1),
            body = CASE v_group
              WHEN 'historical' THEN 'Se incorporaron ' || (v_current_count + 1)::text || ' estados históricos; consulta la fecha de cada uno.'
              WHEN 'retroactive' THEN 'Se detectaron ' || (v_current_count + 1)::text || ' estados anteriores; consulta la fecha de cada uno.'
              ELSE 'Se detectaron ' || (v_current_count + 1)::text || ' nuevos estados en ' || COALESCE(v_radicado, 'proceso') END
        WHERE id = v_existing_id;
      ELSE
        v_title := CASE v_group
          WHEN 'historical' THEN 'Estado histórico incorporado en ' || COALESCE(v_radicado, 'proceso')
          WHEN 'retroactive' THEN 'Estado anterior detectado en ' || COALESCE(v_radicado, 'proceso')
          ELSE 'Nuevo estado en ' || COALESCE(v_radicado, 'proceso') END;
        v_body := CASE WHEN v_group = 'current' THEN COALESCE(LEFT(NEW.title, 200), 'Nuevo estado registrado')
          ELSE COALESCE(LEFT(NEW.title, 150), 'Estado registrado') || '; fijación: ' || v_date || '.' END;
        v_key_prefix := CASE WHEN v_group = 'current' THEN 'estado_new' ELSE 'estado_' || v_group END;
        PERFORM insert_notification(
          'USER', v_recipient, 'WORK_ITEM_ALERTS', 'ESTADO_NUEVO',
          v_title, v_body, 'info',
          jsonb_build_object('radicado', v_radicado, 'fingerprint', NEW.hash_fingerprint,
            'tipo', NEW.tipo_publicacion, 'fecha', NEW.fecha_fijacion,
            'discovery_group', v_group, 'discovery_type', NEW.discovery_type,
            'historical_replay', COALESCE(NEW.raw_data->>'historical_replay' = 'true', false)),
          build_dedupe_key(v_key_prefix, NEW.work_item_id::text, v_hour_bucket),
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
$function$;
