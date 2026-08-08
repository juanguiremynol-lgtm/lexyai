-- ═══ A. The provider's own name ═══
ALTER TABLE public.work_items DROP CONSTRAINT IF EXISTS work_items_provider_detail_exposure_chk;
ALTER TABLE public.work_items ALTER COLUMN provider_detail_exposure DROP DEFAULT;

UPDATE public.work_items
   SET provider_detail_exposure = 'PROCESO_PRIVADO'
 WHERE provider_detail_exposure = 'DETALLE_NO_EXPUESTO';
UPDATE public.work_items
   SET provider_detail_reason = 'PROCESO_PRIVADO'
 WHERE provider_detail_reason = 'DETALLE_NO_EXPUESTO';

ALTER TABLE public.work_items ALTER COLUMN provider_detail_exposure SET DEFAULT 'DESCONOCIDO';
ALTER TABLE public.work_items ADD CONSTRAINT work_items_provider_detail_exposure_chk
  CHECK (provider_detail_exposure IN ('DESCONOCIDO','DETALLE_EXPUESTO','PROCESO_PRIVADO'));

COMMENT ON COLUMN public.work_items.provider_detail_exposure IS
  'ITER46. The provider names this condition itself ("--- [ PROCESO PRIVADO ] ---" in search, and a 404 "No se puede ver el detalle de un proceso privado" on detail). We adopt the provider term and attribute it to the provider. Per-matter and MUTABLE — never derived from despacho or district.';

UPDATE public.work_item_detalle_exposicion_historial
   SET evento = 'PROCESO_PRIVADO'
 WHERE evento IN ('DETALLE_NO_EXPUESTO','RESERVA_ENTRA');

-- apply_detalle_exposicion → emits the provider term
CREATE OR REPLACE FUNCTION public.apply_detalle_exposicion(
  p_work_item_id uuid,
  p_expuesto boolean,
  p_concluyente boolean DEFAULT true,
  p_motivo text DEFAULT NULL,
  p_desde timestamptz DEFAULT NULL,
  p_ultima_verificacion timestamptz DEFAULT NULL,
  p_ttl_days integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  w public.work_items%ROWTYPE;
  v_new text;
  v_changed boolean;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'work_item_not_found');
  END IF;

  -- A non-conclusive read may never assert a state: a failed read is not an answer.
  IF NOT p_concluyente THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lectura_no_concluyente',
                              'state', w.provider_detail_exposure);
  END IF;

  v_new := CASE WHEN p_expuesto THEN 'DETALLE_EXPUESTO' ELSE 'PROCESO_PRIVADO' END;
  v_changed := COALESCE(w.provider_detail_exposure,'DESCONOCIDO') <> v_new;

  UPDATE public.work_items
     SET provider_detail_exposure = v_new,
         provider_detail_reason = CASE WHEN v_new = 'PROCESO_PRIVADO'
                                       THEN COALESCE(p_motivo,'PROCESO_PRIVADO') ELSE NULL END,
         provider_detail_observed_at = now(),
         provider_detail_desde = CASE
             WHEN v_new = 'DETALLE_EXPUESTO' THEN NULL
             ELSE COALESCE(p_desde, CASE WHEN v_changed THEN now() ELSE w.provider_detail_desde END)
           END,
         provider_detail_ultima_verificacion = COALESCE(p_ultima_verificacion, now()),
         provider_detail_ttl_days = COALESCE(p_ttl_days, w.provider_detail_ttl_days, 1)
   WHERE id = p_work_item_id;

  IF v_changed THEN
    INSERT INTO public.work_item_detalle_exposicion_historial
      (work_item_id, evento, estado_anterior, estado_nuevo, motivo, observado_en)
    VALUES (p_work_item_id,
            CASE WHEN v_new = 'PROCESO_PRIVADO' THEN 'PROCESO_PRIVADO' ELSE 'DETALLE_EXPUESTO' END,
            w.provider_detail_exposure, v_new, p_motivo, now());
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_new, 'changed', v_changed);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.detalle_exposicion_report()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'privados',    COUNT(*) FILTER (WHERE provider_detail_exposure = 'PROCESO_PRIVADO'),
    'expuestos',   COUNT(*) FILTER (WHERE provider_detail_exposure = 'DETALLE_EXPUESTO'),
    'desconocidos',COUNT(*) FILTER (WHERE provider_detail_exposure = 'DESCONOCIDO'),
    'revalidacion_vencida', COUNT(*) FILTER (
      WHERE provider_detail_exposure = 'PROCESO_PRIVADO'
        AND (provider_detail_ultima_verificacion IS NULL
             OR provider_detail_ultima_verificacion
                < now() - make_interval(days => COALESCE(provider_detail_ttl_days,1)))),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
        'work_item_id', id,
        'radicado', radicado,
        'estado', provider_detail_exposure,
        'motivo', provider_detail_reason,
        'desde', provider_detail_desde,
        'ultima_verificacion', provider_detail_ultima_verificacion,
        'ttl_dias', COALESCE(provider_detail_ttl_days,1),
        'vencida', (provider_detail_ultima_verificacion IS NULL
             OR provider_detail_ultima_verificacion
                < now() - make_interval(days => COALESCE(provider_detail_ttl_days,1)))
      ) ORDER BY provider_detail_ultima_verificacion NULLS FIRST)
      FILTER (WHERE provider_detail_exposure = 'PROCESO_PRIVADO'), '[]'::jsonb),
    'computed_at', now()
  ) FROM public.work_items WHERE deleted_at IS NULL;
