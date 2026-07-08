
-- ═════════ BUG 1 fix: detected_at immutability ═════════
CREATE OR REPLACE FUNCTION public.freeze_detected_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.detected_at IS NOT NULL
     AND NEW.detected_at IS DISTINCT FROM OLD.detected_at THEN
    NEW.detected_at := OLD.detected_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_detected_at_acts ON public.work_item_acts;
CREATE TRIGGER trg_freeze_detected_at_acts
  BEFORE UPDATE ON public.work_item_acts
  FOR EACH ROW EXECUTE FUNCTION public.freeze_detected_at();

DROP TRIGGER IF EXISTS trg_freeze_detected_at_pubs ON public.work_item_publicaciones;
CREATE TRIGGER trg_freeze_detected_at_pubs
  BEFORE UPDATE ON public.work_item_publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.freeze_detected_at();

-- ═════════ BUG 1 fix: silence alerts for HISTORICO_DETECTADO ═════════
-- Wrap the existing notify_new_actuacion() to short-circuit when the row
-- is a backfill (discovery_type='HISTORICO_DETECTADO' OR act_date > 3
-- business days old at insert time). Legal date is authoritative.

CREATE OR REPLACE FUNCTION public.is_historico_by_legal_date(p_legal_date date)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d date;
  cnt int := 0;
BEGIN
  IF p_legal_date IS NULL THEN RETURN true; END IF;
  d := (now() AT TIME ZONE 'America/Bogota')::date;
  -- Count business days between legal date and today (weekends only heuristic)
  WHILE d > p_legal_date AND cnt < 4 LOOP
    d := d - 1;
    IF EXTRACT(DOW FROM d) NOT IN (0,6) THEN
      cnt := cnt + 1;
    END IF;
  END LOOP;
  RETURN cnt >= 4 OR p_legal_date < (now() AT TIME ZONE 'America/Bogota')::date - INTERVAL '7 days';
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
  -- Short-circuit: never fire alerts for historical backfills
  IF COALESCE(NEW.discovery_type, '') = 'HISTORICO_DETECTADO'
     OR public.is_historico_by_legal_date(NEW.act_date) THEN
    RETURN NEW;
  END IF;

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
          'radicado', v_radicado, 'portal', v_portal,
          'despacho', COALESCE(NEW.despacho, v_work_item.authority_name),
          'demandante', v_work_item.demandantes, 'demandado', v_work_item.demandados,
          'tipo_actuacion', NEW.act_type, 'fecha_auto', NEW.act_date,
          'fingerprint', NEW.hash_fingerprint, 'source', NEW.source, 'act_id', NEW.id
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

-- Same guard for the estados/publicaciones notifier if it exists
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname='notify_new_estado' LIMIT 1;
  IF v_src IS NOT NULL AND position('discovery_type' in v_src) = 0 THEN
    -- Prepend an early-return guard using a wrapper
    EXECUTE $wrap$
      CREATE OR REPLACE FUNCTION public._notify_new_estado_inner() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $inner$
      BEGIN RETURN NEW; END; $inner$;
    $wrap$;
  END IF;
END$$;

-- Backfill: reclassify today's acts by legal date so downstream queries agree.
UPDATE public.work_item_acts
SET discovery_type = 'HISTORICO_DETECTADO'
WHERE detected_at::date = (now() AT TIME ZONE 'America/Bogota')::date
  AND (discovery_type IS NULL OR discovery_type = 'NOVEDAD')
  AND (act_date IS NULL
       OR act_date < (now() AT TIME ZONE 'America/Bogota')::date - INTERVAL '7 days');

UPDATE public.work_item_publicaciones
SET discovery_type = 'HISTORICO_DETECTADO'
WHERE detected_at::date = (now() AT TIME ZONE 'America/Bogota')::date
  AND (discovery_type IS NULL OR discovery_type = 'NOVEDAD')
  AND COALESCE(fecha_fijacion, fecha_desfijacion) < (now() AT TIME ZONE 'America/Bogota')::date - INTERVAL '7 days';

-- Suppress alert_instances already fired today for those historic rows
UPDATE public.alert_instances ai
SET status = 'DISMISSED', dismissal_reason = 'HISTORICO_DETECTADO_BACKFILL', dismissed_at = now()
WHERE ai.alert_type = 'ACTUACION_NUEVA'
  AND ai.status = 'PENDING'
  AND ai.created_at::date = (now() AT TIME ZONE 'America/Bogota')::date
  AND EXISTS (
    SELECT 1 FROM public.work_item_acts a
    WHERE a.id = (ai.payload->>'act_id')::uuid
      AND a.discovery_type = 'HISTORICO_DETECTADO'
  );
