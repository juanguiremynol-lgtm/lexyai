DO $pre$
BEGIN
  IF to_regclass('public.work_item_filings') IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.work_item_filings already exists; review before re-running';
  END IF;
  IF to_regprocedure('public._mcp_begin(text,text,jsonb)') IS NULL
     OR to_regprocedure('public._mcp_finish(text,text,jsonb,text,uuid,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: MCP idempotency/creation helpers missing';
  END IF;
END $pre$;

CREATE TABLE public.work_item_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  organization_id uuid,
  action_kind text NOT NULL CHECK (action_kind IN ('DEMANDA','TUTELA','MEMORIAL','RECURSO','IMPUGNACION','DESCARGOS','PETICION','SOLICITUD_ADMINISTRATIVA','OTRO')),
  filed_on date NOT NULL,
  channel text NOT NULL CHECK (channel IN ('EMAIL_OFICIAL','PLATAFORMA','PRESENCIAL','OTRO')),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 3 AND 1000),
  external_reference text CHECK (external_reference IS NULL OR length(external_reference) <= 120),
  workflow_type text NOT NULL,
  procedure_subtype text CHECK (procedure_subtype IS NULL OR procedure_subtype IN ('TRANSITO_SANCIONATORIO','AMBIENTAL_SANCIONATORIO','OTRO_SANCIONATORIO','TRAMITE_ADMINISTRATIVO','DISCIPLINARIO','ESPECIAL')),
  tribunal_type text CHECK (tribunal_type IS NULL OR tribunal_type IN ('JUDICIAL','AUTORIDAD_JURISDICCIONAL','ADMINISTRATIVA')),
  related_work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL,
  observaciones text CHECK (observaciones IS NULL OR length(observaciones) <= 2000),
  stage_or_status text NOT NULL DEFAULT 'PRESENTADO',
  legal_effect text NOT NULL DEFAULT 'PRESENTADO_NO_ACREDITADA_RECEPCION' CHECK (legal_effect = 'PRESENTADO_NO_ACREDITADA_RECEPCION'),
  deadline_effect text NOT NULL CHECK (deadline_effect IN ('NONE','PENDING_TRIGGER','PETICION_COMPUTED')),
  term_calculation_status text NOT NULL DEFAULT 'NONE',
  review_task_id uuid,
  idempotency_key text,
  source_event_key text NOT NULL,
  origin text NOT NULL DEFAULT 'MCP' CHECK (origin IN ('MCP','APP')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  UNIQUE (owner_id, source_event_key)
);
CREATE INDEX work_item_filings_item_idx ON public.work_item_filings (work_item_id, filed_on DESC, id DESC);
CREATE INDEX work_item_filings_extref_idx ON public.work_item_filings (owner_id, external_reference) WHERE external_reference IS NOT NULL;
COMMENT ON TABLE public.work_item_filings IS 'Filings the firm declares it presented (demanda, tutela, memorial, recurso, descargos...). Presentation is never receipt, admission or notification. Written only through public.mcp_register_filing.';

GRANT SELECT ON public.work_item_filings TO authenticated;
GRANT ALL ON public.work_item_filings TO service_role;
ALTER TABLE public.work_item_filings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own filings" ON public.work_item_filings FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.mcp_register_filing(
  p_action_kind text, p_filed_on date, p_channel text, p_source_reference text, p_external_reference text,
  p_observaciones text, p_workflow_type text, p_procedure_subtype text, p_tribunal_type text,
  p_work_item_id uuid, p_radicado text, p_title text, p_client_id uuid, p_demandantes text, p_demandados text,
  p_authority_name text, p_related_work_item_id uuid, p_origin text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prior jsonb; v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_src text := btrim(COALESCE(p_source_reference, ''));
  v_ext text := NULLIF(btrim(COALESCE(p_external_reference, '')), '');
  v_digits text := NULLIF(regexp_replace(COALESCE(p_radicado, ''), '[^0-9]', '', 'g'), '');
  v_w public.work_items%ROWTYPE; v_created boolean := false; v_cr jsonb; v_id uuid; v_n int;
  v_wf text; v_effect text; v_calc text; v_task uuid; v_fid uuid; v_key text; v_existing public.work_item_filings%ROWTYPE;
  v_result jsonb; v_tribunal text := NULLIF(p_tribunal_type, '');
  v_cands jsonb;
