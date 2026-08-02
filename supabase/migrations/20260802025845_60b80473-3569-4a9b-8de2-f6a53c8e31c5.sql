-- ============================================================
-- ITERATION 10 — ALERT DOCTRINE (part 1: typing + source guard)
-- ============================================================

-- 1. Drop the legacy catalog first, then backfill NULL alert_type
ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_alert_type_check;

UPDATE public.alert_instances
   SET alert_type = CASE
     WHEN title ILIKE 'Nuevo Estado%' OR title ILIKE '%estado electr%' THEN 'ESTADO_NUEVO'
     WHEN title ILIKE '%actuaci%' THEN 'ACTUACION_NUEVA'
     ELSE 'SYSTEM_UNTYPED'
   END
 WHERE alert_type IS NULL;

-- 2. Widen catalog, set default, enforce NOT NULL
ALTER TABLE public.alert_instances
  ALTER COLUMN alert_type SET DEFAULT 'SYSTEM_UNTYPED';

ALTER TABLE public.alert_instances
  ALTER COLUMN alert_type SET NOT NULL;

ALTER TABLE public.alert_instances
  ADD CONSTRAINT alert_instances_alert_type_check CHECK (alert_type = ANY (ARRAY[
    -- doctrine (lawyer-actionable)
    'TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO',
    'ACTUACION_RETROACTIVA','ACTUACION_CRITICA',
    'HEARING_TODAY','HEARING_UPCOMING',
    'MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR',
    'SUGERENCIA_PENDIENTE','LEXY_DAILY','INGESTA_MASIVA',
    -- operational / diagnostic (non-legal)
    'BRECHA_COBERTURA_ESTADOS','SYNC_AUTH_FAILURE','SYNC_FAILURE',
    'WATCHDOG_ESCALATION','WATCHDOG_INVARIANT',
    'PROVIDER_SECRET_DECRYPT_FAILED','MISSING_PROVIDER_SECRET',
    'DAILY_WELCOME','PROROGATION_DEADLINE','PETICION_DEADLINE',
    'PETICION_OVERDUE','PETICION_REMINDER',
    'HEARING_CREATED','HEARING_REMINDER','HEARING_SUSPENDED',
    -- legacy (historical rows only; blocked at insert by the doctrine guard)
    'ACTUACION_NUEVA','ACTUACION_MODIFIED','ESTADO_NUEVO','ESTADO_MODIFIED',
    'PUBLICACIONES_NUEVAS','SYSTEM_UNTYPED'
  ]));

-- 3. Adverse / term-opening vocabulary (doctrine §1)
CREATE OR REPLACE FUNCTION public.is_adverse_or_term_opening_text(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    public.unaccent_lower_safe(p_text) ~
      '(inadmite|inadmision|rechaza|rechazo|requiere|requerimiento|decreta|no +repone|decide +apelacion|decide +recurso|remision +al +superior|envio +a +superior|traslado|fija +fecha +audiencia|senala +fecha +audiencia|sentencia|fallo|desistimiento|embargo|secuestro|caducidad|perencion|mandamiento +de +pago|admite +demanda)',
    false
  );
$$;

-- 4. Suppression log
CREATE TABLE IF NOT EXISTS public.alert_suppression_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  organization_id uuid,
  entity_id uuid,
  alert_type text,
  severity text,
  title text,
  reason text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.alert_suppression_log TO authenticated;
GRANT ALL ON public.alert_suppression_log TO service_role;
ALTER TABLE public.alert_suppression_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read their suppression log" ON public.alert_suppression_log;
CREATE POLICY "Owners read their suppression log"
  ON public.alert_suppression_log FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_alert_suppression_log_owner_created
  ON public.alert_suppression_log (owner_id, created_at DESC);

-- 5. DOCTRINE GUARD — single choke point for every alert write
CREATE OR REPLACE FUNCTION public.alert_instances_doctrine_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_text          text;
  v_adverse       boolean;
  v_run_type      text;
  v_discovery     text;
  v_event_date    date;
  v_enrolled_at   date;
  v_recent_count  int;
  v_reason        text;
  v_agg_id        uuid;
  v_agg_items     int;
