
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
CREATE TABLE auth.sessions(id uuid primary key,user_id uuid,oauth_client_id uuid,scopes text,not_after timestamptz);
CREATE TABLE auth.oauth_clients(id uuid primary key,deleted_at timestamptz);
CREATE TABLE auth.oauth_consents(id uuid primary key,user_id uuid,client_id uuid,granted_at timestamptz,revoked_at timestamptz);
CREATE TABLE public.mcp_client_grants(user_id uuid,oauth_client_id uuid,consent_id uuid,consent_granted_at timestamptz,access_level text,revoked_at timestamptz);
CREATE TYPE work_item_lifecycle_state AS ENUM ('ACTIVE','PAUSED','CLOSED','ARCHIVED','DELETED');
CREATE TYPE item_status AS ENUM ('ACTIVE','INACTIVE','CLOSED','ARCHIVED');
CREATE TABLE public.organizations(id uuid PRIMARY KEY,max_monitored_items integer);
CREATE TABLE public.work_items("id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,"owner_id" uuid,"client_id" uuid,"matter_id" uuid,"workflow_type" text,"stage" text,"status" text,"cgp_phase" text,"cgp_phase_source" text,"source" text,"source_reference" text,"source_payload" jsonb,"radicado" text,"radicado_verified" bool,"authority_name" text,"authority_email" text,"authority_city" text,"authority_department" text,"demandantes" text,"demandados" text,"title" text,"description" text,"notes" text,"auto_admisorio_date" timestamptz,"filing_date" timestamptz,"last_action_date" timestamptz,"last_action_description" text,"is_flagged" bool,"monitoring_enabled" bool DEFAULT false,"email_linking_enabled" bool,"expediente_url" text,"sharepoint_url" text,"scrape_status" text,"last_checked_at" timestamptz,"last_crawled_at" timestamptz,"scraped_fields" jsonb,"total_actuaciones" int4,"legacy_cgp_item_id" uuid,"legacy_peticion_id" uuid,"legacy_cpaca_id" uuid,"legacy_admin_process_id" uuid,"created_at" timestamptz,"updated_at" timestamptz,"cgp_class" text,"cgp_variant" text,"cgp_cuantia" text,"cgp_instancia" text,"notification_substatus" text,"notification_effective_date" timestamptz,"migration_note" text,"deleted_at" timestamptz,"deleted_by" uuid,"delete_reason" text,"acta_reparto_received_at" timestamptz,"acta_reparto_notes" text,"organization_id" uuid,"pipeline_stage" int4,"last_event_at" timestamptz,"last_event_summary" text,"last_phase_change_at" timestamptz,"last_scrape_at" timestamptz,"scraping_enabled" bool,"source_platform" text,"tutela_code" text,"last_scrape_initiated_at" timestamptz,"scrape_job_id" text,"scrape_poll_url" text,"scrape_provider" text,"ponente" text,"origen" text,"clase_proceso" text,"etapa" text,"ubicacion_expediente" text,"formato_expediente" text,"tipo_proceso" text,"subclase_proceso" text,"tipo_recurso" text,"naturaleza_proceso" text,"asunto" text,"medida_cautelar" text,"ministerio_publico" text,"fecha_radicado" date,"fecha_presenta_demanda" date,"fecha_para_sentencia" date,"fecha_sentencia" text,"total_sujetos_procesales" int4,"samai_guid" text,"samai_consultado_en" timestamptz,"samai_veces_en_corporacion" int4,"samai_sala_conoce" text,"samai_sala_decide" text,"samai_fuente" text,"last_synced_at" timestamptz,"latest_estado_fingerprint" text,"latest_estado_at" timestamptz,"stage_inference_enabled" bool,"last_inference_date" date,"last_stage_change_source" text,"last_stage_change_at" timestamptz,"last_stage_change_by_user_id" uuid,"last_stage_suggestion_id" uuid,"acta_radicacion_url" text,"auto_admisorio_url" text,"onedrive_url" text,"corte_status" text,"sentencia_ref" text,"provider_sources" jsonb,"consecutive_404_count" int4,"demonitor_reason" text,"demonitor_at" timestamptz,"atenia_health_score" numeric,"last_stage_suggestion_at" timestamptz,"provider_reachable" bool,"radicado_raw" text,"milestones_cleared_at" timestamptz,"milestones_cleared_status" text,"raw_courthouse_input" jsonb,"courthouse_directory_id" int8,"resolved_email" text,"resolution_method" text,"resolution_confidence" numeric,"courthouse_needs_review" bool,"resolved_at" timestamptz,"resolution_candidates" jsonb,"radicado_blocks" jsonb,"radicado_valid" bool,"consecutive_failures" int4,"last_error_code" text,"last_error_at" timestamptz,"monitoring_disabled_reason" text,"monitoring_disabled_by" text,"monitoring_disabled_at" timestamptz,"monitoring_disabled_meta" jsonb,"consecutive_not_found" int4,"last_successful_sync_at" timestamptz,"last_attempted_sync_at" timestamptz,"last_error_meta" jsonb,"monitoring_suspended_at" timestamptz,"monitoring_suspended_reason" text,"purge_after" timestamptz,"courthouse_email_suggested" text,"courthouse_email_confirmed" text,"courthouse_email_status" text,"courthouse_email_confidence" int4,"courthouse_email_source" text,"courthouse_email_evidence" jsonb,"courthouse_email_suggested_at" timestamptz,"courthouse_email_confirmed_at" timestamptz,"freshness_tier" text,"freshness_sla_hours" int4,"last_sync_attempt_at" timestamptz,"sync_failure_streak" int4,"freshness_violation_at" timestamptz,"freshness_violation_notified" bool,"ghost_candidate_at" timestamptz,"ghost_verification_status" text,"ghost_verification_run_id" uuid,"monitoring_mode" text,"ghost_bootstrap_attempts" int4,"service_object" text,"acts_initial_sync_completed_at" timestamptz,"pubs_initial_sync_completed_at" timestamptz,"last_cpnu_buscar_at" timestamptz,"needs_cpnu_refresh" bool,"pp_id" int4,"pp_ultima_sync" timestamptz,"pp_estado" text,"pp_novedades_pendientes" int4,"lifecycle_state" work_item_lifecycle_state,"lifecycle_reason" text,"lifecycle_changed_at" timestamptz,"lifecycle_changed_by" uuid,"lifecycle_actor" text,"lifecycle_actor_user" uuid,"radicado_digits" text,"despacho_competencia" text,"despacho_competencia_subjects" text[],"workflow_type_source" text,"clase_proveedor" jsonb,"clase_proceso_disponible" bool,"clase_proceso_motivo_ausencia" text,"clase_proceso_procedencia" jsonb,"clase_proceso_observed_at" timestamptz,"clase_proceso_last_read_case" text,"clase_proceso_last_attempt_at" timestamptz,"provider_detail_exposure" text,"provider_detail_reason" text,"provider_detail_observed_at" timestamptz,"provider_detail_desde" timestamptz,"provider_detail_ultima_verificacion" timestamptz,"provider_detail_ttl_days" int4,"client_party_role" text,"client_party_role_source" text,"client_party_role_confidence" numeric,"client_party_role_basis" text,"client_party_role_confirmed_at" timestamptz,"client_party_role_confirmed_by" uuid,"client_party_represents" text,"client_party_role_overridden" bool,"client_party_role_proposed" text,"client_party_role_override_confidence" numeric,"closure_reason" text,"closure_note" text,"closure_at" timestamptz,"title_source" text,"authority_id" uuid,"notification_override" text);

CREATE UNIQUE INDEX idx_work_items_unique_radicado ON work_items(owner_id,radicado,workflow_type) WHERE radicado IS NOT NULL;
GRANT SELECT,INSERT,UPDATE ON work_items TO authenticated;
ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON work_items TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE TABLE notifications(id uuid primary key,user_id uuid,title text,created_at timestamptz,work_item_id uuid,category text,severity text);
CREATE TABLE notification_user_state(notification_id uuid,user_id uuid,read_at timestamptz,dismissed_at timestamptz,snoozed_until timestamptz,PRIMARY KEY(notification_id,user_id));
GRANT SELECT ON notifications,notification_user_state TO authenticated;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON notifications TO authenticated USING(user_id=auth.uid());
ALTER TABLE notification_user_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON notification_user_state TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public._mcp_is_trusted_backend() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_provider_monitored_workflow(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT $1 IN ('CGP','CPACA','LABORAL','PENAL_906','TUTELA','EJECUTIVO') $$;
CREATE FUNCTION public.get_effective_limits(uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT jsonb_build_object('max_monitored_items',max_monitored_items) FROM organizations WHERE id=$1 $$;
-- Fixture-only enrollment records: no queue, jobs or external side effects.
CREATE TABLE fixture_enrollment(work_item_id uuid primary key,radicado text);
CREATE FUNCTION public.sync_work_item_enrollment(uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO fixture_enrollment SELECT id,radicado FROM work_items WHERE id=$1 ON CONFLICT(work_item_id) DO UPDATE SET radicado=excluded.radicado $$;
-- 0071: fail-closed MCP caller/consent/owner semantics (review patch 2026-10-24).
-- Additive replacement of helper bodies; signatures unchanged. Keeps the
-- narrower token-scope restriction (andromeda:read without andromeda:manage => read)
-- and the existing explicit trusted-backend definition (_mcp_is_trusted_backend).

CREATE OR REPLACE FUNCTION public.mcp_caller_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid; v_role text; v_claims jsonb;
  v_sid uuid; v_claim_client uuid; v_sess record; v_consent record;
BEGIN
  BEGIN
    v_uid := auth.uid();
    v_role := auth.role();
    v_claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'invalid', 'unverified_reason', 'MALFORMED_CLAIMS');
  END;
  IF jsonb_typeof(v_claims) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'invalid', 'unverified_reason', 'MALFORMED_CLAIMS');
  END IF;
  IF v_uid IS NULL AND public._mcp_is_trusted_backend() THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'maintenance', 'trusted_maintenance', true);
  END IF;
  IF v_uid IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'anonymous', 'unverified_reason', 'AUTHENTICATED_USER_REQUIRED');
  END IF;
  BEGIN
    v_sid := NULLIF(v_claims->>'session_id', '')::uuid;
    v_claim_client := NULLIF(v_claims->>'client_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'MALFORMED_CLAIMS');
  END;
  IF v_sid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'NO_SESSION');
  END IF;
  SELECT s.id, s.user_id, s.oauth_client_id, s.scopes, s.not_after INTO v_sess
    FROM auth.sessions s WHERE s.id = v_sid AND s.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'SESSION_NOT_FOUND');
  END IF;
  IF v_sess.not_after IS NOT NULL AND v_sess.not_after <= now() THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'SESSION_EXPIRED');
  END IF;
  -- Both sides must agree: OAuth session without claim, or native session with claim, is invalid.
  IF v_sess.oauth_client_id IS DISTINCT FROM v_claim_client THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'CLIENT_MISMATCH');
  END IF;
  IF v_sess.oauth_client_id IS NULL THEN
    RETURN jsonb_build_object('authenticated', true, 'surface', 'first_party', 'user_id', v_uid,
      'session_id', v_sid, 'session_found', true, 'oauth_client_id', NULL,
      'unverified_reason', NULL, 'token_scopes', v_sess.scopes);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.oauth_clients cl WHERE cl.id = v_sess.oauth_client_id AND cl.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'CLIENT_DELETED');
  END IF;
  SELECT oc.id, oc.granted_at INTO v_consent
    FROM auth.oauth_consents oc
   WHERE oc.user_id = v_uid AND oc.client_id = v_sess.oauth_client_id AND oc.revoked_at IS NULL
   ORDER BY oc.granted_at DESC, oc.id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'CONSENT_INACTIVE');
  END IF;
  RETURN jsonb_build_object('authenticated', true, 'surface', 'oauth_client', 'user_id', v_uid,
    'session_id', v_sid, 'session_found', true, 'oauth_client_id', v_sess.oauth_client_id,
    'unverified_reason', NULL, 'token_scopes', v_sess.scopes,
    'consent_id', v_consent.id, 'consent_granted_at', v_consent.granted_at);
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_access_level()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE c jsonb := public.mcp_caller_context(); v_level text; v_scopes text;
BEGIN
  IF c->>'surface' = 'maintenance' AND COALESCE((c->>'trusted_maintenance')::boolean, false) THEN
    RETURN 'maintenance';
  END IF;
  IF NOT COALESCE((c->>'authenticated')::boolean, false) THEN RETURN 'none'; END IF;
  IF c->>'surface' = 'first_party' THEN RETURN 'first_party'; END IF;
  IF c->>'surface' IS DISTINCT FROM 'oauth_client' THEN RETURN 'none'; END IF;
  -- Only the grant bound to the caller's current consent generation counts.
  SELECT g.access_level INTO v_level
    FROM public.mcp_client_grants g
    JOIN auth.oauth_consents oc ON oc.id = g.consent_id
   WHERE g.user_id = (c->>'user_id')::uuid
     AND g.oauth_client_id = (c->>'oauth_client_id')::uuid
     AND g.revoked_at IS NULL
     AND oc.user_id = g.user_id AND oc.client_id = g.oauth_client_id
     AND oc.revoked_at IS NULL AND oc.granted_at = g.consent_granted_at
     AND oc.id = (c->>'consent_id')::uuid
     AND oc.granted_at = (c->>'consent_granted_at')::timestamptz
   LIMIT 1;
  v_level := CASE WHEN v_level = 'manage' THEN 'manage' ELSE 'read' END;
  -- Narrower token scope still restricts an app grant.
  v_scopes := COALESCE(c->>'token_scopes', '');
  IF v_scopes ~ '(^|\s)andromeda:read(\s|$)' AND v_scopes !~ '(^|\s)andromeda:manage(\s|$)' THEN
    v_level := 'read';
  END IF;
  RETURN v_level;
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_write_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$ SELECT COALESCE(public.mcp_access_level() IN ('first_party', 'manage', 'maintenance'), false) $function$;