BEGIN
  v_prior := public._mcp_begin('register_filing', p_idempotency_key, jsonb_build_object('k', p_action_kind, 'd', p_filed_on,
    'ch', p_channel, 's', v_src, 'x', v_ext, 'o', p_observaciones, 'wf', p_workflow_type, 'st', p_procedure_subtype,
    'tt', v_tribunal, 'wi', p_work_item_id, 'r', v_digits, 't', p_title, 'c', p_client_id, 'dte', p_demandantes,
    'ddo', p_demandados, 'a', p_authority_name, 'rel', p_related_work_item_id));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;

  IF p_action_kind IS NULL OR p_action_kind NOT IN ('DEMANDA','TUTELA','MEMORIAL','RECURSO','IMPUGNACION','DESCARGOS','PETICION','SOLICITUD_ADMINISTRATIVA','OTRO') THEN
    RAISE EXCEPTION 'ACTION_KIND_INVALIDO' USING ERRCODE = 'MCP22'; END IF;
  IF p_filed_on IS NULL THEN
    RAISE EXCEPTION 'FECHA_PRESENTACION_REQUERIDA: indica la fecha declarada de presentación (nunca se infiere de la creación de la ficha)' USING ERRCODE = 'MCP22'; END IF;
  IF p_filed_on > v_today OR p_filed_on < DATE '1990-01-01' THEN
    RAISE EXCEPTION 'FECHA_PRESENTACION_INVALIDA: no puede ser futura' USING ERRCODE = 'MCP22'; END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('EMAIL_OFICIAL','PLATAFORMA','PRESENCIAL','OTRO') THEN
    RAISE EXCEPTION 'CANAL_INVALIDO' USING ERRCODE = 'MCP22'; END IF;
  IF length(v_src) < 3 THEN
    RAISE EXCEPTION 'SOPORTE_REQUERIDO: describe el soporte de la presentación (correo enviado, recibo de plataforma, sello)' USING ERRCODE = 'MCP22'; END IF;
  IF length(v_src) > 1000 THEN RAISE EXCEPTION 'SOPORTE_DEMASIADO_LARGO' USING ERRCODE = 'MCP22'; END IF;
  IF v_src ~* '(password|passwd|contrase|token=|access_token|sig=|signature=|apikey|api_key|secret)' THEN
    RAISE EXCEPTION 'SOPORTE_CON_CREDENCIALES: no incluyas contraseñas, tokens ni enlaces firmados; describe el soporte o usa un identificador' USING ERRCODE = 'MCP22'; END IF;
  IF v_ext IS NOT NULL AND length(v_ext) > 120 THEN RAISE EXCEPTION 'REFERENCIA_EXTERNA_DEMASIADO_LARGA' USING ERRCODE = 'MCP22'; END IF;
  IF p_observaciones IS NOT NULL AND length(p_observaciones) > 2000 THEN RAISE EXCEPTION 'OBSERVACIONES_DEMASIADO_LARGAS' USING ERRCODE = 'MCP22'; END IF;
  IF v_digits IS NOT NULL AND length(v_digits) <> 23 THEN
    RAISE EXCEPTION 'RADICADO_INVALIDO: el radicado judicial tiene 23 dígitos; usa external_reference para SPOA, comparendos o radicados administrativos' USING ERRCODE = 'MCP22'; END IF;
  IF COALESCE(p_origin, 'MCP') NOT IN ('MCP','APP') THEN RAISE EXCEPTION 'ORIGEN_INVALIDO' USING ERRCODE = 'MCP22'; END IF;

  IF p_work_item_id IS NOT NULL THEN
    SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id;
    IF NOT FOUND OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
      RAISE EXCEPTION 'NOT_FOUND_OR_FORBIDDEN: asunto no encontrado o sin permiso de gestión' USING ERRCODE = 'MCP04'; END IF;
  ELSIF v_digits IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.work_items
     WHERE owner_id = auth.uid() AND regexp_replace(COALESCE(radicado, ''), '[^0-9]', '', 'g') = v_digits;
    IF v_n > 1 THEN
      SELECT jsonb_agg(jsonb_build_object('id', id, 'workflow_type', workflow_type, 'lifecycle_state', lifecycle_state, 'deleted', deleted_at IS NOT NULL))
        INTO v_cands FROM public.work_items WHERE owner_id = auth.uid() AND regexp_replace(COALESCE(radicado, ''), '[^0-9]', '', 'g') = v_digits;
      RAISE EXCEPTION 'AMBIGUOUS: el radicado coincide con varios asuntos %; indica work_item_id', v_cands USING ERRCODE = 'MCP09';
    ELSIF v_n = 1 THEN
      SELECT * INTO v_w FROM public.work_items
       WHERE owner_id = auth.uid() AND regexp_replace(COALESCE(radicado, ''), '[^0-9]', '', 'g') = v_digits;
    END IF;
  END IF;

  IF v_w.id IS NOT NULL THEN
    IF v_w.deleted_at IS NOT NULL OR v_w.lifecycle_state::text = 'DELETED' THEN
      RAISE EXCEPTION 'ASUNTO_EN_PAPELERA: el asunto % está en la papelera; restáuralo primero (no se revive automáticamente)', v_w.id USING ERRCODE = 'MCP09'; END IF;
    IF v_w.lifecycle_state::text IN ('ARCHIVED','CLOSED') THEN
      RAISE EXCEPTION 'ASUNTO_NO_ACTIVO: el asunto % está %; reactívalo antes de registrar presentaciones', v_w.id, v_w.lifecycle_state USING ERRCODE = 'MCP09'; END IF;
    IF p_workflow_type IS NOT NULL AND p_workflow_type <> v_w.workflow_type::text THEN
      RAISE EXCEPTION 'WORKFLOW_DISTINTO: el asunto es % y se indicó %; no se reclasifica al registrar una presentación', v_w.workflow_type, p_workflow_type USING ERRCODE = 'MCP22'; END IF;
    IF p_action_kind = 'PETICION' AND v_w.workflow_type::text = 'PETICION' THEN
      RAISE EXCEPTION 'USE_PETICION_PRESENTATION: la presentación de la petición se registra en su propia ficha (create_peticion o "Registrar presentación" de la petición); aquí solo se registran escritos posteriores' USING ERRCODE = 'MCP22'; END IF;
    v_wf := v_w.workflow_type::text;
  ELSE
    IF p_action_kind = 'PETICION' OR p_workflow_type = 'PETICION' THEN
      RAISE EXCEPTION 'USE_CREATE_PETICION: las peticiones nuevas se crean con create_peticion (calcula 10/15/30 días); para una petición existente indica su work_item_id' USING ERRCODE = 'MCP22'; END IF;
    IF p_workflow_type IS NULL OR p_workflow_type NOT IN ('CGP','EJECUTIVO','CPACA','TUTELA','LABORAL','PENAL_906','GOV_PROCEDURE') THEN
      RAISE EXCEPTION 'WORKFLOW_REQUERIDO: indica workflow_type explícito (no se deduce del nombre de la autoridad)' USING ERRCODE = 'MCP22'; END IF;
    IF p_workflow_type = 'GOV_PROCEDURE' AND p_procedure_subtype IS NULL THEN
      RAISE EXCEPTION 'SUBTIPO_REQUERIDO: GOV_PROCEDURE exige procedure_subtype' USING ERRCODE = 'MCP22'; END IF;
    IF v_ext IS NOT NULL THEN
      SELECT jsonb_agg(DISTINCT jsonb_build_object('id', w.id, 'workflow_type', w.workflow_type, 'lifecycle_state', w.lifecycle_state, 'deleted', w.deleted_at IS NOT NULL))
        INTO v_cands
        FROM public.work_items w
       WHERE w.owner_id = auth.uid()
         AND (w.source_payload->>'external_reference' = v_ext
              OR EXISTS (SELECT 1 FROM public.work_item_filings f WHERE f.work_item_id = w.id AND f.external_reference = v_ext AND f.deleted_at IS NULL)
              OR EXISTS (SELECT 1 FROM public.peticion_work_item_state s WHERE s.work_item_id = w.id AND s.authority_radicado = v_ext));
      IF v_cands IS NOT NULL THEN
        RAISE EXCEPTION 'POSIBLE_DUPLICADO: la referencia externa ya figura en %; indica work_item_id para registrar ahí (o restaura si está en papelera)', v_cands USING ERRCODE = 'MCP09'; END IF;
    END IF;
  END IF;

  v_wf := COALESCE(v_wf, p_workflow_type);
  IF p_procedure_subtype IS NOT NULL AND v_wf <> 'GOV_PROCEDURE' THEN
    RAISE EXCEPTION 'SUBTIPO_SOLO_GOV_PROCEDURE: CPACA es judicial (SAMAI); los sancionatorios ante la administración van en GOV_PROCEDURE' USING ERRCODE = 'MCP22'; END IF;
  IF p_procedure_subtype IS NOT NULL AND p_procedure_subtype NOT IN ('TRANSITO_SANCIONATORIO','AMBIENTAL_SANCIONATORIO','OTRO_SANCIONATORIO','TRAMITE_ADMINISTRATIVO','DISCIPLINARIO','ESPECIAL') THEN
    RAISE EXCEPTION 'SUBTIPO_INVALIDO' USING ERRCODE = 'MCP22'; END IF;
  IF v_tribunal IS NOT NULL AND v_tribunal NOT IN ('JUDICIAL','AUTORIDAD_JURISDICCIONAL','ADMINISTRATIVA') THEN
    RAISE EXCEPTION 'TRIBUNAL_TYPE_INVALIDO' USING ERRCODE = 'MCP22'; END IF;
  IF v_tribunal = 'AUTORIDAD_JURISDICCIONAL' AND v_wf IN ('GOV_PROCEDURE','PETICION') THEN
    RAISE EXCEPTION 'CLASIFICACION_INCOHERENTE: una superintendencia en funciones jurisdiccionales no es trámite administrativo; usa CGP u otro flujo judicial' USING ERRCODE = 'MCP22'; END IF;
  IF v_tribunal = 'ADMINISTRATIVA' AND v_wf NOT IN ('GOV_PROCEDURE','PETICION') THEN
    RAISE EXCEPTION 'CLASIFICACION_INCOHERENTE: autoridad administrativa solo en GOV_PROCEDURE o PETICION' USING ERRCODE = 'MCP22'; END IF;
  IF p_related_work_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_items
      WHERE id = p_related_work_item_id AND owner_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'RELACIONADO_NO_ENCONTRADO' USING ERRCODE = 'MCP04'; END IF;

  SELECT f.* INTO v_existing FROM public.work_item_filings f
   WHERE f.owner_id = auth.uid() AND f.deleted_at IS NULL AND f.action_kind = p_action_kind
     AND f.filed_on = p_filed_on AND lower(btrim(f.source_reference)) = lower(v_src)
     AND (v_w.id IS NULL OR f.work_item_id = v_w.id)
   ORDER BY f.created_at LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    v_result := jsonb_build_object('ok', true, 'duplicate_support', true, 'created_work_item', false,
      'work_item_id', v_existing.work_item_id, 'filing_id', v_existing.id, 'fecha_presentacion', v_existing.filed_on,
      'tipo', v_existing.action_kind, 'fuente', v_existing.source_reference, 'external_reference', v_existing.external_reference,
      'workflow_type', v_existing.workflow_type, 'status', v_existing.stage_or_status, 'legal_effect', v_existing.legal_effect,
      'deadline_effect', v_existing.deadline_effect, 'term_calculation_status', v_existing.term_calculation_status,
      'created_at', v_existing.created_at);
    RETURN public._mcp_finish('register_filing', p_idempotency_key, v_result, 'work_item', v_existing.work_item_id, NULL, v_result);
  END IF;

  IF v_w.id IS NULL THEN
    v_cr := public.mcp_create_work_item(v_wf, NULL, v_digits, p_title, p_client_id, p_demandantes, p_demandados,
      p_authority_name, NULL, 'filing:' || p_idempotency_key);
    v_id := (v_cr->'work_item'->>'id')::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'CREACION_FALLIDA' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.work_items
       SET source_payload = COALESCE(source_payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
             'external_reference', v_ext, 'procedure_subtype', p_procedure_subtype, 'tribunal_type', v_tribunal,
             'related_work_item_id', p_related_work_item_id, 'created_from', 'register_filing'))
     WHERE id = v_id;
    SELECT * INTO v_w FROM public.work_items WHERE id = v_id;
    v_created := true;
  END IF;

  IF p_action_kind IN ('DEMANDA','TUTELA','MEMORIAL','RECURSO','IMPUGNACION','DESCARGOS') THEN
    v_effect := 'PENDING_TRIGGER'; v_calc := 'PENDING_LEGAL_TRIGGER_REVIEW';
  ELSE
    v_effect := 'NONE'; v_calc := 'NONE';
  END IF;

  v_key := md5(v_w.id::text || '|' || p_action_kind || '|' || p_filed_on::text || '|' || lower(v_src));
  INSERT INTO public.work_item_filings (work_item_id, owner_id, organization_id, action_kind, filed_on, channel,
    source_reference, external_reference, workflow_type, procedure_subtype, tribunal_type, related_work_item_id,
    observaciones, deadline_effect, term_calculation_status, idempotency_key, source_event_key, origin, created_by)
  VALUES (v_w.id, v_w.owner_id, v_w.organization_id, p_action_kind, p_filed_on, p_channel, v_src, v_ext, v_wf,
    p_procedure_subtype, v_tribunal, p_related_work_item_id, NULLIF(btrim(COALESCE(p_observaciones, '')), ''),
    v_effect, v_calc, p_idempotency_key, v_key, COALESCE(p_origin, 'MCP'), auth.uid())
  RETURNING id INTO v_fid;

  IF v_effect = 'PENDING_TRIGGER' THEN
    INSERT INTO public.work_item_tasks (owner_id, organization_id, work_item_id, title, description, priority, due_date, template_key)
    VALUES (v_w.owner_id, v_w.organization_id, v_w.id,
      'Revisar evento habilitante de términos (' || p_action_kind || ' presentado ' || to_char(p_filed_on, 'DD/MM/YYYY') || ')',
      'La presentación no acredita recepción, admisión ni notificación y no genera plazo por sí sola. Verificar la providencia, notificación o traslado que habilite un término y registrarlo con su regla.',
      'MEDIA', now(), 'filing_legal_trigger_review')
    RETURNING id INTO v_task;
    UPDATE public.work_item_filings SET review_task_id = v_task WHERE id = v_fid;
  END IF;

  v_result := jsonb_build_object('ok', true, 'created_work_item', v_created, 'work_item_id', v_w.id, 'filing_id', v_fid,
    'fecha_presentacion', p_filed_on, 'fecha_creacion_ficha', v_w.created_at, 'tipo', p_action_kind, 'canal', p_channel,
    'fuente', v_src, 'external_reference', v_ext, 'workflow_type', v_wf, 'procedure_subtype', p_procedure_subtype,
    'tribunal_type', v_tribunal, 'status', 'PRESENTADO', 'legal_effect', 'PRESENTADO_NO_ACREDITADA_RECEPCION',
    'recepcion_acreditada', false, 'admitida', false, 'notificada', false,
    'monitoring_source', CASE
      WHEN v_wf = 'GOV_PROCEDURE' THEN 'MANUAL_OUTLOOK_PORTAL'
      WHEN v_w.radicado IS NOT NULL AND v_w.monitoring_enabled THEN CASE WHEN v_wf = 'CPACA' THEN 'SAMAI' ELSE 'RAMA_JUDICIAL' END
      ELSE 'MANUAL_PENDIENTE_RADICADO' END,
    'deadline_effect', v_effect, 'term_calculation_status', v_calc, 'review_task_id', v_task,
    'created_at', now());
  RETURN public._mcp_finish('register_filing', p_idempotency_key, v_result, 'work_item', v_w.id, NULL, v_result);
