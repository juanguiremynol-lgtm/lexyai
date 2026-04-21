-- ============================================================================
-- HOTFIX v2: Alert type drift in trigger functions
-- (v1 failed VALIDATE because historical DISMISSED rows still had legacy
-- 'ACTUACION_NEW' / 'PUBLICACION_NUEVA' strings. v2 backfills ALL rows
-- regardless of status, since historicals are inert.)
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- TASK 1a: handle_actuacion_notifiability  (emits ACTUACION_NUEVA)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_actuacion_notifiability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
            v_severity, 'ACTUACION_NUEVA',  -- FIX: was 'ACTUACION_NEW'
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
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- TASK 1b: handle_publicacion_notifiability  (emits ESTADO_NUEVO / ESTADO_MODIFIED)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_publicacion_notifiability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
            v_severity, 'ESTADO_NUEVO', v_portal,  -- FIX: was 'PUBLICACION_NEW'
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
              'INFO', 'ESTADO_MODIFIED', v_portal,  -- FIX: was 'PUBLICACION_MODIFIED'
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
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- TASK 1c: Re-attach triggers (idempotent)
-- ──────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_actuacion_notifiable ON public.work_item_acts;
CREATE TRIGGER trg_actuacion_notifiable
  BEFORE INSERT OR UPDATE ON public.work_item_acts
  FOR EACH ROW EXECUTE FUNCTION public.handle_actuacion_notifiability();

DROP TRIGGER IF EXISTS trg_publicacion_notifiable ON public.work_item_publicaciones;
CREATE TRIGGER trg_publicacion_notifiable
  BEFORE INSERT OR UPDATE ON public.work_item_publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.handle_publicacion_notifiability();

-- ──────────────────────────────────────────────────────────────────────────
-- TASK 2: Backfill ALL legacy alert_type strings (PENDING + historical)
-- Historical rows are inert (DISMISSED/RESOLVED) but must conform to the
-- new CHECK constraint. Renaming them does NOT cause re-dispatch because
-- the dispatcher filters status='PENDING' AND is_notified_email=false.
-- ──────────────────────────────────────────────────────────────────────────
UPDATE public.alert_instances
   SET alert_type = 'ACTUACION_NUEVA'
 WHERE alert_type = 'ACTUACION_NEW';

UPDATE public.alert_instances
   SET alert_type = 'ESTADO_NUEVO'
 WHERE alert_type IN ('PUBLICACION_NEW', 'PUBLICACION_NUEVA');

UPDATE public.alert_instances
   SET alert_type = 'ESTADO_MODIFIED'
 WHERE alert_type = 'PUBLICACION_MODIFIED';

-- ──────────────────────────────────────────────────────────────────────────
-- TASK 3: CHECK constraint enumerating allowed alert_type values
-- Mirrors _shared/alertTypeConstants.ts canonical set + other in-use
-- system alert types. NULL allowed for legacy USER summary alerts.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.alert_instances
  DROP CONSTRAINT IF EXISTS alert_instances_alert_type_check;

ALTER TABLE public.alert_instances
  ADD CONSTRAINT alert_instances_alert_type_check
  CHECK (
    alert_type IS NULL
    OR alert_type IN (
      -- Canonical judicial (must match alertTypeConstants.ts exactly)
      'ACTUACION_NUEVA',
      'ACTUACION_MODIFIED',
      'ESTADO_NUEVO',
      'ESTADO_MODIFIED',
      -- Términos procesales
      'TERMINO_CRITICO',
      'TERMINO_VENCIDO',
      -- Coverage / health
      'BRECHA_COBERTURA_ESTADOS',
      'PUBLICACIONES_NUEVAS',
      -- Sync / provider failures
      'SYNC_AUTH_FAILURE',
      'SYNC_FAILURE',
      'WATCHDOG_ESCALATION',
      'WATCHDOG_INVARIANT',
      'PROVIDER_SECRET_DECRYPT_FAILED',
      'MISSING_PROVIDER_SECRET',
      -- Daily summaries / system
      'LEXY_DAILY',
      'DAILY_WELCOME',
      -- Peticiones / prórrogas
      'PROROGATION_DEADLINE',
      'PETICION_DEADLINE',
      'PETICION_OVERDUE',
      'PETICION_REMINDER'
    )
  );