$fn$;

-- Rewrite dependent function bodies in place (same technique as ITER45).
DO $mig$
DECLARE d text;
BEGIN
  FOR d IN
    SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('classify_work_item_estados_signal','apply_email_evidence_effects')
  LOOP
    IF position('DETALLE_NO_EXPUESTO' in d) > 0 THEN
      EXECUTE replace(d, 'DETALLE_NO_EXPUESTO', 'PROCESO_PRIVADO');
    END IF;
  END LOOP;
END
$mig$;

-- ═══ B. The district is a RATE, not a property ═══
CREATE TABLE IF NOT EXISTS public.despacho_privacy_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'DESPACHO' keys on the first 12 CUI digits; 'DISTRITO' on the first 5.
  scope text NOT NULL CHECK (scope IN ('DESPACHO','DISTRITO')),
  scope_key text NOT NULL,
  scope_label text NOT NULL,
  flagged integer NOT NULL CHECK (flagged >= 0),
  total integer NOT NULL CHECK (total > 0),
  -- Anonymous per-despacho distribution when the measurement resolved despachos
  -- but we cannot attribute each one to a code: [{"flagged":4,"total":6}, ...]
  despacho_distribution jsonb NOT NULL DEFAULT '[]'::jsonb,
  measured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'GCP_MEASUREMENT',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT despacho_privacy_rate_flagged_le_total CHECK (flagged <= total),
  CONSTRAINT despacho_privacy_rate_scope_uq UNIQUE (scope, scope_key)
);

GRANT SELECT ON public.despacho_privacy_rate TO authenticated;
GRANT ALL ON public.despacho_privacy_rate TO service_role;
ALTER TABLE public.despacho_privacy_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "privacy rate readable by authenticated"
  ON public.despacho_privacy_rate FOR SELECT TO authenticated USING (true);
CREATE POLICY "privacy rate managed by service role"
  ON public.despacho_privacy_rate FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_despacho_privacy_rate_updated_at
  BEFORE UPDATE ON public.despacho_privacy_rate
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.despacho_privacy_rate IS
  'ITER46. Observed rate at which the provider marks matters PROCESO_PRIVADO, per despacho or district. INTERPRETATION ONLY — it must never suppress a coverage alarm. Deliberately NOT folded into despacho_coverage, whose `publishes` is boolean and would be false for 53% of Atlántico.';