CREATE OR REPLACE FUNCTION public.mcp_assert_write()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NOT public.mcp_write_allowed() THEN
    RAISE EXCEPTION 'MCP_MANAGE_GRANT_REQUIRED: sesión no válida o conexión de IA sin permiso Gestionar; autoriza desde una sesión propia de Andromeda'
      USING ERRCODE = 'MCP01';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public._mcp_can_manage_work_item(p_owner uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  -- Owner-only (ROLE_AND_SUBSCRIPTION_SPEC §5); p_org kept for signature compatibility.
  SELECT COALESCE(p_owner = auth.uid(), false) AND public.mcp_write_allowed()
$function$;

REVOKE ALL ON FUNCTION public.mcp_caller_context() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_access_level() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_write_allowed() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_assert_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_caller_context(), public.mcp_access_level(),
  public.mcp_write_allowed(), public.mcp_assert_write() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_can_manage_work_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mcp_can_manage_work_item(uuid, uuid) TO service_role;
CREATE TABLE public.mcp_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_key uuid NOT NULL,
  action text NOT NULL,
  idem_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_key, action, idem_key)
);
GRANT SELECT ON public.mcp_idempotency TO authenticated;
GRANT ALL ON public.mcp_idempotency TO service_role;
ALTER TABLE public.mcp_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own MCP idempotency readable" ON public.mcp_idempotency
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.mcp_action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  oauth_client_id uuid,
  session_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  idem_key text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_action_audit_user_idx ON public.mcp_action_audit (user_id, created_at DESC);