BEGIN
  NEW.fired_at := COALESCE(NEW.fired_at, now());

  -- (a) severity normalisation
  NEW.severity := UPPER(COALESCE(NEW.severity, 'INFO'));
  IF NEW.severity = 'WARN' THEN NEW.severity := 'WARNING'; END IF;
  IF NEW.severity NOT IN ('INFO','WARNING','CRITICAL') THEN NEW.severity := 'INFO'; END IF;

  -- (b) entity_type normalisation (legacy lowercase writers)
  NEW.entity_type := UPPER(COALESCE(NEW.entity_type, 'WORK_ITEM'));
  IF NEW.entity_type NOT IN ('WORK_ITEM','CLIENT','USER','SYSTEM','HEARING') THEN
    NEW.entity_type := 'WORK_ITEM';
  END IF;

  -- (c) never allow an untyped alert to exist
  IF NEW.alert_type IS NULL OR btrim(NEW.alert_type) = '' THEN
    NEW.alert_type := CASE
      WHEN NEW.title ILIKE 'Nuevo Estado%' OR NEW.title ILIKE '%estado electr%' THEN 'ESTADO_NUEVO'
      WHEN NEW.title ILIKE '%actuaci%' THEN 'ACTUACION_NUEVA'
      ELSE 'SYSTEM_UNTYPED'
    END;
  END IF;

  v_text := COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.message,'') || ' '
            || COALESCE(NEW.payload->>'description','') || ' '
            || COALESCE(NEW.payload->>'tipo_actuacion','');
  v_adverse := public.is_adverse_or_term_opening_text(v_text);

  -- (d) promote genuinely adverse actuaciones, drop the rest of the noise
  IF NEW.alert_type IN ('ACTUACION_NUEVA','ACTUACION_MODIFIED') THEN
    IF v_adverse AND NEW.severity IN ('WARNING','CRITICAL') THEN
      NEW.alert_type := 'ACTUACION_CRITICA';
    ELSE
      v_reason := 'DOCTRINE_NON_ACTIONABLE';
    END IF;
  ELSIF NEW.alert_type IN ('ESTADO_NUEVO','ESTADO_MODIFIED','PUBLICACIONES_NUEVAS','SYSTEM_UNTYPED') THEN
    v_reason := 'DOCTRINE_TIMELINE_ONLY';
  END IF;

  -- (e) suppression at source: bulk / backfill / import runs
  IF v_reason IS NULL THEN
    v_run_type  := UPPER(COALESCE(NEW.payload->>'run_type',''));
    v_discovery := UPPER(COALESCE(NEW.payload->>'discovery_type',''));
    IF v_run_type IN ('BACKFILL','FULL_SWEEP','IMPORT','INITIAL_SYNC','HISTORICO','SWEEP')
       OR v_discovery = 'HISTORICO_DETECTADO' THEN
      v_reason := 'BULK_RUN_' || COALESCE(NULLIF(v_run_type,''), v_discovery);
    END IF;
  END IF;

  -- (f) suppression at source: event predates work-item enrollment
  IF v_reason IS NULL
     AND NEW.entity_type = 'WORK_ITEM'
     AND NEW.alert_type NOT IN ('TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO',
                                'MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR',
                                'SUGERENCIA_PENDIENTE','LEXY_DAILY','INGESTA_MASIVA') THEN
    v_event_date := NULLIF(COALESCE(
      NEW.payload->>'act_date', NEW.payload->>'fecha_fijacion',
      NEW.payload->>'fecha_auto', NEW.payload->>'event_date'), '')::date;
    IF v_event_date IS NOT NULL THEN
      SELECT created_at::date INTO v_enrolled_at FROM public.work_items WHERE id = NEW.entity_id;
      IF v_enrolled_at IS NOT NULL AND v_event_date < v_enrolled_at THEN
        v_reason := 'PRE_ENROLLMENT';
      END IF;
    END IF;
  END IF;

  -- (g) circuit breaker: >20 alerts for one owner within 15 minutes
  IF v_reason IS NULL AND NEW.alert_type <> 'INGESTA_MASIVA' THEN
    SELECT count(*) INTO v_recent_count
      FROM public.alert_instances
     WHERE owner_id = NEW.owner_id
       AND created_at > now() - interval '15 minutes';

    IF v_recent_count >= 20 THEN
      v_reason := 'CIRCUIT_BREAKER';

      SELECT id INTO v_agg_id
        FROM public.alert_instances
       WHERE owner_id = NEW.owner_id
         AND alert_type = 'INGESTA_MASIVA'
         AND status IN ('PENDING','SENT','ACKNOWLEDGED')
         AND created_at > now() - interval '6 hours'
       ORDER BY created_at DESC LIMIT 1;

      IF v_agg_id IS NULL THEN
        INSERT INTO public.alert_instances (
          owner_id, organization_id, entity_id, entity_type, severity,
          alert_type, status, title, message, payload, fingerprint
        ) VALUES (
          NEW.owner_id, NEW.organization_id, NEW.entity_id, 'WORK_ITEM', 'WARNING',
          'INGESTA_MASIVA', 'PENDING',
          '1 novedades ingestadas en 1 expedientes — revisar en la cronología',
          'Se suprimieron alertas individuales por volumen. Consulte la Línea procesal de cada expediente.',
          jsonb_build_object('suppressed_count', 1,
                             'work_item_ids', jsonb_build_array(NEW.entity_id)),
          'ingesta_masiva_' || NEW.owner_id::text || '_'
            || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD-HH24')
        );
      ELSE
        UPDATE public.alert_instances a
           SET payload = jsonb_set(
                 jsonb_set(COALESCE(a.payload,'{}'::jsonb), '{suppressed_count}',
                   to_jsonb(COALESCE((a.payload->>'suppressed_count')::int,0) + 1)),
                 '{work_item_ids}',
                 CASE WHEN COALESCE(a.payload->'work_item_ids','[]'::jsonb)
                             @> to_jsonb(NEW.entity_id)
                      THEN COALESCE(a.payload->'work_item_ids','[]'::jsonb)
                      ELSE COALESCE(a.payload->'work_item_ids','[]'::jsonb)
                             || to_jsonb(NEW.entity_id) END)
         WHERE a.id = v_agg_id
        RETURNING COALESCE((payload->>'suppressed_count')::int,1),
                  jsonb_array_length(COALESCE(payload->'work_item_ids','[]'::jsonb))
          INTO v_recent_count, v_agg_items;

        UPDATE public.alert_instances
           SET title = v_recent_count::text || ' novedades ingestadas en '
                       || GREATEST(v_agg_items,1)::text
                       || ' expedientes — revisar en la cronología'
         WHERE id = v_agg_id;
      END IF;
    END IF;
  END IF;

  -- (h) log + drop
  IF v_reason IS NOT NULL THEN
    INSERT INTO public.alert_suppression_log
      (owner_id, organization_id, entity_id, alert_type, severity, title, reason, payload)
    VALUES (NEW.owner_id, NEW.organization_id, NEW.entity_id, NEW.alert_type,
            NEW.severity, NEW.title, v_reason, NEW.payload);
    RETURN NULL;
  END IF;

  -- (i) stable fingerprint: owner + entity + type + source row + day
  IF NEW.fingerprint IS NULL THEN
    NEW.fingerprint := md5(
      COALESCE(NEW.owner_id::text,'') || '|' || COALESCE(NEW.entity_id::text,'') || '|'
      || NEW.alert_type || '|'
      || COALESCE(NEW.payload->>'act_id', NEW.payload->>'pub_id',
                  NEW.payload->>'deadline_id', NEW.payload->>'hearing_id',
                  NEW.payload->>'fingerprint', NEW.payload->>'source_row_hash',
                  NEW.title, '') || '|'
      || to_char((NEW.fired_at AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD'));
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_alert_instances_doctrine ON public.alert_instances;
-- name sorts before trg_alert_instances_dedupe_guard? ensure ordering explicitly
DROP TRIGGER IF EXISTS trg_alert_instances_00_doctrine ON public.alert_instances;
CREATE TRIGGER trg_alert_instances_00_doctrine
  BEFORE INSERT ON public.alert_instances
  FOR EACH ROW EXECUTE FUNCTION public.alert_instances_doctrine_guard();