INSERT INTO public.despacho_privacy_rate (scope, scope_key, scope_label, flagged, total, despacho_distribution, notes)
VALUES
  ('DISTRITO','08001','Barranquilla (Atlántico)',20,43,
   '[{"flagged":4,"total":6},{"flagged":3,"total":6},{"flagged":3,"total":6},{"flagged":1,"total":6},{"flagged":2,"total":6},{"flagged":2,"total":6}]'::jsonb,
   'Enumeración de consecutivos vecinos por GCP (15/36) más la cartera (20/43 ≈ 47%). Los seis despachos medidos son TODOS mixtos: ninguno completamente marcado, ninguno completamente limpio.'),
  ('DISTRITO','05001','Medellín (Antioquia)',0,65,'[]'::jsonb,
   'Cuatro despachos enumerados por GCP más la cartera: ninguna marca observada.'),
  ('DISTRITO','11001','Bogotá D.C.',0,23,'[]'::jsonb,
   'Enumeración de GCP: 0 de 23. Una marca aquí sería genuinamente inusual.')
ON CONFLICT (scope, scope_key) DO UPDATE
  SET flagged = EXCLUDED.flagged, total = EXCLUDED.total,
      despacho_distribution = EXCLUDED.despacho_distribution,
      notes = EXCLUDED.notes, measured_at = now();

-- ═══ D2. Live state wins over any reconstruction ═══
CREATE OR REPLACE FUNCTION public.normalize_source_health_streak(
  p_status text, p_reconstructed_streak integer
) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  -- A source whose LAST run succeeded has a streak of zero, whatever a
  -- backfilled reconstruction claims. NOT_FOUND is a determination and
  -- SUCCESS_EMPTY is a read of zero rows: both are successful runs.
  SELECT CASE
    WHEN upper(COALESCE(p_status,'')) IN ('SUCCESS','SUCCESS_EMPTY','NOT_FOUND','OK') THEN 0
    ELSE GREATEST(COALESCE(p_reconstructed_streak,0), 0)
  END;
$fn$;

UPDATE public.upstream_source_health
   SET consecutive_errors = public.normalize_source_health_streak(status, consecutive_errors)
 WHERE consecutive_errors <> public.normalize_source_health_streak(status, consecutive_errors);

CREATE OR REPLACE FUNCTION public.trg_normalize_source_health_streak()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  NEW.consecutive_errors := public.normalize_source_health_streak(NEW.status, NEW.consecutive_errors);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_upstream_source_health_streak ON public.upstream_source_health;
CREATE TRIGGER trg_upstream_source_health_streak
  BEFORE INSERT OR UPDATE ON public.upstream_source_health
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_source_health_streak();

-- ═══ E3. Lifecycle divergence report ═══
CREATE OR REPLACE FUNCTION public.rpc_lifecycle_divergences()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'sin_resolver', COUNT(*) FILTER (WHERE resolved_at IS NULL),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
      'work_item_id', work_item_id,
      'radicado', radicado,
      'local_lifecycle_state', local_lifecycle_state,
      'esperado_activo', local_expected_activo,
      'upstream_activo', upstream_activo,
      'resolucion', resolution,
      'detectado_en', detected_at,
      'resuelto_en', resolved_at
    ) ORDER BY detected_at DESC) FILTER (WHERE resolved_at IS NULL), '[]'::jsonb),
    'computed_at', now()
  ) FROM public.upstream_lifecycle_divergences;
$fn$;

-- ═══ E4. Which paused matters were paused on absence alone? ═══
CREATE OR REPLACE FUNCTION public.rpc_paused_on_absence_report()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'total_parked', COUNT(*),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
      'work_item_id', w.id,
      'radicado', w.radicado,
      'monitoring_mode', w.monitoring_mode,
      'monitoring_enabled', w.monitoring_enabled,
      'ghost_verification_status', w.ghost_verification_status,
      'ghost_candidate_at', w.ghost_candidate_at,
      -- A park is only well-founded when the provider CONFIRMED not-found.
      'fundado_en_no_encontrado_confirmado', COALESCE(
        (SELECT r.recheck_status = 'NOT_FOUND'
           FROM public.ghost_verification_runs r
          WHERE r.id = w.ghost_verification_run_id), false),
      'debe_restaurarse', NOT COALESCE(
        (SELECT r.recheck_status = 'NOT_FOUND'
           FROM public.ghost_verification_runs r
          WHERE r.id = w.ghost_verification_run_id), false)
    ) ORDER BY w.ghost_candidate_at DESC NULLS LAST), '[]'::jsonb),
    'computed_at', now()
  )
  FROM public.work_items w
  WHERE w.deleted_at IS NULL AND w.monitoring_mode = 'PARKED';
$fn$;