GRANT SELECT ON public.mcp_action_audit TO authenticated;
GRANT ALL ON public.mcp_action_audit TO service_role;
ALTER TABLE public.mcp_action_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own MCP audit readable" ON public.mcp_action_audit
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public._mcp_begin(p_action text, p_key text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c jsonb := public.mcp_caller_context();
  v_client uuid := COALESCE((c->>'oauth_client_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
  v_hash text := md5(COALESCE(p_payload, '{}'::jsonb)::text);
  v_row public.mcp_idempotency%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM public.mcp_assert_write();
  IF p_key IS NULL OR length(p_key) < 8 OR length(p_key) > 200 THEN
    RAISE EXCEPTION 'idempotency_key must be 8-200 characters' USING ERRCODE = 'MCP22';
  END IF;
  INSERT INTO public.mcp_idempotency (user_id, client_key, action, idem_key, request_hash)
  VALUES (auth.uid(), v_client, p_action, p_key, v_hash)
  ON CONFLICT (user_id, client_key, action, idem_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_row FROM public.mcp_idempotency
   WHERE user_id = auth.uid() AND client_key = v_client AND action = p_action AND idem_key = p_key;
  IF v_row.request_hash <> v_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED: la clave ya se usó con otros datos' USING ERRCODE = 'MCP09';
  END IF;
  IF v_row.result IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS' USING ERRCODE = 'MCP09';
  END IF;
  RETURN v_row.result || jsonb_build_object('replayed', true);
END $function$;

CREATE OR REPLACE FUNCTION public._mcp_finish(p_action text, p_key text, p_result jsonb, p_target_type text, p_target_id uuid, p_before jsonb, p_after jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c jsonb := public.mcp_caller_context();
  v_client uuid := (c->>'oauth_client_id')::uuid;
  v_n int;
BEGIN
  UPDATE public.mcp_idempotency SET result = p_result
   WHERE user_id = auth.uid()
     AND client_key = COALESCE(v_client, '00000000-0000-0000-0000-000000000000'::uuid)
     AND action = p_action AND idem_key = p_key AND result IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'idempotency record missing' USING ERRCODE = 'MCP09'; END IF;
  INSERT INTO public.mcp_action_audit (user_id, oauth_client_id, session_id, action, target_type,
                                       target_id, idem_key, before, after)
  VALUES (auth.uid(), v_client, NULLIF(c->>'session_id', '')::uuid, p_action, p_target_type,
          p_target_id, p_key, p_before, p_after);
  RETURN p_result || jsonb_build_object('replayed', false);
END $function$;

CREATE OR REPLACE FUNCTION public._mcp_wi_snapshot(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('id', w.id, 'radicado', w.radicado, 'workflow_type', w.workflow_type,
    'stage', w.stage, 'lifecycle_state', w.lifecycle_state, 'status', w.status,
    'deleted_at', w.deleted_at, 'purge_after', w.purge_after,
    'monitoring_enabled', w.monitoring_enabled, 'monitoring_disabled_reason', w.monitoring_disabled_reason,
    'updated_at', w.updated_at)
  FROM public.work_items w WHERE w.id = p_id
$function$;

CREATE OR REPLACE FUNCTION public.apply_monitoring_invariant()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_provider_workflow boolean;
  v_active boolean;
  v_has_radicado boolean;
  v_eligible boolean;
  v_suspended boolean;
BEGIN
  v_provider_workflow := public.is_provider_monitored_workflow(NEW.workflow_type::text);
  v_active := NEW.deleted_at IS NULL
              AND COALESCE(NEW.lifecycle_state::text,'ACTIVE') = 'ACTIVE';
  v_has_radicado := NULLIF(btrim(COALESCE(NEW.radicado,'')), '') IS NOT NULL;
  v_eligible := v_provider_workflow AND v_active AND v_has_radicado;

  v_suspended := COALESCE(NEW.monitoring_disabled_by, '') = 'USER'
                 AND COALESCE(btrim(NEW.monitoring_disabled_reason), '') <> '';

  IF NOT v_eligible THEN
    NEW.monitoring_enabled := false;
    IF COALESCE(btrim(NEW.monitoring_disabled_reason), '') = '' THEN
      NEW.monitoring_disabled_reason := CASE
        WHEN NOT v_provider_workflow THEN 'WORKFLOW_SIN_PROVEEDOR'
        WHEN NEW.deleted_at IS NOT NULL THEN 'ASUNTO_ELIMINADO'
        -- State the verifiable fact (our own lifecycle value), never an
        -- inference about the expediente.
        WHEN NOT v_active THEN 'CICLO_DE_VIDA_' || COALESCE(NEW.lifecycle_state::text,'DESCONOCIDO')
        ELSE 'PENDIENTE_DE_RADICACION'
      END;
      NEW.monitoring_disabled_at := COALESCE(NEW.monitoring_disabled_at, now());
      NEW.monitoring_disabled_by := COALESCE(NEW.monitoring_disabled_by, 'SYSTEM');
    END IF;
  ELSIF NOT v_suspended THEN
    NEW.monitoring_enabled := true;
    NEW.monitoring_disabled_reason := NULL;
    NEW.monitoring_disabled_at := NULL;
    NEW.monitoring_disabled_by := NULL;
    NEW.demonitor_reason := NULL;
    NEW.demonitor_at := NULL;
  ELSE
    NEW.monitoring_enabled := false;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_monitoring_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limits jsonb;
  v_current_monitored integer;
  v_max integer;
BEGIN
  -- Only check when monitoring is being enabled (false→true)
  IF NEW.monitoring_enabled = true AND (OLD.monitoring_enabled IS DISTINCT FROM true) THEN
    IF NEW.organization_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_limits := get_effective_limits(NEW.organization_id);
    v_max := (v_limits->>'max_monitored_items')::integer;

    SELECT COUNT(*) INTO v_current_monitored
    FROM work_items
    WHERE organization_id = NEW.organization_id
      AND monitoring_enabled = true
      AND deleted_at IS NULL
      AND id != NEW.id; -- exclude current item

    IF v_current_monitored >= v_max THEN
      RAISE EXCEPTION 'Monitoring limit reached: maximum % monitored items for your plan.', v_max
        USING ERRCODE = 'P0429';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_enrollment_after_work_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.sync_work_item_enrollment(NEW.id);
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.set_work_item_lifecycle(p_work_item_id uuid, p_new_state work_item_lifecycle_state, p_reason text DEFAULT NULL::text, p_actor text DEFAULT 'USER'::text, p_actor_user uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev   public.work_item_lifecycle_state;
  v_row    public.work_items%ROWTYPE;
  v_now    timestamptz := clock_timestamp();
  v_purge  timestamptz;
  v_status public.item_status;
  v_actor_user uuid;
  v_change_source text;
  v_base text;
  v_wf text;
  v_rad23 text;
  v_sib record;
  v_offset int := 1;
  v_emitted text[] := ARRAY[]::text[];
  v_uid uuid;
  v_trusted boolean;
  v_ctx jsonb;
  v_outbox_id uuid;
  v_ledger_n int;
BEGIN
  PERFORM set_config('andromeda.via_lifecycle_rpc', 'on', true);

  -- Caller guard. Trusted maintenance = service_role JWT or a no-JWT backend
  -- login (pg_cron/migrations), decided by public._mcp_is_trusted_backend()
  -- which never reads current_user. Every other caller must be a verified
  -- session (first-party, or OAuth with a manage grant) AND the matter owner:
  -- per ROLE_AND_SUBSCRIPTION_SPEC section 5 business admins and platform
  -- admins only read work_items. The actor is always auth.uid().
  v_uid := auth.uid();
  v_trusted := v_uid IS NULL AND public._mcp_is_trusted_backend();
  IF NOT v_trusted THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    v_ctx := public.mcp_caller_context();
    IF v_ctx->>'surface' NOT IN ('first_party', 'oauth_client') THEN
      RAISE EXCEPTION 'unverified session' USING ERRCODE = '42501';
    END IF;
    PERFORM public.mcp_assert_write();
    p_actor_user := v_uid;
    IF v_ctx->>'surface' = 'oauth_client' THEN
      p_actor := 'MCP';
    ELSIF COALESCE(p_actor, 'USER') NOT IN ('USER', 'MCP') THEN
      p_actor := 'USER';
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_item % not found', p_work_item_id;
  END IF;

  IF NOT v_trusted AND v_row.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'work_item % not found', p_work_item_id USING ERRCODE = '42501';
  END IF;

  v_prev := v_row.lifecycle_state;

  IF v_prev = p_new_state THEN
    RETURN jsonb_build_object('ok', true, 'no_op', true, 'prev_state', v_prev, 'new_state', p_new_state);
  END IF;

  IF p_new_state = 'PAUSED' THEN
    INSERT INTO public.lifecycle_pause_refusals (work_item_id, attempted_state, actor, reason, metadata)
    VALUES (p_work_item_id, p_new_state::text, COALESCE(p_actor, 'SYSTEM'), p_reason,
            COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('prev_state', v_prev));
    RETURN jsonb_build_object('ok', false, 'refused', true, 'prev_state', v_prev,
                              'attempted_state', p_new_state, 'actor', COALESCE(p_actor, 'SYSTEM'),
                              'error', 'PAUSE_STATE_DOES_NOT_EXIST');
  END IF;

  IF v_prev = 'DELETED' AND p_new_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'invalid transition: DELETED -> %', p_new_state;
  END IF;

  IF p_new_state = 'DELETED' THEN
    v_purge := v_now + interval '10 days';
  END IF;

  v_status := CASE p_new_state
    WHEN 'ACTIVE'   THEN 'ACTIVE'::public.item_status
    WHEN 'PAUSED'   THEN 'INACTIVE'::public.item_status
    WHEN 'CLOSED'   THEN 'CLOSED'::public.item_status
    WHEN 'ARCHIVED' THEN 'ARCHIVED'::public.item_status
    WHEN 'DELETED'  THEN 'INACTIVE'::public.item_status
  END;

  UPDATE public.work_items SET
    lifecycle_state = p_new_state,
    lifecycle_reason = p_reason,
    lifecycle_actor = p_actor,
    lifecycle_actor_user = p_actor_user,
    lifecycle_changed_at = v_now,
    monitoring_enabled = (p_new_state = 'ACTIVE'),
    scraping_enabled  = (p_new_state = 'ACTIVE'),
    status = v_status,
    -- Listed explicitly so AFTER UPDATE OF deleted_at triggers (notification
    -- dismissal, alert supersede, deletion ledger) fire in this transaction.
    deleted_at  = CASE WHEN p_new_state = 'DELETED' THEN v_now ELSE NULL END,
    purge_after = CASE WHEN p_new_state = 'DELETED' THEN v_purge ELSE NULL END,
    updated_at = v_now
  WHERE id = p_work_item_id;

  v_actor_user := COALESCE(p_actor_user, v_row.owner_id);
  v_change_source := 'LIFECYCLE_' || p_new_state::text;

  IF v_row.organization_id IS NOT NULL AND v_actor_user IS NOT NULL THEN
    INSERT INTO public.work_item_stage_audit (
      work_item_id, organization_id, actor_user_id, previous_stage, new_stage,
      change_source, reason, metadata
    ) VALUES (
      p_work_item_id, v_row.organization_id, v_actor_user, v_prev::text, p_new_state::text,
      v_change_source, p_reason,
      jsonb_build_object('prev_state', v_prev, 'new_state', p_new_state,
                         'actor', COALESCE(p_actor, 'SYSTEM')) || COALESCE(p_metadata, '{}'::jsonb)
    );
  END IF;

  v_wf := COALESCE(NULLIF(v_row.workflow_type::text, ''), 'INDETERMINADO');

  v_rad23 := NULLIF(regexp_replace(COALESCE(v_row.radicado_digits, v_row.radicado, ''), '\D', '', 'g'), '');
  IF v_rad23 IS NOT NULL AND v_rad23 !~ '^\d{23}$' THEN
    v_rad23 := NULL;
  END IF;

  INSERT INTO public.gcp_lifecycle_outbox (
    work_item_id, radicado, workflow_type, prev_state, new_state,
    reason, actor, actor_user_id, metadata, occurred_at
  ) VALUES (
    p_work_item_id, v_rad23, v_wf, v_prev, p_new_state,
    p_reason, COALESCE(p_actor, 'SYSTEM'), p_actor_user, COALESCE(p_metadata, '{}'::jsonb), v_now
  ) RETURNING id INTO v_outbox_id;

  -- Bind the ledger row written by trg_record_lifecycle_transition in THIS
  -- statement to the event just inserted (the trigger runs before it exists).
  UPDATE public.work_item_lifecycle_ledger
     SET gcp_outbox_id = v_outbox_id, emitted_to_gcp = true
   WHERE work_item_id = p_work_item_id
     AND to_state = p_new_state::text
     AND occurred_at = v_now
     AND gcp_outbox_id IS NULL;
  GET DIAGNOSTICS v_ledger_n = ROW_COUNT;
  IF v_ledger_n <> 1 THEN
    RAISE EXCEPTION 'lifecycle ledger binding failed (% rows)', v_ledger_n;
  END IF;

  -- Sibling fanout only for trusted maintenance and only within the same owner;
  -- user/agent deletions never emit DELETED for other records.
  IF p_new_state = 'DELETED' AND v_rad23 IS NOT NULL AND v_trusted THEN
    v_base := left(v_rad23, 21);

    FOR v_sib IN
      SELECT w.id,
             regexp_replace(COALESCE(w.radicado_digits, w.radicado, ''), '\D', '', 'g') AS rad,
             COALESCE(NULLIF(w.workflow_type::text, ''), 'INDETERMINADO') AS wf
        FROM public.work_items w
       WHERE w.id <> p_work_item_id
         AND w.deleted_at IS NULL
         AND w.owner_id = v_row.owner_id
         AND left(regexp_replace(COALESCE(w.radicado_digits, w.radicado, ''), '\D', '', 'g'), 21) = v_base
    LOOP
      CONTINUE WHEN v_sib.rad !~ '^\d{23}$';
      CONTINUE WHEN v_sib.rad = ANY (v_emitted);

      INSERT INTO public.gcp_lifecycle_outbox (
        work_item_id, radicado, workflow_type, prev_state, new_state,
        reason, actor, actor_user_id, metadata, occurred_at
      ) VALUES (
        v_sib.id, v_sib.rad, v_sib.wf, NULL, 'DELETED',
        COALESCE(p_reason, 'ELIMINACION_BASE'), COALESCE(p_actor, 'SYSTEM'), p_actor_user,
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
          'scope', 'INSTANCIA_HERMANA',
          'radicado_base_21', v_base,
          'origin_radicado', v_rad23
        ),
        v_now + (v_offset * interval '1 second')
      );
      v_emitted := v_emitted || v_sib.rad;
      v_offset := v_offset + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'prev_state', v_prev, 'new_state', p_new_state,
                            'work_item_id', p_work_item_id, 'gcp_outbox_id', v_outbox_id,
                            'purge_after', v_purge);
END;
$function$;
CREATE TRIGGER enforce_monitoring_limit_trigger BEFORE UPDATE ON work_items FOR EACH ROW EXECUTE FUNCTION enforce_monitoring_limit();
CREATE TRIGGER trg_apply_monitoring_invariant BEFORE INSERT OR UPDATE ON work_items FOR EACH ROW EXECUTE FUNCTION apply_monitoring_invariant();
CREATE TRIGGER trg_sync_enrollment_after_work_item AFTER INSERT OR UPDATE OF workflow_type,radicado,monitoring_enabled,lifecycle_state ON work_items FOR EACH ROW EXECUTE FUNCTION sync_enrollment_after_work_item();
CREATE INDEX IF NOT EXISTS notifications_created_id_cursor_idx ON public.notifications (created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.mcp_list_notifications(p_limit integer DEFAULT 30, p_include_dismissed boolean DEFAULT false, p_cursor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE v_uid uuid := auth.uid(); v_lim int := LEAST(GREATEST(COALESCE(p_limit,30),1),100);
 v_c jsonb; v_ts timestamptz; v_id uuid; v_rows jsonb; v_count int; v_last jsonb;
BEGIN
 IF v_uid IS NULL OR public.mcp_access_level() NOT IN ('read','manage','first_party') THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
 IF p_cursor IS NOT NULL THEN
  BEGIN
   v_c := convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;
   v_ts := (v_c->>'t')::timestamptz; v_id := (v_c->>'id')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'CURSOR_INVALID' USING ERRCODE='MCP22'; END;
  IF v_ts IS NULL OR v_id IS NULL OR v_c->>'v' IS DISTINCT FROM '1' OR v_c->>'u' IS DISTINCT FROM v_uid::text OR (v_c->>'d')::boolean IS DISTINCT FROM COALESCE(p_include_dismissed,false) THEN
   RAISE EXCEPTION 'CURSOR_INVALID: user or filter mismatch' USING ERRCODE='MCP22'; END IF;
 END IF;
 -- Invoker RLS and the explicit user join isolate shared notification state.
 -- Any state relation/query failure propagates; never substitute an empty state.
 WITH page AS (
  SELECT n.id,n.title,n.created_at,n.work_item_id,n.category,n.severity,s.read_at,s.dismissed_at,s.snoozed_until
  FROM public.notifications n LEFT JOIN public.notification_user_state s ON s.notification_id=n.id AND s.user_id=v_uid
  WHERE (COALESCE(p_include_dismissed,false) OR s.dismissed_at IS NULL)
   AND (v_ts IS NULL OR (n.created_at,n.id)<(v_ts,v_id))
  ORDER BY n.created_at DESC,n.id DESC LIMIT v_lim+1
 ) SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC),'[]'::jsonb),count(*) INTO v_rows,v_count FROM page;
 IF v_count>v_lim THEN v_rows:=v_rows-v_lim; END IF;
 v_last:=v_rows->(jsonb_array_length(v_rows)-1);
 RETURN jsonb_build_object('notifications',v_rows,'has_more',v_count>v_lim,'next_cursor',CASE WHEN v_count>v_lim THEN
 replace(encode(convert_to(jsonb_build_object('v',1,'u',v_uid,'d',COALESCE(p_include_dismissed,false),'t',v_last->>'created_at','id',v_last->>'id')::text,'UTF8'),'base64'),E'\n','') END);
END $fn$;
REVOKE ALL ON FUNCTION public.mcp_list_notifications(integer,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_list_notifications(integer,boolean,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.mcp_assign_work_item_radicado(p_work_item_id uuid,p_radicado text,p_expected_updated_at timestamptz,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_prior jsonb; v_w public.work_items%ROWTYPE; v_dup record; v_digits text;
 v_before jsonb; v_after jsonb; v_lifecycle jsonb; v_max int; v_n int; v_monitor boolean;
BEGIN
 v_prior:=public._mcp_begin('assign_work_item_radicado',p_idempotency_key,jsonb_build_object('id',p_work_item_id,'radicado',p_radicado,'expected_updated_at',p_expected_updated_at));
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 IF p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'expected_updated_at es obligatorio' USING ERRCODE='MCP22'; END IF;
 v_digits:=regexp_replace(COALESCE(p_radicado,''),'[^0-9]','','g');
 IF length(v_digits)<>23 THEN RAISE EXCEPTION 'el radicado debe tener exactamente 23 dígitos' USING ERRCODE='MCP22'; END IF;
 -- Serializes owner identity allocation; the existing unique index is the final race barrier.
 PERFORM pg_advisory_xact_lock(hashtextextended('mcp-radicado:'||auth.uid()::text,0));
 SELECT * INTO v_w FROM public.work_items WHERE id=p_work_item_id FOR UPDATE;
 IF NOT FOUND OR NOT public._mcp_can_manage_work_item(v_w.owner_id,v_w.organization_id) THEN RAISE EXCEPTION 'NOT_FOUND: asunto no encontrado' USING ERRCODE='MCP04'; END IF;
 IF v_w.lifecycle_state IS DISTINCT FROM 'ACTIVE'::public.work_item_lifecycle_state OR v_w.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION 'ACTIVE_REQUIRED: no se reactiva un asunto archivado o eliminado' USING ERRCODE='MCP09'; END IF;
 IF NULLIF(btrim(COALESCE(v_w.radicado,'')),'') IS NOT NULL THEN RAISE EXCEPTION 'RADICADO_ALREADY_SET: no se reemplaza la identidad existente' USING ERRCODE='MCP09'; END IF;
 IF v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'STALE_REVISION: el asunto cambió' USING ERRCODE='MCP09'; END IF;
 SELECT id,deleted_at INTO v_dup FROM public.work_items WHERE owner_id=v_w.owner_id AND workflow_type=v_w.workflow_type AND id<>v_w.id
  AND (radicado=v_digits OR regexp_replace(COALESCE(radicado_digits,radicado,''),'[^0-9]','','g')=v_digits) LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION '%: ya existe este radicado en la cartera, incluida la papelera',CASE WHEN v_dup.deleted_at IS NOT NULL THEN 'DUPLICATE_IN_TRASH' ELSE 'DUPLICATE' END USING ERRCODE='MCP09'; END IF;
 v_monitor:=public.is_provider_monitored_workflow(v_w.workflow_type::text) AND NOT (
  COALESCE(v_w.monitoring_disabled_by,'')='USER' AND COALESCE(btrim(v_w.monitoring_disabled_reason),'')<>'' AND v_w.monitoring_disabled_reason<>'PENDIENTE_DE_RADICACION');
 -- The existing BEFORE limit trigger runs before the invariant by name. Check the prospective
 -- value explicitly under an org lock rather than relying on that trigger seeing the new flag.
 IF v_monitor AND NOT COALESCE(v_w.monitoring_enabled,false) AND v_w.organization_id IS NOT NULL THEN
  PERFORM 1 FROM public.organizations WHERE id=v_w.organization_id FOR UPDATE;
  v_max:=(public.get_effective_limits(v_w.organization_id)->>'max_monitored_items')::int;
  SELECT count(*) INTO v_n FROM public.work_items WHERE organization_id=v_w.organization_id AND monitoring_enabled AND deleted_at IS NULL AND id<>v_w.id;
  IF v_max IS NOT NULL AND v_n>=v_max THEN RAISE EXCEPTION 'Monitoring limit reached: maximum % monitored items for your plan.',v_max USING ERRCODE='P0429'; END IF;
 END IF;
 v_before:=public._mcp_wi_snapshot(v_w.id)||jsonb_build_object('radicado_verified',v_w.radicado_verified,'scrape_status',v_w.scrape_status);
 UPDATE public.work_items SET radicado=v_digits,radicado_verified=false,scrape_status='NOT_ATTEMPTED',consecutive_404_count=0,provider_reachable=true,
  -- This sentinel means missing identity, not a deliberate suspension; preserve all other reasons.
  monitoring_disabled_reason=CASE WHEN monitoring_disabled_reason='PENDIENTE_DE_RADICACION' THEN NULL ELSE monitoring_disabled_reason END,
  monitoring_disabled_by=CASE WHEN monitoring_disabled_reason='PENDIENTE_DE_RADICACION' THEN NULL ELSE monitoring_disabled_by END,
  monitoring_disabled_at=CASE WHEN monitoring_disabled_reason='PENDIENTE_DE_RADICACION' THEN NULL ELSE monitoring_disabled_at END,
  updated_at=clock_timestamp() WHERE id=v_w.id;
 GET DIAGNOSTICS v_n=ROW_COUNT;
 IF v_n<>1 THEN RAISE EXCEPTION 'NOT_FOUND: no se guardó el radicado' USING ERRCODE='MCP04'; END IF;
 -- Same canonical ACTIVE call as AddRadicadoInline, after requiring ACTIVE: always a no-op,
 -- never a restoration or lifecycle/history change. Enrollment is owned by existing triggers.
 v_lifecycle:=public.set_work_item_lifecycle(v_w.id,'ACTIVE','RADICADO_SET','USER',auth.uid(),'{}');
 IF (v_lifecycle->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'LIFECYCLE_FAILED' USING ERRCODE='MCP09'; END IF;
 v_after:=public._mcp_wi_snapshot(v_w.id)||(SELECT jsonb_build_object('radicado_verified',radicado_verified,'scrape_status',scrape_status,'consecutive_404_count',consecutive_404_count,'provider_reachable',provider_reachable) FROM public.work_items WHERE id=v_w.id);
 IF v_after->>'radicado' IS DISTINCT FROM v_digits THEN RAISE EXCEPTION 'READBACK_FAILED' USING ERRCODE='MCP09'; END IF;
 RETURN public._mcp_finish('assign_work_item_radicado',p_idempotency_key,jsonb_build_object('ok',true,'work_item',v_after,'synchronization','scheduled_pending','synced',false,
  'note','Radicado guardado; sincronización programada pendiente. No se consultó ningún proveedor.'),'work_item',v_w.id,v_before,v_after);
END $fn$;
REVOKE ALL ON FUNCTION public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text) TO service_role;
COMMENT ON FUNCTION public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text) IS 'Review gated. Assign once to owned ACTIVE empty matter only; no providers, restore, stage/workflow replacement or purge. Tests grant EXECUTE transaction-locally.';
GRANT USAGE ON SCHEMA public TO authenticated,anon,service_role;