END $$;
REVOKE ALL ON FUNCTION public.mcp_register_filing(text,date,text,text,text,text,text,text,text,uuid,text,text,uuid,text,text,text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_register_filing(text,date,text,text,text,text,text,text,text,uuid,text,text,uuid,text,text,text,uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_mutation_availability()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE tools jsonb:='{}'; r record; executable boolean; authorized boolean:=public.mcp_write_allowed();
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('create_work_item','public.mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)'),
 ('create_peticion','public.mcp_create_peticion(text,uuid,text,text,text,boolean,date,text,text,text,text[],text)'),
 ('register_filing','public.mcp_register_filing(text,date,text,text,text,text,text,text,text,uuid,text,text,uuid,text,text,text,uuid,text,text)'),
 ('change_work_item_lifecycle','public.mcp_work_item_lifecycle(uuid,text,timestamptz,text,text)'),
 ('move_work_item_stage','public.mcp_move_work_item_stage(uuid,text,timestamptz,text[],text,text)'),
 ('resolve_stage_suggestion','public.mcp_resolve_stage_suggestion(uuid,text,timestamptz,text[],text,text)'),
 ('resolve_alert','public.mcp_resolve_alert(uuid,text,text,text)'),
 ('set_notification_state','public.mcp_set_notification_state(uuid[],text,timestamptz,text)'),
 ('resolve_email_question','public.mcp_resolve_email_question(uuid,text,text)'),
 ('add_email_association','public.mcp_add_email_association(uuid,uuid,text)'),
 ('resolve_detected_process','public.mcp_resolve_detected_process(uuid,text,uuid,text)'),
 ('assign_work_item_radicado','public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text)'),
 ('update_work_item','public.mcp_update_work_item(uuid,jsonb,boolean,text,text)'),
 ('correct_hearing','public.mcp_correct_hearing(uuid,jsonb,timestamptz,text,text)'), ('reclassify_work_item','public.mcp_reclassify_work_item(uuid,text,text,timestamptz,text,text)'), ('create_client','public.mcp_create_client(text,text,text,text,text)'), ('update_client','public.mcp_update_client(uuid,jsonb,timestamptz,text)'), ('add_note','public.append_work_item_note(uuid,text)')) g(tool,signature) LOOP
 executable:=COALESCE(has_function_privilege(current_user,to_regprocedure(r.signature),'EXECUTE'),false);
 tools:=tools||jsonb_build_object(r.tool,jsonb_build_object('execution_available',executable,'available',executable AND authorized));
 END LOOP;
 FOR r IN SELECT * FROM (VALUES('add_hearing','public.work_item_hearings','INSERT'),('manage_deadline','public.work_item_deadlines','INSERT,UPDATE'),('manage_task','public.work_item_tasks','INSERT,UPDATE'),('whatsapp_prepare','public.client_wa_consent','INSERT,UPDATE')) g(tool,tbl,privs) LOOP
 executable:=COALESCE(has_table_privilege(current_user,to_regclass(r.tbl),r.privs),false);
 IF r.tool='whatsapp_prepare' THEN executable:=executable AND COALESCE(has_table_privilege(current_user,to_regclass('public.client_wa_drafts'),'UPDATE'),false) AND COALESCE(has_function_privilege(current_user,to_regprocedure('public.client_wa_generate_drafts(uuid,integer)'),'EXECUTE'),false); END IF;
 tools:=tools||jsonb_build_object(r.tool,jsonb_build_object('execution_available',executable,'available',executable AND authorized));
 END LOOP;
 RETURN jsonb_build_object('verified',true,'tools',tools,'permission',public.mcp_access_level());
END $function$;