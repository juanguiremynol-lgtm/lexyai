-- ============================================================
-- ITER43 (1) — upstream enrolment capability register
-- Mirrors two upstream files, audited 2026-08-07:
--   andromeda-read-api/index.js:565  LIFECYCLE_WORKFLOWS
--   andromeda-sync-job/main.py:66    detectar_termino() workflow filter
-- ============================================================
CREATE TABLE IF NOT EXISTS public.upstream_workflow_capability (
  workflow_type text PRIMARY KEY,
  lifecycle_enrollable boolean NOT NULL DEFAULT false,
  term_detection boolean NOT NULL DEFAULT false,
  upstream_ref text,
  note text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.upstream_workflow_capability TO authenticated;
GRANT ALL ON public.upstream_workflow_capability TO service_role;

ALTER TABLE public.upstream_workflow_capability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read upstream capability" ON public.upstream_workflow_capability;
CREATE POLICY "Authenticated read upstream capability"
  ON public.upstream_workflow_capability FOR SELECT TO authenticated USING (true);

INSERT INTO public.upstream_workflow_capability
  (workflow_type, lifecycle_enrollable, term_detection, upstream_ref, note)
VALUES
  ('CGP',            true,  true,  'andromeda-read-api/index.js:565', 'Enrolable y con detección de términos aguas arriba.'),
  ('CPACA',          true,  true,  'andromeda-read-api/index.js:565', 'Enrolable y con detección de términos aguas arriba.'),
  ('LABORAL',        true,  false, 'andromeda-read-api/index.js:565', 'Enrolable; sin detectar_termino() aguas arriba.'),
  ('PENAL_906',      true,  false, 'andromeda-read-api/index.js:565', 'Enrolable; sin detectar_termino() aguas arriba.'),
  ('TUTELA',         true,  false, 'andromeda-read-api/index.js:565', 'Enrolable; sin detectar_termino() aguas arriba.'),
  ('EJECUTIVO',      false, false, 'andromeda-read-api/index.js:565', 'POST /lifecycle responde 400: el proveedor no acepta esta área todavía.'),
  ('PETICION',       false, false, 'andromeda-read-api/index.js:565', 'Área local, sin enrolamiento en el proveedor.'),
  ('GOV_PROCEDURE',  false, false, 'andromeda-read-api/index.js:565', 'Área local, sin enrolamiento en el proveedor.'),
  ('INDETERMINADO',  false, false, 'andromeda-read-api/index.js:565', 'Área local, sin enrolamiento en el proveedor.')
ON CONFLICT (workflow_type) DO UPDATE
  SET lifecycle_enrollable = EXCLUDED.lifecycle_enrollable,
      term_detection = EXCLUDED.term_detection,
      upstream_ref = EXCLUDED.upstream_ref,
      note = EXCLUDED.note,
      updated_at = now();

CREATE TRIGGER trg_upstream_workflow_capability_updated_at
  BEFORE UPDATE ON public.upstream_workflow_capability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.workflow_is_upstream_enrollable(_workflow_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT c.lifecycle_enrollable
       FROM public.upstream_workflow_capability c
      WHERE c.workflow_type = upper(COALESCE(_workflow_type,''))),
    false)
$$;

-- ============================================================
-- ITER43 (2) — the accept path must prove enrolment before committing
-- ============================================================
DROP FUNCTION IF EXISTS public.accept_workflow_suggestion(uuid);

