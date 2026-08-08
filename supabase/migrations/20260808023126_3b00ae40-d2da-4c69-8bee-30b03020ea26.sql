-- ═══ A1: neutral naming for the observed condition ═══
ALTER TABLE public.work_items RENAME COLUMN provider_privacy_state TO provider_detail_exposure;
ALTER TABLE public.work_items RENAME COLUMN provider_privacy_reason TO provider_detail_reason;
ALTER TABLE public.work_items RENAME COLUMN provider_privacy_observed_at TO provider_detail_observed_at;
ALTER TABLE public.work_items RENAME COLUMN provider_privacy_desde TO provider_detail_desde;
ALTER TABLE public.work_items RENAME COLUMN provider_privacy_ultima_verificacion TO provider_detail_ultima_verificacion;
ALTER TABLE public.work_items RENAME COLUMN provider_privacy_ttl_days TO provider_detail_ttl_days;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.work_items'::regclass
              AND pg_get_constraintdef(oid) ILIKE '%RESERVADO%'
  LOOP EXECUTE format('ALTER TABLE public.work_items DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;

ALTER TABLE public.work_items ALTER COLUMN provider_detail_exposure DROP DEFAULT;

-- B3: a matter never read is DESCONOCIDO, never "expuesto". A default that is
-- never corrected is functionally the same as inferring exposure from silence.
UPDATE public.work_items
   SET provider_detail_exposure = CASE
         WHEN provider_detail_observed_at IS NULL THEN 'DESCONOCIDO'
         WHEN provider_detail_exposure = 'RESERVADO' THEN 'DETALLE_NO_EXPUESTO'
         ELSE 'DETALLE_EXPUESTO' END;

ALTER TABLE public.work_items ALTER COLUMN provider_detail_exposure SET DEFAULT 'DESCONOCIDO';
ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_detail_exposure_chk
  CHECK (provider_detail_exposure IN ('DESCONOCIDO','DETALLE_EXPUESTO','DETALLE_NO_EXPUESTO'));

-- A4: GCP reduced the revalidation TTL from seven days to one.
ALTER TABLE public.work_items ALTER COLUMN provider_detail_ttl_days SET DEFAULT 1;
UPDATE public.work_items SET provider_detail_ttl_days = 1 WHERE COALESCE(provider_detail_ttl_days,7) <> 1;

COMMENT ON COLUMN public.work_items.provider_detail_exposure IS
  'Observed condition of the public consultation channel: DETALLE_EXPUESTO / DETALLE_NO_EXPUESTO / DESCONOCIDO. Describes the channel, never the legal status of the file.';

-- ═══ historial ═══
ALTER TABLE public.work_item_reserva_historial RENAME TO work_item_detalle_exposicion_historial;
UPDATE public.work_item_detalle_exposicion_historial
   SET evento = CASE evento
     WHEN 'ENTRA_EN_RESERVA' THEN 'DETALLE_DEJA_DE_EXPONERSE'
     WHEN 'SALE_DE_RESERVA'  THEN 'DETALLE_COMIENZA_A_EXPONERSE'
     ELSE evento END;

-- ═══ functions ═══
DROP FUNCTION IF EXISTS public.set_work_item_provider_privacy(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.apply_reserva_estado(uuid, boolean, text, timestamptz, timestamptz, integer, jsonb);
DROP FUNCTION IF EXISTS public.reserva_estado_report();

CREATE OR REPLACE FUNCTION public.apply_detalle_exposicion(
  p_work_item_id uuid,
  p_expuesto boolean,
  p_motivo text DEFAULT NULL,
  p_desde timestamptz DEFAULT NULL,
  p_ultima_verificacion timestamptz DEFAULT NULL,
  p_ttl_days integer DEFAULT NULL,
  p_procedencia jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  w public.work_items%ROWTYPE;
  v_new text;
  v_changed boolean := false;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'work_item_not_found'); END IF;

  -- Only positive evidence of the detail responding may change this. A NULL
  -- reading (failed read) is rejected here, not silently coerced.
  IF p_expuesto IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lectura_no_concluyente', 'state', w.provider_detail_exposure);
  END IF;

  v_new := CASE WHEN p_expuesto THEN 'DETALLE_EXPUESTO' ELSE 'DETALLE_NO_EXPUESTO' END;
  v_changed := COALESCE(w.provider_detail_exposure,'DESCONOCIDO') <> v_new;

  UPDATE public.work_items
     SET provider_detail_exposure = v_new,
         provider_detail_reason = CASE WHEN v_new = 'DETALLE_NO_EXPUESTO'
                                       THEN COALESCE(p_motivo,'DETALLE_NO_EXPUESTO') ELSE NULL END,
         provider_detail_observed_at = now(),
         provider_detail_desde = COALESCE(p_desde, CASE WHEN v_changed THEN now() ELSE w.provider_detail_desde END),
         provider_detail_ultima_verificacion = COALESCE(p_ultima_verificacion, now()),
         provider_detail_ttl_days = COALESCE(p_ttl_days, w.provider_detail_ttl_days, 1),
         updated_at = now()
   WHERE id = p_work_item_id;

  IF v_changed THEN
    INSERT INTO public.work_item_detalle_exposicion_historial
      (work_item_id, organization_id, radicado, evento, motivo, ocurrido_en, procedencia)
    VALUES (p_work_item_id, w.organization_id, w.radicado,
            CASE WHEN v_new = 'DETALLE_EXPUESTO' THEN 'DETALLE_COMIENZA_A_EXPONERSE'
                 ELSE 'DETALLE_DEJA_DE_EXPONERSE' END,
            p_motivo, COALESCE(p_desde, now()), COALESCE(p_procedencia,'{}'::jsonb));
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_new, 'changed', v_changed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.detalle_exposicion_report()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'no_expuestos', COUNT(*) FILTER (WHERE provider_detail_exposure = 'DETALLE_NO_EXPUESTO'),
    'desconocidos', COUNT(*) FILTER (WHERE provider_detail_exposure = 'DESCONOCIDO'),
    'sin_revalidar', COUNT(*) FILTER (
      WHERE provider_detail_exposure = 'DETALLE_NO_EXPUESTO'
        AND (provider_detail_ultima_verificacion IS NULL
             OR provider_detail_ultima_verificacion
                < now() - make_interval(days => COALESCE(provider_detail_ttl_days,1)))),
    'detalle', COALESCE(jsonb_agg(jsonb_build_object(
        'work_item_id', id,
        'radicado', radicado,
        'workflow_type', workflow_type::text,
        'estado', provider_detail_exposure,
        'motivo', provider_detail_reason,
        'desde', provider_detail_desde,
        'ultima_verificacion', provider_detail_ultima_verificacion,
        'ttl_dias', COALESCE(provider_detail_ttl_days,1),
        'vencida', (provider_detail_ultima_verificacion IS NULL
             OR provider_detail_ultima_verificacion
                < now() - make_interval(days => COALESCE(provider_detail_ttl_days,1)))
      ) ORDER BY provider_detail_ultima_verificacion NULLS FIRST)
      FILTER (WHERE provider_detail_exposure = 'DETALLE_NO_EXPUESTO'), '[]'::jsonb)
  )
  FROM public.work_items WHERE deleted_at IS NULL
$function$;

-- A3: no PENAL framing. A CIVIL matter exhibited the same condition.
CREATE OR REPLACE FUNCTION public.work_item_detalle_no_expuesto(p_work_item_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.work_items w
     WHERE w.id = p_work_item_id
       AND w.provider_detail_exposure = 'DETALLE_NO_EXPUESTO'
  )
$function$;

-- Rewrite the two dependants textually so no other logic drifts.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='apply_email_evidence_effects';
  d := replace(d, 'public.work_item_reserva_activa(', 'public.work_item_detalle_no_expuesto(');
  d := replace(d, 'Fuente: correo (proceso con reserva sumarial)',
                  'Fuente: correo (el proveedor no expone el detalle de este proceso)');
  d := replace(d, 'RESERVA_SUMARIAL_ITER43', 'DETALLE_NO_EXPUESTO_ITER45');
  d := replace(d, 'EMAIL_RESERVA_SUMARIAL', 'EMAIL_DETALLE_NO_EXPUESTO');
  EXECUTE d;

  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='classify_work_item_estados_signal';
  d := replace(d,
    'v_reserva := (w.workflow_type::text = ''PENAL_906'' AND COALESCE(w.provider_privacy_state,''PUBLICO'') = ''RESERVADO'');',
    'v_reserva := (COALESCE(w.provider_detail_exposure,''DESCONOCIDO'') = ''DETALLE_NO_EXPUESTO'');');
  d := replace(d, '''COBERTURA_RESERVADA''', '''DETALLE_NO_EXPUESTO''');
  d := replace(d, '''reserva_sumarial'',v_reserva', '''detalle_no_expuesto'',v_reserva');
  EXECUTE d;
END $$;

DROP FUNCTION IF EXISTS public.work_item_reserva_activa(uuid);

-- timeline: describe the observed transition, assert nothing about why.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_viewdef('public.work_item_timeline_v'::regclass, true) INTO d;
  d := replace(d, 'work_item_reserva_historial r', 'work_item_detalle_exposicion_historial r');
  d := replace(d, '''RESERVA''::text AS kind', '''EXPOSICION_DETALLE''::text AS kind');
  d := replace(d, 'WHEN r.evento = ''SALE_DE_RESERVA''::text THEN ''El proceso sale de reserva sumarial y vuelve a ser legible''::text',
                  'WHEN r.evento = ''DETALLE_COMIENZA_A_EXPONERSE''::text THEN ''El proveedor comenzó a exponer el detalle de este proceso''::text');
  d := replace(d, 'ELSE ''El proceso entra en reserva sumarial''::text',
                  'ELSE ''El proveedor dejó de exponer el detalle de este proceso''::text');
  EXECUTE 'CREATE OR REPLACE VIEW public.work_item_timeline_v AS ' || d;
END $$;

-- ═══ B2: upstream endpoint reachability ═══
CREATE TABLE public.upstream_endpoint_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_key text NOT NULL,
  host_key text NOT NULL,
  base_url text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  http_status integer,
  resolves boolean NOT NULL DEFAULT false,
  outcome text NOT NULL,
  latency_ms integer,
  detail text,
  probed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_upstream_endpoint_probes_recent ON public.upstream_endpoint_probes (endpoint_key, probed_at DESC);
GRANT SELECT ON public.upstream_endpoint_probes TO authenticated;
GRANT ALL ON public.upstream_endpoint_probes TO service_role;
ALTER TABLE public.upstream_endpoint_probes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins read endpoint probes" ON public.upstream_endpoint_probes
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- ═══ C1: per-source, per-branch upstream health ═══
CREATE TABLE public.upstream_source_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  branch text NOT NULL,
  status text NOT NULL DEFAULT 'UNKNOWN',
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  consecutive_errors integer NOT NULL DEFAULT 0,
  consecutive_empty_runs integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_error_message text,
  parsed_rows integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, branch)
);
GRANT SELECT ON public.upstream_source_health TO authenticated;
GRANT ALL ON public.upstream_source_health TO service_role;
ALTER TABLE public.upstream_source_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read upstream source health" ON public.upstream_source_health
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_upstream_source_health_updated_at
  BEFORE UPDATE ON public.upstream_source_health
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══ D2: lifecycle divergence register ═══
CREATE TABLE public.upstream_lifecycle_divergences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  radicado text,
  local_lifecycle_state text NOT NULL,
  local_expected_activo boolean NOT NULL,
  upstream_activo boolean,
  resolution text NOT NULL DEFAULT 'PENDING',
  signal_emitted_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lifecycle_divergences_open ON public.upstream_lifecycle_divergences (resolution, detected_at DESC);
GRANT SELECT ON public.upstream_lifecycle_divergences TO authenticated;
GRANT ALL ON public.upstream_lifecycle_divergences TO service_role;
ALTER TABLE public.upstream_lifecycle_divergences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins read lifecycle divergences" ON public.upstream_lifecycle_divergences
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- Upstream `radicados.activo` is written by exactly one thing: POST /lifecycle.
-- ACTIVE → true; DELETED, ARCHIVED, PAUSED, CLOSED → false.
CREATE OR REPLACE FUNCTION public.lifecycle_state_expected_activo(p_state text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT upper(COALESCE(p_state,'ACTIVE')) = 'ACTIVE'
$function$;