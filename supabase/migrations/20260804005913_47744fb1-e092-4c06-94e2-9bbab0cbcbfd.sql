ALTER TABLE public.work_item_acts ADD COLUMN IF NOT EXISTS is_future_dated boolean NOT NULL DEFAULT false;
ALTER TABLE public.work_item_publicaciones ADD COLUMN IF NOT EXISTS is_future_dated boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.flag_future_dated_act()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.is_future_dated := NEW.act_date IS NOT NULL
    AND NEW.act_date > (now() AT TIME ZONE 'America/Bogota')::date;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.flag_future_dated_pub()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.is_future_dated := NEW.published_at IS NOT NULL
    AND (NEW.published_at AT TIME ZONE 'America/Bogota')::date > (now() AT TIME ZONE 'America/Bogota')::date;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_flag_future_dated_act ON public.work_item_acts;
CREATE TRIGGER trg_flag_future_dated_act
  BEFORE INSERT OR UPDATE OF act_date ON public.work_item_acts
  FOR EACH ROW EXECUTE FUNCTION public.flag_future_dated_act();

DROP TRIGGER IF EXISTS trg_flag_future_dated_pub ON public.work_item_publicaciones;
CREATE TRIGGER trg_flag_future_dated_pub
  BEFORE INSERT OR UPDATE OF published_at ON public.work_item_publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.flag_future_dated_pub();

UPDATE public.work_item_acts SET is_future_dated = true
 WHERE act_date > (now() AT TIME ZONE 'America/Bogota')::date AND is_future_dated = false;
UPDATE public.work_item_publicaciones SET is_future_dated = true
 WHERE (published_at AT TIME ZONE 'America/Bogota')::date > (now() AT TIME ZONE 'America/Bogota')::date
   AND is_future_dated = false;

CREATE INDEX IF NOT EXISTS idx_work_item_acts_future_dated
  ON public.work_item_acts (work_item_id) WHERE is_future_dated;

CREATE OR REPLACE FUNCTION public.is_procedurally_live_stage(p_stage text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT UPPER(COALESCE(p_stage,'')) IN (
    'AUTO_ADMISORIO','AUTO_ADMISORIO_NOTIFICADO','MANDAMIENTO_DE_PAGO','NOTIFICACION',
    'NOTIFICACION_TRASLADOS','TRASLADO_DEMANDA','TRASLADO_EXCEPCIONES','CONTESTACION',
    'CONTESTACION_PRESENTADA','EXCEPCIONES','SANEAMIENTO','REFORMA_DEMANDA',
    'AUDIENCIA_INICIAL','AUDIENCIA_PRUEBAS','AUDIENCIA','ALEGATOS','ALEGATOS_SENTENCIA',
    'RECURSOS','PRUEBAS','EJECUCION_CUMPLIMIENTO'
  );
$$;

CREATE OR REPLACE FUNCTION public.list_unmonitored_work_items()
RETURNS TABLE(
  work_item_id uuid, radicado text, title text, workflow_type text,
  stage text, lifecycle_state text, organization_id uuid,
  last_act_date date, last_act_description text, last_ingest timestamptz,
  procedurally_live boolean, monitoring_disabled_reason text,
  monitoring_disabled_by text, monitoring_disabled_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.radicado, w.title, w.workflow_type::text,
         COALESCE(w.stage, w.status::text),
         w.lifecycle_state::text, w.organization_id,
         la.act_date, la.description, la.detected_at,
         public.is_procedurally_live_stage(COALESCE(w.stage, w.status::text)),
         w.monitoring_disabled_reason,
         w.monitoring_disabled_by,
         w.monitoring_disabled_at
    FROM public.work_items w
    LEFT JOIN LATERAL (
      SELECT a.act_date, a.description, a.detected_at
        FROM public.work_item_acts a
       WHERE a.work_item_id = w.id
         AND COALESCE(a.is_archived,false) = false
         AND COALESCE(a.is_future_dated,false) = false
       ORDER BY a.act_date DESC NULLS LAST, a.detected_at DESC
       LIMIT 1
    ) la ON true
   WHERE COALESCE(w.monitoring_enabled, true) = false
     AND COALESCE(w.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED')
     AND (public.is_platform_admin() OR w.organization_id = public.get_user_organization_id())
   ORDER BY public.is_procedurally_live_stage(COALESCE(w.stage, w.status::text)) DESC,
            la.act_date DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.list_unmonitored_work_items() TO authenticated;

CREATE OR REPLACE FUNCTION public.detect_monitoring_disabled_live()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_day text := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
  n int := 0;
BEGIN
  FOR r IN
    SELECT w.id, w.radicado, w.owner_id, w.organization_id,
           COALESCE(w.stage, w.status::text) AS stage
      FROM public.work_items w
     WHERE COALESCE(w.monitoring_enabled, true) = false
       AND COALESCE(w.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED')
       AND w.radicado IS NOT NULL
       AND public.is_procedurally_live_stage(COALESCE(w.stage, w.status::text))
  LOOP
    BEGIN
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        r.owner_id, r.organization_id, r.id, 'WORK_ITEM',
        'WARNING', 'MONITOREO_DESACTIVADO', 'SISTEMA',
        'Monitoreo desactivado en un proceso vivo',
        'El proceso ' || COALESCE(r.radicado,'(sin radicado)') || ' está en etapa ' || r.stage ||
        ' con el monitoreo apagado: el silencio no significa ausencia de movimiento. Decida si reactiva el monitoreo.',
        'PENDING',
        public.build_dedupe_key('monitoreo_desactivado', r.id::text, v_day),
        jsonb_build_object('radicado', r.radicado, 'stage', r.stage)
      ) ON CONFLICT (fingerprint) DO NOTHING;
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[detect_monitoring_disabled_live] %', SQLERRM;
    END;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.count_anexos_nuevos(p_since timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT SUM(GREATEST(0, COALESCE((a.raw_data->>'anexos_count')::int, 0)))
       FROM public.work_item_acts a
      WHERE a.detected_at >= p_since
        AND COALESCE(a.is_archived,false) = false), 0)
  + COALESCE(
    (SELECT COUNT(*)
       FROM public.work_item_publicaciones p
      WHERE p.detected_at >= p_since
        AND COALESCE(p.is_archived,false) = false
        AND COALESCE(p.pdf_available,false) = true), 0);
$$;