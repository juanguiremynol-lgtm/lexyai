CREATE OR REPLACE FUNCTION public.handle_actuacion_notifiability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_work_item RECORD;
  v_severity text;
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
            v_work_item.owner_id, v_work_item.organization_id, NEW.work_item_id, 'WORK_ITEM',
            v_severity, 'ACTUACION_NUEVA',
            LEFT(COALESCE(NEW.description, 'Nueva actuación'), 200),
            LEFT(COALESCE(NEW.description, ''), 500),
            'ACTIVE',
            'act:' || NEW.id::text,
            jsonb_build_object('act_id', NEW.id, 'act_date', NEW.act_date, 'source', NEW.source)
          )
          ON CONFLICT (fingerprint) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[handle_actuacion_notifiability] alert insert failed: %', SQLERRM;
        END;
      END IF;
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
$$;