CREATE OR REPLACE FUNCTION public.accept_workflow_suggestion(
  _suggestion_id uuid,
  _upstream_enrolled boolean DEFAULT false,
  _upstream_evidence jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.work_item_workflow_suggestions%ROWTYPE;
  allowed boolean;
BEGIN
  SELECT * INTO s FROM public.work_item_workflow_suggestions WHERE id = _suggestion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sugerencia no encontrada'; END IF;

  SELECT (wi.owner_id = auth.uid() OR public.is_business_org_admin(wi.organization_id))
    INTO allowed FROM public.work_items wi WHERE wi.id = s.work_item_id;
  IF NOT COALESCE(allowed, false) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF s.status <> 'PENDING' THEN RAISE EXCEPTION 'La sugerencia ya fue resuelta'; END IF;

  -- GUARD ITER43: an área the provider rejects would silently unsubscribe the
  -- matter from monitoring. Refuse before anything is written.
  IF NOT public.workflow_is_upstream_enrollable(s.suggested_workflow_type) THEN
    RAISE EXCEPTION 'Pendiente de habilitación en el proveedor — al aplicar, el expediente dejaría de monitorearse (%).',
      s.suggested_workflow_type;
  END IF;

  IF NOT COALESCE(_upstream_enrolled, false) THEN
    RAISE EXCEPTION 'No se pudo confirmar el re-enrolamiento en el proveedor: el cambio de área no se aplicó.';
  END IF;

  UPDATE public.work_items
     SET workflow_type = s.suggested_workflow_type::workflow_type,
         workflow_type_source = 'MANUAL',
         updated_at = now()
   WHERE id = s.work_item_id;

  UPDATE public.work_item_workflow_suggestions
     SET status = 'ACCEPTED', resolved_by = auth.uid(), resolved_at = now(),
         procedencia = COALESCE(procedencia,'{}'::jsonb)
                       || jsonb_build_object('upstream_enrolment', COALESCE(_upstream_evidence,'{}'::jsonb))
   WHERE id = _suggestion_id;

  UPDATE public.work_item_workflow_suggestions
     SET status = 'SUPERSEDED', resolved_at = now()
   WHERE work_item_id = s.work_item_id AND status = 'PENDING' AND id <> _suggestion_id;

  INSERT INTO public.work_item_clase_proceso_audit (
    work_item_id, organization_id, previous_workflow_type, new_workflow_type,
    new_clase, change_source, procedencia)
  VALUES (s.work_item_id, s.organization_id, s.current_workflow_type,
          s.suggested_workflow_type, s.clase_proceso, 'SUGGESTION_ACCEPTED',
          COALESCE(s.procedencia,'{}'::jsonb)
            || jsonb_build_object('upstream_enrolment', COALESCE(_upstream_evidence,'{}'::jsonb)));

  RETURN jsonb_build_object('ok', true, 'work_item_id', s.work_item_id,
                            'workflow_type', s.suggested_workflow_type);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_workflow_suggestion(uuid, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_workflow_suggestion(uuid, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workflow_suggestion(uuid, boolean, jsonb) TO service_role;

-- ============================================================
-- ITER43 (3) — PENAL_906 reserva sumarial as a first-class state
-- ============================================================
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS provider_privacy_state text NOT NULL DEFAULT 'PUBLICO',
  ADD COLUMN IF NOT EXISTS provider_privacy_reason text,
  ADD COLUMN IF NOT EXISTS provider_privacy_observed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_provider_privacy_state_chk') THEN
    ALTER TABLE public.work_items
      ADD CONSTRAINT work_items_provider_privacy_state_chk
      CHECK (provider_privacy_state IN ('PUBLICO','RESERVADO'));
  END IF;
END $$;

COMMENT ON COLUMN public.work_items.provider_privacy_state IS
  'ITER43 — RESERVADO cuando el proveedor reporta esPrivado/PROCESO_PRIVADO (reserva sumarial, típico de Ley 906). No es una falla del proveedor.';

CREATE OR REPLACE FUNCTION public.work_item_reserva_activa(p_work_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_items w
     WHERE w.id = p_work_item_id
       AND w.workflow_type::text = 'PENAL_906'
       AND w.provider_privacy_state = 'RESERVADO'
  )
$$;

-- Provider observation writer, with automatic reversal the moment the
-- provider starts publishing again (same mechanics as coverage-gap recovery).
CREATE OR REPLACE FUNCTION public.set_work_item_provider_privacy(
  p_work_item_id uuid,
  p_privado boolean,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.work_items%ROWTYPE;
  v_new text;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'work_item_not_found'); END IF;

  v_new := CASE WHEN COALESCE(p_privado,false) THEN 'RESERVADO' ELSE 'PUBLICO' END;

  IF COALESCE(w.provider_privacy_state,'PUBLICO') = v_new THEN
    UPDATE public.work_items
       SET provider_privacy_observed_at = now(),
           provider_privacy_reason = COALESCE(p_motivo, provider_privacy_reason)
     WHERE id = p_work_item_id;
    RETURN jsonb_build_object('ok', true, 'state', v_new, 'changed', false);
  END IF;

  UPDATE public.work_items
     SET provider_privacy_state = v_new,
         provider_privacy_reason = CASE WHEN v_new = 'RESERVADO' THEN COALESCE(p_motivo,'PROCESO_PRIVADO') ELSE NULL END,
         provider_privacy_observed_at = now(),
         updated_at = now()
   WHERE id = p_work_item_id;

  RETURN jsonb_build_object('ok', true, 'state', v_new, 'changed', true,
                            'previous', COALESCE(w.provider_privacy_state,'PUBLICO'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_work_item_provider_privacy(uuid, boolean, text) TO service_role;

-- Reserva outranks every other coverage class: silence is lawful, never alerted.
CREATE OR REPLACE FUNCTION public.classify_work_item_estados_signal(p_work_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  w public.work_items%ROWTYPE;
  v_estados_provider text;
  v_acts int := 0; v_pubs int := 0; v_fij int := 0;
  v_unmatched jsonb := '[]'::jsonb; v_out_window jsonb := '[]'::jsonb;
  v_sin_doc jsonb := '[]'::jsonb; v_remitido jsonb := '[]'::jsonb;
  v_recent int := 0; v_alertable int := 0; v_last_fij date; v_latest_fij date; v_class text;
  v_declared boolean := false; v_hist_sweep_at date;
  v_daily_horizon date := CURRENT_DATE - 120; v_alertable_this boolean;
  v_remision_date date; v_remision_desc text; r record;
  v_reserva boolean := false;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_reserva := (w.workflow_type::text = 'PENAL_906' AND COALESCE(w.provider_privacy_state,'PUBLICO') = 'RESERVADO');
  v_estados_provider := public.estados_provider_for_workflow(w.workflow_type::text);
  SELECT count(*) INTO v_acts FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE;
  SELECT count(*) INTO v_pubs FROM public.work_item_publicaciones p WHERE p.work_item_id=p_work_item_id AND p.is_archived IS NOT TRUE AND public.pub_matches_provider(p.source,v_estados_provider);
  SELECT max(COALESCE(a.act_date,a.event_date)) INTO v_latest_fij FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE AND public.act_is_fijacion_estado(a.description,a.act_type);
  SELECT EXISTS (SELECT 1 FROM public.despacho_coverage c WHERE c.publishes=false AND c.provider_key=COALESCE(v_estados_provider,'') AND left(regexp_replace(COALESCE(w.radicado,''),'\D','','g'),length(c.radicado_prefix))=c.radicado_prefix) INTO v_declared;
  SELECT max(COALESCE(r2.finished_at,r2.started_at))::date INTO v_hist_sweep_at FROM public.external_sync_runs r2 WHERE r2.work_item_id=p_work_item_id AND upper(COALESCE(r2.run_mode,'')) IN ('HISTORICO','HISTORIC','BACKFILL','FULL');
  SELECT COALESCE(a.act_date,a.event_date),left(COALESCE(a.description,''),200) INTO v_remision_date,v_remision_desc FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE AND public.act_is_remision_expediente(a.description,a.act_type) AND COALESCE(a.act_date,a.event_date) IS NOT NULL ORDER BY COALESCE(a.act_date,a.event_date) DESC LIMIT 1;
  FOR r IN SELECT a.id,COALESCE(a.act_date,a.event_date) AS d,a.description FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE AND public.act_is_fijacion_estado(a.description,a.act_type) LOOP
    v_fij:=v_fij+1;
    IF r.d IS NOT NULL AND (v_last_fij IS NULL OR r.d>v_last_fij) THEN v_last_fij:=r.d; END IF;
    IF EXISTS (SELECT 1 FROM public.work_item_publicaciones p WHERE p.work_item_id=p_work_item_id AND p.is_archived IS NOT TRUE AND public.pub_matches_provider(p.source,v_estados_provider) AND r.d IS NOT NULL AND COALESCE(p.fecha_fijacion::date,p.published_at::date,p.fecha_desfijacion::date) BETWEEN public.sub_business_days_sql(r.d,2) AND public.add_business_days_sql(r.d,2)) THEN CONTINUE; END IF;
    IF r.d IS NOT NULL AND EXISTS (SELECT 1 FROM public.estado_sin_documento e WHERE (e.work_item_id=p_work_item_id OR regexp_replace(COALESCE(e.radicado,''),'\D','','g')=regexp_replace(COALESCE(w.radicado,''),'\D','','g')) AND e.provider_key=COALESCE(v_estados_provider,'publicaciones') AND e.fecha_fijacion BETWEEN public.sub_business_days_sql(r.d,2) AND public.add_business_days_sql(r.d,2)) THEN v_sin_doc:=v_sin_doc||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160)); CONTINUE; END IF;
    IF r.d IS NOT NULL AND v_remision_date IS NOT NULL AND r.d BETWEEN (v_remision_date-15) AND v_remision_date THEN v_remitido:=v_remitido||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160),'remision_date',v_remision_date); CONTINUE; END IF;
    IF r.d IS NOT NULL AND NOT public.despacho_window_covers(w.radicado,COALESCE(v_estados_provider,'publicaciones'),r.d) THEN v_out_window:=v_out_window||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160)); CONTINUE; END IF;
    v_alertable_this:=r.d IS NOT NULL AND r.d=v_latest_fij AND (r.d>=v_daily_horizon OR (v_hist_sweep_at IS NOT NULL AND v_hist_sweep_at>=r.d));
    v_unmatched:=v_unmatched||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160),'reciente',(r.d IS NOT NULL AND r.d>=CURRENT_DATE-90),'alcanzable_por_diario',COALESCE(v_alertable_this,false));
    IF r.d IS NOT NULL AND r.d>=CURRENT_DATE-90 THEN v_recent:=v_recent+1; END IF;
    IF v_alertable_this THEN v_alertable:=v_alertable+1; END IF;
  END LOOP;
  IF v_reserva THEN v_class:='COBERTURA_RESERVADA';
  ELSIF v_estados_provider IS NULL OR v_declared THEN v_class:='SIN_COBERTURA_DECLARADA';
  ELSIF jsonb_array_length(v_remitido)>0 THEN v_class:='REMITIDO_A_SUPERIOR';
  ELSIF jsonb_array_length(v_unmatched)>0 THEN v_class:='ESTADOS_ESPERADOS_AUSENTES';
  ELSIF jsonb_array_length(v_out_window)>0 THEN v_class:='SIN_COBERTURA_EN_ESA_FECHA';
  ELSIF jsonb_array_length(v_sin_doc)>0 THEN v_class:='ESTADO_SIN_DOCUMENTO';
  ELSIF v_acts>0 AND v_pubs=0 AND v_fij=0 THEN v_class:='ESTADOS_SIN_FIJACION_CONOCIDA'; ELSE v_class:='CUBIERTO'; END IF;
  IF v_reserva THEN v_recent:=0; v_alertable:=0; END IF;
  RETURN jsonb_build_object('work_item_id',p_work_item_id,'organization_id',w.organization_id,'workflow_type',w.workflow_type::text,'radicado',w.radicado,'despacho',w.authority_name,'estados_provider',v_estados_provider,'signal_class',v_class,'reserva_sumarial',v_reserva,'acts_count',v_acts,'pubs_count',v_pubs,'fijacion_count',v_fij,'unmatched_fijacion_count',jsonb_array_length(v_unmatched),'out_of_window_count',jsonb_array_length(v_out_window),'sin_documento_count',jsonb_array_length(v_sin_doc),'remitido_count',jsonb_array_length(v_remitido),'remision_date',v_remision_date,'remision_description',v_remision_desc,'recent_unmatched_count',v_recent,'alertable_unmatched_count',v_alertable,'last_fijacion_date',v_last_fij,'latest_fijacion_date',v_latest_fij,'historical_sweep_at',v_hist_sweep_at,'evidence',jsonb_build_object('unmatched_fijaciones',v_unmatched,'fuera_de_ventana',v_out_window,'estados_sin_documento',v_sin_doc,'remitidas',v_remitido));
END;
$function$;