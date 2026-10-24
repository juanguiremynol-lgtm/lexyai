-- Standalone synthetic fixture. Auth tables, owner RLS and provider enrollment are local only.

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
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),max_monitored_items integer);
CREATE TYPE public.workflow_type AS ENUM ('CGP','CPACA','LABORAL','PENAL_906','TUTELA','PETICION','GOV_PROCEDURE','EJECUTIVO','INDETERMINADO');
CREATE TYPE public.cgp_phase AS ENUM ('FILING','PROCESS');
CREATE TYPE public.cgp_phase_source AS ENUM ('AUTO','MANUAL');
CREATE TABLE public.work_items("id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,"owner_id" uuid,"client_id" uuid,"matter_id" uuid,"workflow_type" public.workflow_type,"stage" text,"status" text,"cgp_phase" public.cgp_phase,"cgp_phase_source" public.cgp_phase_source,"source" text,"source_reference" text,"source_payload" jsonb,"radicado" text,"radicado_verified" bool,"authority_name" text,"authority_email" text,"authority_city" text,"authority_department" text,"demandantes" text,"demandados" text,"title" text,"description" text,"notes" text,"auto_admisorio_date" timestamptz,"filing_date" timestamptz,"last_action_date" timestamptz,"last_action_description" text,"is_flagged" bool,"monitoring_enabled" bool DEFAULT false,"email_linking_enabled" bool,"expediente_url" text,"sharepoint_url" text,"scrape_status" text,"last_checked_at" timestamptz,"last_crawled_at" timestamptz,"scraped_fields" jsonb,"total_actuaciones" int4,"legacy_cgp_item_id" uuid,"legacy_peticion_id" uuid,"legacy_cpaca_id" uuid,"legacy_admin_process_id" uuid,"created_at" timestamptz DEFAULT now(),"updated_at" timestamptz DEFAULT now(),"cgp_class" text,"cgp_variant" text,"cgp_cuantia" text,"cgp_instancia" text,"notification_substatus" text,"notification_effective_date" timestamptz,"migration_note" text,"deleted_at" timestamptz,"deleted_by" uuid,"delete_reason" text,"acta_reparto_received_at" timestamptz,"acta_reparto_notes" text,"organization_id" uuid,"pipeline_stage" int4,"last_event_at" timestamptz,"last_event_summary" text,"last_phase_change_at" timestamptz,"last_scrape_at" timestamptz,"scraping_enabled" bool,"source_platform" text,"tutela_code" text,"last_scrape_initiated_at" timestamptz,"scrape_job_id" text,"scrape_poll_url" text,"scrape_provider" text,"ponente" text,"origen" text,"clase_proceso" text,"etapa" text,"ubicacion_expediente" text,"formato_expediente" text,"tipo_proceso" text,"subclase_proceso" text,"tipo_recurso" text,"naturaleza_proceso" text,"asunto" text,"medida_cautelar" text,"ministerio_publico" text,"fecha_radicado" date,"fecha_presenta_demanda" date,"fecha_para_sentencia" date,"fecha_sentencia" text,"total_sujetos_procesales" int4,"samai_guid" text,"samai_consultado_en" timestamptz,"samai_veces_en_corporacion" int4,"samai_sala_conoce" text,"samai_sala_decide" text,"samai_fuente" text,"last_synced_at" timestamptz,"latest_estado_fingerprint" text,"latest_estado_at" timestamptz,"stage_inference_enabled" bool,"last_inference_date" date,"last_stage_change_source" text,"last_stage_change_at" timestamptz,"last_stage_change_by_user_id" uuid,"last_stage_suggestion_id" uuid,"acta_radicacion_url" text,"auto_admisorio_url" text,"onedrive_url" text,"corte_status" text,"sentencia_ref" text,"provider_sources" jsonb,"consecutive_404_count" int4,"demonitor_reason" text,"demonitor_at" timestamptz,"atenia_health_score" numeric,"last_stage_suggestion_at" timestamptz,"provider_reachable" bool,"radicado_raw" text,"milestones_cleared_at" timestamptz,"milestones_cleared_status" text,"raw_courthouse_input" jsonb,"courthouse_directory_id" int8,"resolved_email" text,"resolution_method" text,"resolution_confidence" numeric,"courthouse_needs_review" bool,"resolved_at" timestamptz,"resolution_candidates" jsonb,"radicado_blocks" jsonb,"radicado_valid" bool,"consecutive_failures" int4,"last_error_code" text,"last_error_at" timestamptz,"monitoring_disabled_reason" text,"monitoring_disabled_by" text,"monitoring_disabled_at" timestamptz,"monitoring_disabled_meta" jsonb,"consecutive_not_found" int4,"last_successful_sync_at" timestamptz,"last_attempted_sync_at" timestamptz,"last_error_meta" jsonb,"monitoring_suspended_at" timestamptz,"monitoring_suspended_reason" text,"purge_after" timestamptz,"courthouse_email_suggested" text,"courthouse_email_confirmed" text,"courthouse_email_status" text,"courthouse_email_confidence" int4,"courthouse_email_source" text,"courthouse_email_evidence" jsonb,"courthouse_email_suggested_at" timestamptz,"courthouse_email_confirmed_at" timestamptz,"freshness_tier" text,"freshness_sla_hours" int4,"last_sync_attempt_at" timestamptz,"sync_failure_streak" int4,"freshness_violation_at" timestamptz,"freshness_violation_notified" bool,"ghost_candidate_at" timestamptz,"ghost_verification_status" text,"ghost_verification_run_id" uuid,"monitoring_mode" text,"ghost_bootstrap_attempts" int4,"service_object" text,"acts_initial_sync_completed_at" timestamptz,"pubs_initial_sync_completed_at" timestamptz,"last_cpnu_buscar_at" timestamptz,"needs_cpnu_refresh" bool,"pp_id" int4,"pp_ultima_sync" timestamptz,"pp_estado" text,"pp_novedades_pendientes" int4,"lifecycle_state" work_item_lifecycle_state DEFAULT 'ACTIVE',"lifecycle_reason" text,"lifecycle_changed_at" timestamptz,"lifecycle_changed_by" uuid,"lifecycle_actor" text,"lifecycle_actor_user" uuid,"radicado_digits" text,"despacho_competencia" text,"despacho_competencia_subjects" text[],"workflow_type_source" text,"clase_proveedor" jsonb,"clase_proceso_disponible" bool,"clase_proceso_motivo_ausencia" text,"clase_proceso_procedencia" jsonb,"clase_proceso_observed_at" timestamptz,"clase_proceso_last_read_case" text,"clase_proceso_last_attempt_at" timestamptz,"provider_detail_exposure" text,"provider_detail_reason" text,"provider_detail_observed_at" timestamptz,"provider_detail_desde" timestamptz,"provider_detail_ultima_verificacion" timestamptz,"provider_detail_ttl_days" int4,"client_party_role" text,"client_party_role_source" text,"client_party_role_confidence" numeric,"client_party_role_basis" text,"client_party_role_confirmed_at" timestamptz,"client_party_role_confirmed_by" uuid,"client_party_represents" text,"client_party_role_overridden" bool,"client_party_role_proposed" text,"client_party_role_override_confidence" numeric,"closure_reason" text,"closure_note" text,"closure_at" timestamptz,"title_source" text,"authority_id" uuid,"notification_override" text);

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
  id uuid,
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
  id uuid,
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

CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aud text,role text,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz);
ALTER TABLE auth.oauth_clients ADD registration_type text,ADD redirect_uris text,ADD grant_types text,ADD client_name text,ADD token_endpoint_auth_method text;
ALTER TABLE auth.oauth_consents ADD scopes text;
ALTER TABLE organizations ADD name text;
ALTER TABLE organizations ALTER max_monitored_items SET DEFAULT 100;
CREATE TABLE profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid);
CREATE TABLE organization_memberships(organization_id uuid,user_id uuid,role text);
CREATE TABLE platform_admins(user_id uuid PRIMARY KEY);
CREATE TABLE clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid,deleted_at timestamptz);
CREATE TABLE workflow_definitions(workflow_type text,active boolean,catalog_governed boolean);
CREATE TABLE workflow_stages_global(workflow_type text,code text,active boolean,display_order int);
CREATE TABLE lifecycle_pause_refusals(work_item_id uuid,attempted_state text,actor text,reason text,metadata jsonb);
CREATE TABLE work_item_stage_audit(work_item_id uuid,organization_id uuid,actor_user_id uuid,previous_stage text,new_stage text,change_source text,reason text,metadata jsonb);
CREATE TABLE gcp_lifecycle_outbox(id uuid,work_item_id uuid,radicado text,workflow_type text,prev_state text,new_state text,reason text,actor text,actor_user_id uuid,metadata jsonb,occurred_at timestamptz);
CREATE TABLE work_item_lifecycle_ledger(work_item_id uuid,radicado text,workflow_type text,from_state text,to_state text,actor text,actor_user_id uuid,reason text,occurred_at timestamptz,record_origin text,emitted_to_gcp boolean,gcp_outbox_id uuid,metadata jsonb);
CREATE TYPE reminder_type AS ENUM ('ACTA_REPARTO_PENDING','RADICADO_PENDING','EXPEDIENTE_PENDING','AUTO_ADMISORIO_PENDING');
CREATE TABLE work_item_reminders(organization_id uuid,owner_id uuid,work_item_id uuid,reminder_type reminder_type,cadence_business_days int,next_run_at timestamptz,status text,created_by uuid);
CREATE TABLE sync_retry_queue(work_item_id uuid,organization_id uuid,radicado text,stage text,kind text,provider text,attempt int,max_attempts int,next_run_at timestamptz,last_error_code text,last_error_message text,UNIQUE(work_item_id,kind));
CREATE FUNCTION add_business_days_sql(date,int) RETURNS date LANGUAGE sql AS $$ SELECT $1+$2 $$;
-- Calendar helper is unexercised: no-radicado acceptance cannot enqueue provider work.
ALTER TABLE mcp_client_grants ADD id uuid DEFAULT gen_random_uuid(),ADD granted_at timestamptz DEFAULT now(),ADD granted_session_id uuid,ADD revoked_reason text;
CREATE UNIQUE INDEX mcp_client_grants_one_active ON mcp_client_grants(user_id,oauth_client_id) WHERE revoked_at IS NULL;
CREATE FUNCTION fixture_touch_work_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER zz_fixture_touch BEFORE UPDATE ON work_items FOR EACH ROW EXECUTE FUNCTION fixture_touch_work_item();
CREATE POLICY mcp_manage_gate_upd ON work_items AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.mcp_write_allowed()) WITH CHECK(public.mcp_write_allowed());
GRANT SELECT ON profiles,organization_memberships,platform_admins TO authenticated;
-- An explicit fixture models visibility only; actual owner auth/action bodies below are unchanged.
CREATE OR REPLACE FUNCTION public._mcp_is_catalog_governed(p_wf text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT COALESCE(bool_or(catalog_governed), false) FROM public.workflow_definitions WHERE workflow_type = p_wf AND active $function$
;
CREATE OR REPLACE FUNCTION public._mcp_is_trusted_backend()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_role text; v_api_role text;
BEGIN
  v_role := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                     (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'));
  IF v_role IS NOT NULL THEN RETURN v_role = 'service_role'; END IF;
  -- No JWT: the SET ROLE value (unaffected by SECURITY DEFINER) must not be an API role.
  v_api_role := COALESCE(NULLIF(current_setting('role', true), ''), 'none');
  IF v_api_role IN ('authenticated', 'anon') THEN RETURN false; END IF;
  RETURN session_user::text IN ('postgres', 'supabase_admin', 'service_role');
END $function$
;
CREATE OR REPLACE FUNCTION public._mcp_require_first_party()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb := public.mcp_caller_context();
BEGIN
  IF NOT (c->>'authenticated')::boolean THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF c->>'surface' <> 'first_party' THEN
    RAISE EXCEPTION 'MCP_FIRST_PARTY_REQUIRED: los permisos de IA solo se cambian desde una sesión propia de Andromeda'
      USING ERRCODE = 'MCP01';
  END IF;
  RETURN c;
END $function$
;
CREATE OR REPLACE FUNCTION public._mcp_stage_vocab()
 RETURNS TABLE(workflow_type text, code text, ord integer, phase text, target_allowed boolean)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM (VALUES
    ('CGP','PREPARACION',1,'FILING',true),
    ('CGP','RADICADO',2,'FILING',true),
    ('CGP','SUBSANACION',3,'FILING',true),
    ('CGP','ADMISION',4,'PROCESS',true),
    ('CGP','CUADERNO',5,'PROCESS',true),
    ('CGP','NOTIFICACION',6,'PROCESS',true),
    ('CGP','CONTESTACION',7,'PROCESS',true),
    ('CGP','SANEAMIENTO',8,'PROCESS',true),
    ('CGP','AUDIENCIA_INICIAL',9,'PROCESS',true),
    ('CGP','INTERVENCION',10,'PROCESS',true),
    ('CGP','SENTENCIA',11,'PROCESS',true),
    ('CGP','RECURSO',12,'PROCESS',true),
    ('CGP','DRAFTED',NULL,'FILING',false),
    ('CGP','SENT_TO_REPARTO',NULL,'FILING',false),
    ('CGP','ACTA_PENDING',NULL,'FILING',false),
    ('CGP','ACTA_RECEIVED',NULL,'FILING',false),
    ('CGP','RADICADO_PENDING',NULL,'FILING',false),
    ('CGP','RADICADO_CONFIRMED',NULL,'FILING',false),
    ('CGP','PENDING_AUTO_ADMISORIO',NULL,'FILING',false),
    ('CGP','AUTO_ADMISORIO',NULL,'PROCESS',false),
    ('CGP','NOTIFICACION_PERSONAL',NULL,'PROCESS',false),
    ('CGP','NOTIFICACION_AVISO',NULL,'PROCESS',false),
    ('CGP','EXCEPCIONES_PREVIAS',NULL,'PROCESS',false),
    ('CGP','PRONUNCIARSE_EXCEPCIONES',NULL,'PROCESS',false),
    ('CGP','AUDIENCIA_INSTRUCCION',NULL,'PROCESS',false),
    ('CGP','ALEGATOS_SENTENCIA',NULL,'PROCESS',false),
    ('CGP','APELACION',NULL,'PROCESS',false),
    ('CPACA','PRECONTENCIOSO',1,NULL,true),
    ('CPACA','DEMANDA_POR_RADICAR',2,NULL,true),
    ('CPACA','DEMANDA_RADICADA',3,NULL,true),
    ('CPACA','AUTO_ADMISORIO',4,NULL,true),
    ('CPACA','TRASLADO_DEMANDA',5,NULL,true),
    ('CPACA','TRASLADO_EXCEPCIONES',6,NULL,true),
    ('CPACA','AUDIENCIA_INICIAL',7,NULL,true),
    ('CPACA','AUDIENCIA_PRUEBAS',8,NULL,true),
    ('CPACA','ALEGATOS_SENTENCIA',9,NULL,true),
    ('CPACA','RECURSOS',10,NULL,true),
    ('CPACA','EJECUCION_CUMPLIMIENTO',11,NULL,true),
    ('TUTELA','TUTELA_RADICADA',1,NULL,true),
    ('TUTELA','TUTELA_ADMITIDA',2,NULL,true),
    ('TUTELA','FALLO_PRIMERA_INSTANCIA',3,NULL,true),
    ('TUTELA','FALLO_SEGUNDA_INSTANCIA',4,NULL,true),
    ('TUTELA','ARCHIVADO',5,NULL,true),
    ('EJECUTIVO','PREPARACION',1,NULL,true),
    ('EJECUTIVO','RADICACION',2,NULL,true),
    ('EJECUTIVO','SUBSANACION',3,NULL,true),
    ('EJECUTIVO','MANDAMIENTO_PAGO',4,NULL,true),
    ('EJECUTIVO','NOTIFICACION_MANDAMIENTO',5,NULL,true),
    ('EJECUTIVO','EXCEPCIONES_MERITO',6,NULL,true),
    ('EJECUTIVO','TRASLADO_EXCEPCIONES',7,NULL,true),
    ('EJECUTIVO','SEGUIR_ADELANTE',8,NULL,true),
    ('EJECUTIVO','LIQUIDACION_CREDITO',9,NULL,true),
    ('EJECUTIVO','AVALUO_REMATE',10,NULL,true),
    ('EJECUTIVO','TERMINACION_PAGO',11,NULL,true),
    ('EJECUTIVO','DESISTIMIENTO',12,NULL,true),
    ('LABORAL','BORRADOR',1,NULL,true),
    ('LABORAL','RADICACION',2,NULL,true),
    ('LABORAL','REPARTO',3,NULL,true),
    ('LABORAL','ADMISION_PENDIENTE',4,NULL,true),
    ('LABORAL','AUDIENCIA_INICIAL',5,NULL,true),
    ('LABORAL','AUDIENCIA_JUZGAMIENTO',6,NULL,true),
    ('LABORAL','SENTENCIA_1A_INSTANCIA',7,NULL,true),
    ('LABORAL','APELACION',8,NULL,true),
    ('LABORAL','EJECUCION',9,NULL,true),
    ('LABORAL','ARCHIVADO',10,NULL,true),
    ('PENAL_906','INDAGACION',1,NULL,true),
    ('PENAL_906','IMPUTACION',2,NULL,true),
    ('PENAL_906','MEDIDA_ASEGURAMIENTO',3,NULL,true),
    ('PENAL_906','ESCRITO_ACUSACION',4,NULL,true),
    ('PENAL_906','AUDIENCIA_ACUSACION',5,NULL,true),
    ('PENAL_906','PREPARATORIA',6,NULL,true),
    ('PENAL_906','JUICIO_ORAL',7,NULL,true),
    ('PENAL_906','SENTENCIA',8,NULL,true),
    ('PENAL_906','RECURSOS',9,NULL,true),
    ('PENAL_906','PRECLUSION',10,NULL,true),
    ('PENAL_906','ARCHIVO',11,NULL,true)
  ) v(workflow_type, code, ord, phase, target_allowed)
$function$
;
CREATE OR REPLACE FUNCTION public.grant_mcp_client_access(p_oauth_client_id uuid, p_access_level text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  c jsonb := public._mcp_require_first_party();
  v_uid uuid := auth.uid();
  v_consent record;
  v_id uuid;
BEGIN
  IF p_access_level NOT IN ('read', 'manage') THEN
    RAISE EXCEPTION 'invalid access level' USING ERRCODE = 'MCP22';
  END IF;
  PERFORM 1 FROM auth.oauth_clients WHERE id = p_oauth_client_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'OAuth client not found' USING ERRCODE = 'MCP04'; END IF;
  SELECT id, granted_at INTO v_consent FROM auth.oauth_consents
   WHERE user_id = v_uid AND client_id = p_oauth_client_id AND revoked_at IS NULL
   ORDER BY granted_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active authorization for this client' USING ERRCODE = 'MCP04';
  END IF;
  UPDATE public.mcp_client_grants SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE user_id = v_uid AND oauth_client_id = p_oauth_client_id AND revoked_at IS NULL;
  INSERT INTO public.mcp_client_grants (user_id, oauth_client_id, consent_id, consent_granted_at,
                                        access_level, granted_session_id)
  VALUES (v_uid, p_oauth_client_id, v_consent.id, v_consent.granted_at, p_access_level,
          (c->>'session_id')::uuid)
  RETURNING id INTO v_id;
  INSERT INTO public.mcp_action_audit (user_id, oauth_client_id, session_id, action, target_type, target_id, after)
  VALUES (v_uid, NULL, (c->>'session_id')::uuid, 'grant_mcp_client_access', 'oauth_client', p_oauth_client_id,
          jsonb_build_object('access_level', p_access_level, 'grant_id', v_id));
  RETURN jsonb_build_object('ok', true, 'grant_id', v_id, 'access_level', p_access_level);
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_create_work_item(p_workflow_type text, p_stage text, p_radicado text, p_title text, p_client_id uuid, p_demandantes text, p_demandados text, p_authority_name text, p_monitoring_off_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_digits text; v_dup record; v_id uuid; v_after jsonb; v_stage text; v_phase text;
  v_reason text := NULLIF(btrim(COALESCE(p_monitoring_off_reason, '')), ''); v_w public.work_items%ROWTYPE;
  v_next timestamptz; v_rem text[] := ARRAY[]::text[]; v_sync text[] := ARRAY[]::text[];
BEGIN
  v_prior := public._mcp_begin('create_work_item', p_idempotency_key, jsonb_build_object('wf', p_workflow_type,
    'st', p_stage, 'rad', p_radicado, 't', p_title, 'c', p_client_id, 'dte', p_demandantes, 'ddo', p_demandados,
    'a', p_authority_name, 'mor', p_monitoring_off_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'workflow_type' AND e.enumlabel = p_workflow_type) THEN
    RAISE EXCEPTION 'workflow_type inválido' USING ERRCODE = 'MCP22'; END IF;
  IF public._mcp_is_catalog_governed(p_workflow_type) THEN
    IF p_stage IS NOT NULL THEN
      SELECT s.code INTO v_stage FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active AND s.code = p_stage;
      IF v_stage IS NULL AND p_stage IN ('PETICION_RADICADA', 'INICIO_APERTURA') THEN p_stage := NULL; END IF;
    END IF;
    IF p_stage IS NULL THEN
      SELECT s.code INTO v_stage FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active ORDER BY s.display_order LIMIT 1;
    END IF;
  ELSE
    SELECT v.code, v.phase INTO v_stage, v_phase FROM public._mcp_stage_vocab() v
     WHERE v.workflow_type = p_workflow_type AND (v.code = p_stage OR (p_stage IS NULL AND v.ord IS NOT NULL))
     ORDER BY v.ord NULLS LAST LIMIT 1;
  END IF;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa inicial válida de % (consulta list_workflow_stages)', p_stage, p_workflow_type USING ERRCODE = 'MCP22'; END IF;
  v_digits := NULLIF(regexp_replace(COALESCE(p_radicado, ''), '[^0-9]', '', 'g'), '');
  IF v_digits IS NOT NULL AND length(v_digits) <> 23 THEN
    RAISE EXCEPTION 'el radicado debe tener 23 dígitos' USING ERRCODE = 'MCP22'; END IF;
  IF v_digits IS NOT NULL THEN
    SELECT id, lifecycle_state, deleted_at, purge_after INTO v_dup FROM public.work_items
     WHERE owner_id = auth.uid() AND workflow_type::text = p_workflow_type
       AND (radicado = v_digits OR regexp_replace(COALESCE(radicado_digits, radicado, ''), '[^0-9]', '', 'g') = v_digits)
     ORDER BY deleted_at NULLS FIRST LIMIT 1;
    IF FOUND THEN
      IF v_dup.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'DUPLICATE_IN_TRASH: el asunto % con este radicado está en la papelera hasta %; restáuralo en lugar de crearlo', v_dup.id, v_dup.purge_after USING ERRCODE = 'MCP09';
      END IF;
      RAISE EXCEPTION 'DUPLICATE: ya tienes este radicado en % (asunto %, estado %)', p_workflow_type, v_dup.id, v_dup.lifecycle_state USING ERRCODE = 'MCP09';
    END IF;
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients
       WHERE id = p_client_id AND owner_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND: cliente no encontrado' USING ERRCODE = 'MCP04'; END IF;
  INSERT INTO public.work_items (owner_id, workflow_type, stage, source, title, radicado, radicado_raw,
    radicado_verified, authority_name, demandantes, demandados, client_id, cgp_phase, cgp_phase_source,
    is_flagged, monitoring_enabled, monitoring_disabled_reason, monitoring_disabled_by, monitoring_disabled_at,
    email_linking_enabled)
  VALUES (auth.uid(), p_workflow_type::public.workflow_type, v_stage, 'MANUAL', NULLIF(p_title, ''),
    v_digits, NULLIF(p_radicado, ''), false, NULLIF(p_authority_name, ''), NULLIF(p_demandantes, ''),
    NULLIF(p_demandados, ''), p_client_id,
    CASE WHEN p_workflow_type = 'CGP' THEN COALESCE(v_phase, 'FILING')::public.cgp_phase END,
    CASE WHEN p_workflow_type = 'CGP' THEN 'MANUAL'::public.cgp_phase_source END,
    false, v_reason IS NULL, v_reason,
    CASE WHEN v_reason IS NOT NULL THEN 'USER' END, CASE WHEN v_reason IS NOT NULL THEN now() END, true)
  RETURNING id INTO v_id;
  SELECT * INTO v_w FROM public.work_items WHERE id = v_id;

  IF p_workflow_type IN ('CGP', 'CPACA', 'TUTELA', 'LABORAL') AND v_w.organization_id IS NOT NULL THEN
    IF v_w.authority_name IS NULL THEN v_rem := v_rem || 'ACTA_REPARTO_PENDING'::text; END IF;
    IF v_digits IS NULL OR right(v_digits, 2) NOT IN ('00', '01') THEN v_rem := v_rem || 'RADICADO_PENDING'::text; END IF;
    v_rem := v_rem || ARRAY['EXPEDIENTE_PENDING', 'AUTO_ADMISORIO_PENDING']::text[];
    v_next := (public.add_business_days_sql((now() AT TIME ZONE 'America/Bogota')::date, 5)
               + (now() AT TIME ZONE 'America/Bogota')::time) AT TIME ZONE 'America/Bogota';
    INSERT INTO public.work_item_reminders (organization_id, owner_id, work_item_id, reminder_type,
      cadence_business_days, next_run_at, status, created_by)
    SELECT v_w.organization_id, v_w.owner_id, v_w.id, r::public.reminder_type, 5, v_next, 'ACTIVE', v_w.owner_id
      FROM unnest(v_rem) r
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_w.monitoring_enabled AND v_digits IS NOT NULL
     AND p_workflow_type IN ('CGP', 'CPACA', 'LABORAL', 'PENAL_906', 'TUTELA', 'EJECUTIVO') THEN
    INSERT INTO public.sync_retry_queue (work_item_id, organization_id, radicado, stage, kind, provider,
      attempt, max_attempts, next_run_at, last_error_code, last_error_message)
    VALUES
      (v_id, v_w.organization_id, v_digits, v_stage, 'PUB_RETRY',
       CASE WHEN p_workflow_type = 'CPACA' THEN 'samai' ELSE 'publicaciones' END, 0, 3, now(),
       'MCP_INITIAL_SYNC', 'Sincronización inicial de un asunto creado vía asistente IA'),
      (v_id, v_w.organization_id, v_digits, v_stage, 'ACT_SCRAPE_RETRY',
       CASE WHEN p_workflow_type = 'CPACA' THEN 'samai' ELSE 'cpnu' END, 0, 3, now() + interval '1 minute',
       'MCP_INITIAL_SYNC', 'Sincronización inicial de un asunto creado vía asistente IA')
    ON CONFLICT (work_item_id, kind) DO NOTHING;
    v_sync := ARRAY['PUB_RETRY', 'ACT_SCRAPE_RETRY']::text[];
  END IF;

  v_after := public._mcp_wi_snapshot(v_id);
  RETURN public._mcp_finish('create_work_item', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after, 'reminders_created', to_jsonb(v_rem),
      'initial_sync_enqueued', to_jsonb(v_sync),
      'note', CASE WHEN v_reason IS NOT NULL THEN 'Monitoreo suspendido deliberadamente por el usuario: ' || v_reason
                   WHEN NOT v_w.monitoring_enabled THEN 'Sin monitoreo automático: ' || COALESCE(v_w.monitoring_disabled_reason, '')
                   ELSE 'Monitoreo activo; la primera consulta queda en cola duradera.' END),
    'work_item', v_id, NULL, v_after || jsonb_build_object('reminders', to_jsonb(v_rem), 'initial_sync', to_jsonb(v_sync)));
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_work_item_lifecycle(p_work_item_id uuid, p_action text, p_expected_updated_at timestamp with time zone, p_idempotency_key text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prior jsonb; v_w public.work_items%ROWTYPE; v_state public.work_item_lifecycle_state;
  v_before jsonb; v_after jsonb; v_r jsonb; v_c jsonb := public.mcp_caller_context();
BEGIN
  v_prior := public._mcp_begin('work_item_lifecycle', p_idempotency_key,
    jsonb_build_object('id', p_work_item_id, 'action', p_action, 'exp', p_expected_updated_at, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_action NOT IN ('archive', 'trash', 'restore') THEN
    RAISE EXCEPTION 'acción inválida' USING ERRCODE = 'MCP22'; END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'expected_updated_at es obligatorio' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: asunto no encontrado' USING ERRCODE = 'MCP04'; END IF;
  IF v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_REVISION: el asunto cambió (updated_at actual %)', v_w.updated_at USING ERRCODE = 'MCP09'; END IF;
  v_before := public._mcp_wi_snapshot(p_work_item_id);
  IF p_action = 'archive' THEN
    IF v_w.lifecycle_state NOT IN ('ACTIVE', 'CLOSED') THEN
      RAISE EXCEPTION 'solo se archiva un asunto activo o cerrado (estado %)', v_w.lifecycle_state USING ERRCODE = 'MCP09'; END IF;
    v_state := 'ARCHIVED';
  ELSIF p_action = 'trash' THEN
    IF v_w.lifecycle_state = 'DELETED' THEN
      RAISE EXCEPTION 'el asunto ya está en la papelera' USING ERRCODE = 'MCP09'; END IF;
    v_state := 'DELETED';
  ELSE
    IF v_w.lifecycle_state NOT IN ('ARCHIVED', 'DELETED') THEN
      RAISE EXCEPTION 'solo se restaura un asunto archivado o en papelera' USING ERRCODE = 'MCP09'; END IF;
    IF v_w.lifecycle_state = 'DELETED' AND v_w.purge_after IS NOT NULL AND v_w.purge_after <= now() THEN
      RAISE EXCEPTION 'venció el plazo de recuperación (%)', v_w.purge_after USING ERRCODE = 'MCP09'; END IF;
    v_state := 'ACTIVE';
  END IF;
  v_r := public.set_work_item_lifecycle(p_work_item_id, v_state, COALESCE(p_reason, 'MCP_' || upper(p_action)),
           'MCP', auth.uid(), jsonb_build_object('via', 'mcp', 'oauth_client_id', v_c->>'oauth_client_id'));
  IF COALESCE((v_r->>'ok')::boolean, false) IS NOT TRUE OR COALESCE((v_r->>'no_op')::boolean, false) THEN
    RAISE EXCEPTION 'la transición no se aplicó: %', v_r USING ERRCODE = 'MCP09'; END IF;
  v_after := public._mcp_wi_snapshot(p_work_item_id);
  RETURN public._mcp_finish('work_item_lifecycle', p_idempotency_key,
    jsonb_build_object('ok', true, 'effect', p_action, 'work_item', v_after,
      'recovery_deadline', v_after->'purge_after',
      'note', CASE p_action
        WHEN 'trash' THEN 'En papelera: recuperable hasta recovery_deadline; luego se purga según la retención vigente.'
        WHEN 'archive' THEN 'Archivado: se conserva sin plazo y se puede restaurar; el monitoreo queda apagado.'
        ELSE 'Restaurado como activo.' END),
    'work_item', p_work_item_id, v_before, v_after);
END $function$
;
CREATE OR REPLACE FUNCTION public.record_lifecycle_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_outbox_id uuid;
  v_via text := COALESCE(current_setting('andromeda.via_lifecycle_rpc', true), 'off');
BEGIN
  IF NEW.lifecycle_state IS NOT DISTINCT FROM OLD.lifecycle_state THEN
    RETURN NEW;
  END IF;
  -- Inside set_work_item_lifecycle the RPC binds the new event afterwards;
  -- never attach an older outbox row.
  IF v_via <> 'on' THEN
    SELECT o.id INTO v_outbox_id
    FROM public.gcp_lifecycle_outbox o
    WHERE o.work_item_id = NEW.id
      AND o.new_state::text = NEW.lifecycle_state::text
    ORDER BY o.occurred_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.work_item_lifecycle_ledger (
    work_item_id, radicado, workflow_type, from_state, to_state,
    actor, actor_user_id, reason, occurred_at, record_origin,
    emitted_to_gcp, gcp_outbox_id, metadata
  ) VALUES (
    NEW.id,
    regexp_replace(COALESCE(NEW.radicado_digits, NEW.radicado, ''), '\D', '', 'g'),
    NEW.workflow_type::text,
    OLD.lifecycle_state::text,
    NEW.lifecycle_state::text,
    COALESCE(NEW.lifecycle_actor, 'SYSTEM'),
    NEW.lifecycle_actor_user,
    NEW.lifecycle_reason,
    COALESCE(NEW.lifecycle_changed_at, now()),
    'OBSERVED',
    v_outbox_id IS NOT NULL,
    v_outbox_id,
    jsonb_build_object('via_rpc', v_via)
  );
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.revoke_mcp_client_access(p_oauth_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb := public._mcp_require_first_party(); v_n int;
BEGIN
  UPDATE public.mcp_client_grants SET revoked_at = now(), revoked_reason = 'USER_REVOKED'
   WHERE user_id = auth.uid() AND oauth_client_id = p_oauth_client_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.mcp_action_audit (user_id, session_id, action, target_type, target_id, after)
  VALUES (auth.uid(), (c->>'session_id')::uuid, 'revoke_mcp_client_access', 'oauth_client', p_oauth_client_id,
          jsonb_build_object('revoked', v_n));
  RETURN jsonb_build_object('ok', true, 'revoked', v_n, 'access_level', 'read');
END $function$
;
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
    monitoring_enabled = (p_new_state = 'ACTIVE'
      AND public.is_provider_monitored_workflow(v_row.workflow_type::text)
      AND NULLIF(btrim(COALESCE(v_row.radicado, '')), '') IS NOT NULL
      AND NOT (COALESCE(v_row.monitoring_disabled_by, '') = 'USER'
               AND COALESCE(btrim(v_row.monitoring_disabled_reason), '') <> '')),
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
$function$
;

CREATE TRIGGER trg_record_lifecycle_transition AFTER UPDATE OF lifecycle_state ON work_items FOR EACH ROW EXECUTE FUNCTION record_lifecycle_transition();
GRANT EXECUTE ON FUNCTION set_work_item_lifecycle(uuid,work_item_lifecycle_state,text,text,uuid,jsonb),grant_mcp_client_access(uuid,text),revoke_mcp_client_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text),mcp_work_item_lifecycle(uuid,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_feed_cursors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,client_key uuid,work_item_id uuid,mode text,scan_ts timestamptz,scan_kind text,scan_id uuid,scan_upper timestamptz,checkpoint timestamptz,created_at timestamptz DEFAULT now(),expires_at timestamptz DEFAULT now()+interval '30 days');
CREATE TABLE public.work_item_acts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid,work_item_id uuid,act_date date,act_date_raw text,description text,act_type text,source text,source_reference text,raw_data jsonb,hash_fingerprint text,created_at timestamptz DEFAULT now(),organization_id uuid,workflow_type text,phase_inferred int4,confidence_level text,keywords_matched text[],parsing_errors text[],is_retroactive bool,event_type_normalized text,event_category text,event_date date,scrape_date date,despacho text,event_summary text,source_url text,source_platform text,is_archived bool,archived_at timestamptz,archived_reason text,is_canonical bool,canonical_at timestamptz,date_source text,date_confidence text,api_fetched_at timestamptz,api_scraped_at timestamptz,sources text[],updated_at timestamptz,raw_schema_version text,archived_by uuid,is_notifiable bool,provider_instance_id uuid,provider_case_id text,provenance jsonb,detected_at timestamptz,last_seen_at timestamptz,content_hash text,changed_at timestamptz,instancia text,fecha_registro_source date,inicia_termino date,discovery_type text,ingest_run_mode text,retro_gap_days int4,is_future_dated bool,origen_texto text,requiere_revision_manual bool,ingest_run_mode_source text,source_radicado text,recurso_consecutivo text,instancia_grado text,documentos jsonb,documentos_observados_en timestamptz);
CREATE TABLE public.work_item_email_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,organization_id uuid,work_item_id uuid,connection_id uuid,message_id text,internet_message_id text,conversation_id text,direction text,subject text,sender text,recipients text[],received_at timestamptz,has_attachments bool,attachment_names text[],web_link text,matched_by text,matched_value text,confidence numeric,evidence_type text,link_status text,created_at timestamptz DEFAULT now(),updated_at timestamptz,low_content bool,evidence_meta jsonb,evidence_subtype text,memorial_subtype text,ai_classified bool,ai_classified_at timestamptz,signal_class text,candidate_rank int4,confidence_ceiling numeric,conflict_flag bool,match_outcome text);
CREATE TABLE public.work_item_publicaciones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_item_id uuid,organization_id uuid,source text,title text,annotation text,pdf_url text,published_at timestamptz,hash_fingerprint text,raw_data jsonb,created_at timestamptz DEFAULT now(),fecha_fijacion timestamptz,fecha_desfijacion timestamptz,despacho text,tipo_publicacion text,is_archived bool,archived_at timestamptz,archived_reason text,is_canonical bool,canonical_at timestamptz,entry_url text,pdf_available bool,raw_json jsonb,date_source text,date_confidence text,api_fetched_at timestamptz,api_scraped_at timestamptz,sources text[],updated_at timestamptz,raw_schema_version text,archived_by uuid,is_notifiable bool,provider_instance_id uuid,provider_case_id text,provenance jsonb,detected_at timestamptz,last_seen_at timestamptz,content_hash text,changed_at timestamptz,fecha_providencia timestamptz,discovery_type text,ingest_run_mode text,is_retroactive bool,retro_gap_days int4,is_future_dated bool,origen_texto text,requiere_revision_manual bool,pdf_storage_path text,ingest_run_mode_source text,source_radicado text,recurso_consecutivo text,instancia_grado text);
CREATE TABLE public.work_item_sync_timeline(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_item_id uuid,organization_id uuid,sync_run_id uuid,provider text,operation text,function_name text,adapter_version text,deploy_sha text,status text,error_code text,error_message text,records_inserted int4,records_skipped int4,latency_ms int4,started_at timestamptz,finished_at timestamptz,metadata jsonb,created_at timestamptz DEFAULT now(),providers text[]);

CREATE TABLE alert_instances(id uuid);
CREATE TABLE detected_processes(id uuid);
CREATE TABLE work_item_stage_suggestions(id uuid);
CREATE OR REPLACE FUNCTION public.mcp_add_email_association(p_link_id uuid, p_work_item_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_w public.work_items%ROWTYPE; v_new uuid; v_l public.work_item_email_links%ROWTYPE;
BEGIN
  v_prior := public._mcp_begin('add_email_association', p_idempotency_key,
    jsonb_build_object('id', p_link_id, 'wi', p_work_item_id));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  SELECT * INTO v_l FROM public.work_item_email_links WHERE id = p_link_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: vínculo no encontrado' USING ERRCODE = 'MCP04'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND OR v_w.deleted_at IS NOT NULL OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: expediente destino no gestionable' USING ERRCODE = 'MCP04'; END IF;
  v_new := public.manual_link_email_to_work_item(p_link_id, p_work_item_id);
  IF v_new IS NULL THEN RAISE EXCEPTION 'no se creó el vínculo' USING ERRCODE = 'MCP09'; END IF;
  RETURN public._mcp_finish('add_email_association', p_idempotency_key,
    jsonb_build_object('ok', true, 'link_id', v_new, 'work_item_id', p_work_item_id,
      'note', 'Se agregó la asociación confirmada. Asociaciones ya confirmadas con otros expedientes se conservan; esto no es un traslado exclusivo ni cambia etapas o términos.'),
    'email_link', v_new, jsonb_build_object('source_link', p_link_id, 'source_status', v_l.link_status),
    jsonb_build_object('link_id', v_new, 'work_item_id', p_work_item_id));
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_move_work_item_stage(p_work_item_id uuid, p_to_stage text, p_expected_updated_at timestamp with time zone, p_app_stage_order text[], p_idempotency_key text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- p_app_stage_order is accepted for signature compatibility and IGNORED: validation is server-side only.
DECLARE v_prior jsonb; v_w public.work_items%ROWTYPE; v_before jsonb; v_after jsonb; v_chk jsonb;
BEGIN
  v_prior := public._mcp_begin('move_stage', p_idempotency_key,
    jsonb_build_object('id', p_work_item_id, 'to', p_to_stage, 'exp', p_expected_updated_at, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'expected_updated_at es obligatorio' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) OR v_w.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: asunto no encontrado' USING ERRCODE = 'MCP04'; END IF;
  IF v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_REVISION: el asunto cambió (updated_at actual %)', v_w.updated_at USING ERRCODE = 'MCP09'; END IF;
  IF v_w.lifecycle_state <> 'ACTIVE' THEN RAISE EXCEPTION 'el asunto no está activo' USING ERRCODE = 'MCP09'; END IF;
  v_chk := public._mcp_check_manual_stage_move(v_w.workflow_type::text, v_w.stage, p_to_stage, p_reason);
  v_before := public._mcp_wi_snapshot(p_work_item_id);
  PERFORM public._mcp_apply_stage(v_w, p_to_stage, 'MANUAL_USER', NULL,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Cambio de etapa vía asistente IA'));
  v_after := public._mcp_wi_snapshot(p_work_item_id);
  RETURN public._mcp_finish('move_stage', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after, 'previous_stage', v_w.stage,
      'validated_by', v_chk->>'rule', 'is_regression', (v_chk->>'is_regression')::boolean, 'reason', p_reason),
    'work_item', p_work_item_id, v_before, v_after || jsonb_build_object('reason', p_reason, 'is_regression', v_chk->'is_regression'));
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_resolve_alert(p_alert_id uuid, p_action text, p_idempotency_key text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_a public.alert_instances%ROWTYPE; v_after jsonb;
BEGIN
  v_prior := public._mcp_begin('resolve_alert', p_idempotency_key,
    jsonb_build_object('id', p_alert_id, 'a', p_action, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_action NOT IN ('acknowledge', 'dismiss') THEN RAISE EXCEPTION 'acción inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_a FROM public.alert_instances WHERE id = p_alert_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    IF cardinality(public._notification_ids_visible_to_caller(ARRAY[p_alert_id])) = 1 THEN
      RAISE EXCEPTION 'WRONG_KIND: ese ID es una notificación; usa set_notification_state' USING ERRCODE = 'MCP22'; END IF;
    RAISE EXCEPTION 'NOT_FOUND: alerta no encontrada' USING ERRCODE = 'MCP04'; END IF;
  IF v_a.status NOT IN ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FIRED') THEN
    RAISE EXCEPTION 'ALREADY_CLOSED: la alerta está %', v_a.status USING ERRCODE = 'MCP09'; END IF;
  IF p_action = 'dismiss' AND v_a.resolution_mode = 'AUTO_ON_CAUSE_CLEARED' THEN
    RAISE EXCEPTION 'NOT_DISMISSABLE: esta alerta se cierra sola cuando desaparece su causa; solo se puede marcar como vista' USING ERRCODE = 'MCP22'; END IF;
  IF p_action = 'acknowledge' THEN
    UPDATE public.alert_instances SET status = 'ACKNOWLEDGED', acknowledged_at = COALESCE(acknowledged_at, now()),
      read_at = COALESCE(read_at, now()), seen_at = COALESCE(seen_at, now()) WHERE id = v_a.id;
  ELSE
    UPDATE public.alert_instances SET status = 'DISMISSED', dismissed_at = now(),
      dismissal_reason = COALESCE(p_reason, 'MCP_DISMISS'),
      read_at = COALESCE(read_at, now()), seen_at = COALESCE(seen_at, now()) WHERE id = v_a.id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'la alerta no se actualizó' USING ERRCODE = 'MCP09'; END IF;
  SELECT jsonb_build_object('id', id, 'status', status, 'acknowledged_at', acknowledged_at,
    'dismissed_at', dismissed_at, 'read_at', read_at, 'resolution_mode', resolution_mode) INTO v_after
    FROM public.alert_instances WHERE id = v_a.id;
  RETURN public._mcp_finish('resolve_alert', p_idempotency_key,
    jsonb_build_object('ok', true, 'alert', v_after,
      'note', 'Descartar o marcar vista una alerta es personal: no cumple ni cierra ningún término.'),
    'alert_instance', v_a.id, jsonb_build_object('status', v_a.status), v_after);
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_resolve_detected_process(p_id uuid, p_decision text, p_work_item_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_d public.detected_processes%ROWTYPE; v_w public.work_items%ROWTYPE; v_status text;
BEGIN
  v_prior := public._mcp_begin('resolve_detected_process', p_idempotency_key,
    jsonb_build_object('id', p_id, 'd', p_decision, 'wi', p_work_item_id));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_decision NOT IN ('dismiss', 'matched_existing', 'created') THEN RAISE EXCEPTION 'decisión inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_d FROM public.detected_processes WHERE id = p_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: proceso detectado no encontrado' USING ERRCODE = 'MCP04'; END IF;
  IF v_d.status <> 'PENDING' THEN RAISE EXCEPTION 'ALREADY_RESOLVED: está %', v_d.status USING ERRCODE = 'MCP09'; END IF;
  IF p_decision = 'dismiss' THEN
    UPDATE public.detected_processes SET status = 'DISMISSED', dismissed_at = now(), updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('resolved_via', 'mcp') WHERE id = p_id;
    v_status := 'DISMISSED';
  ELSE
    IF p_work_item_id IS NULL THEN RAISE EXCEPTION 'work_item_id es obligatorio' USING ERRCODE = 'MCP22'; END IF;
    SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id;
    IF NOT FOUND OR v_w.deleted_at IS NOT NULL OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: expediente no gestionable' USING ERRCODE = 'MCP04'; END IF;
    IF left(regexp_replace(COALESCE(v_w.radicado, ''), '[^0-9]', '', 'g'), 21)
       <> left(regexp_replace(COALESCE(v_d.radicado, ''), '[^0-9]', '', 'g'), 21) THEN
      RAISE EXCEPTION 'RADICADO_MISMATCH: el expediente no corresponde al radicado detectado' USING ERRCODE = 'MCP22'; END IF;
    IF p_decision = 'created' AND v_w.created_at < v_d.first_seen_at THEN
      RAISE EXCEPTION 'el expediente ya existía antes de la detección; usa matched_existing' USING ERRCODE = 'MCP22'; END IF;
    v_status := CASE p_decision WHEN 'created' THEN 'CREATED' ELSE 'MATCHED_EXISTING' END;
    UPDATE public.detected_processes SET status = v_status, created_work_item_id = p_work_item_id, updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('resolved_via', 'mcp') WHERE id = p_id;
  END IF;
  RETURN public._mcp_finish('resolve_detected_process', p_idempotency_key,
    jsonb_build_object('ok', true, 'id', p_id, 'status', v_status, 'work_item_id', p_work_item_id),
    'detected_process', p_id, jsonb_build_object('status', v_d.status), jsonb_build_object('status', v_status));
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_resolve_email_question(p_link_id uuid, p_decision text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_l public.work_item_email_links%ROWTYPE; v_w public.work_items%ROWTYPE;
  v_bases text[]; v_target text; v_dismissed int := 0; v_ids uuid[];
BEGIN
  v_prior := public._mcp_begin('resolve_email_question', p_idempotency_key, jsonb_build_object('id', p_link_id, 'd', p_decision));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_decision NOT IN ('confirm', 'dismiss') THEN RAISE EXCEPTION 'decisión inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_l FROM public.work_item_email_links WHERE id = p_link_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: vínculo no encontrado' USING ERRCODE = 'MCP04'; END IF;
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
    SELECT id FROM public.work_item_email_links
     WHERE user_id = auth.uid()
       AND CASE WHEN v_l.internet_message_id IS NOT NULL THEN internet_message_id = v_l.internet_message_id
                ELSE message_id = v_l.message_id END
     ORDER BY id FOR UPDATE) s;
  SELECT * INTO v_l FROM public.work_item_email_links WHERE id = p_link_id;
  IF p_decision = 'confirm' THEN
    IF v_l.link_status <> 'SUGGESTED' THEN
      RAISE EXCEPTION 'ALREADY_RESOLVED: el vínculo está %', v_l.link_status USING ERRCODE = 'MCP09'; END IF;
    SELECT * INTO v_w FROM public.work_items WHERE id = v_l.work_item_id;
    IF NOT FOUND OR v_w.deleted_at IS NOT NULL OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: expediente destino no gestionable' USING ERRCODE = 'MCP04'; END IF;
    SELECT COALESCE(array_agg(DISTINCT b), ARRAY[]::text[]) INTO v_bases
      FROM unnest(public._mcp_message_radicado_bases(v_l.evidence_meta) || public._mcp_subject_radicado_bases(v_l.subject)) b;
    v_target := left(regexp_replace(COALESCE(v_w.radicado, ''), '[^0-9]', '', 'g'), 21);
    IF COALESCE(v_l.conflict_flag, false)
       OR (cardinality(v_bases) > 0 AND v_target <> '' AND NOT v_target = ANY (v_bases)) THEN
      RAISE EXCEPTION 'RADICADO_CONFLICT: el correo cita otro radicado; usa add_email_association si es deliberado' USING ERRCODE = 'MCP09'; END IF;
    UPDATE public.work_item_email_links SET link_status = 'DISMISSED'
     WHERE id = ANY (v_ids) AND id <> v_l.id AND link_status = 'SUGGESTED';
    GET DIAGNOSTICS v_dismissed = ROW_COUNT;
    UPDATE public.work_item_email_links SET link_status = 'CONFIRMED' WHERE id = v_l.id AND link_status = 'SUGGESTED';
    IF NOT FOUND THEN RAISE EXCEPTION 'el vínculo cambió' USING ERRCODE = 'MCP09'; END IF;
  ELSE
    UPDATE public.work_item_email_links SET link_status = 'DISMISSED' WHERE id = ANY (v_ids) AND link_status = 'SUGGESTED';
    GET DIAGNOSTICS v_dismissed = ROW_COUNT;
    IF v_dismissed = 0 THEN RAISE EXCEPTION 'ALREADY_RESOLVED: no hay sugerencias pendientes para este correo' USING ERRCODE = 'MCP09'; END IF;
  END IF;
  RETURN public._mcp_finish('resolve_email_question', p_idempotency_key,
    jsonb_build_object('ok', true, 'decision', p_decision,
      'confirmed_link_id', CASE WHEN p_decision = 'confirm' THEN v_l.id END,
      'work_item_id', CASE WHEN p_decision = 'confirm' THEN v_l.work_item_id END,
      'siblings_dismissed', v_dismissed,
      'note', 'Asociar un correo nunca cambia la etapa ni da por cumplido un término.'),
    'email_message', v_l.id, jsonb_build_object('link_ids', v_ids),
    jsonb_build_object('decision', p_decision, 'dismissed', v_dismissed));
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_resolve_stage_suggestion(p_suggestion_id uuid, p_decision text, p_expected_updated_at timestamp with time zone, p_app_stage_order text[], p_idempotency_key text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_s public.work_item_stage_suggestions%ROWTYPE; v_w public.work_items%ROWTYPE;
  v_before jsonb; v_after jsonb;
BEGIN
  v_prior := public._mcp_begin('resolve_stage_suggestion', p_idempotency_key,
    jsonb_build_object('id', p_suggestion_id, 'd', p_decision, 'exp', p_expected_updated_at, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_decision NOT IN ('apply', 'dismiss') THEN RAISE EXCEPTION 'decisión inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_s FROM public.work_item_stage_suggestions WHERE id = p_suggestion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: sugerencia no encontrada' USING ERRCODE = 'MCP04'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = v_s.work_item_id FOR UPDATE;
  IF NOT FOUND OR v_w.deleted_at IS NOT NULL
     OR NOT (v_s.owner_id = auth.uid() OR (v_s.organization_id IS NOT NULL AND public.is_business_org_admin(v_s.organization_id)))
     OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: sugerencia no encontrada' USING ERRCODE = 'MCP04'; END IF;
  IF v_s.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ALREADY_RESOLVED: la sugerencia ya está %', v_s.status USING ERRCODE = 'MCP09'; END IF;
  v_before := jsonb_build_object('suggestion_status', v_s.status, 'work_item', public._mcp_wi_snapshot(v_w.id));
  IF p_decision = 'apply' THEN
    IF p_expected_updated_at IS NULL OR v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'STALE_REVISION: el asunto cambió (updated_at actual %)', v_w.updated_at USING ERRCODE = 'MCP09'; END IF;
    IF v_s.suggested_stage IS NULL OR v_s.suggested_stage = v_w.stage THEN
      RAISE EXCEPTION 'la sugerencia no implica un cambio de etapa' USING ERRCODE = 'MCP09'; END IF;
    PERFORM public._mcp_check_stage_move(v_w.workflow_type::text, v_w.stage, v_s.suggested_stage, p_app_stage_order);
    PERFORM public._mcp_apply_stage(v_w, v_s.suggested_stage, 'SUGGESTION_APPLIED', v_s.id,
      COALESCE(p_reason, 'Sugerencia aceptada vía asistente IA: ' || COALESCE(v_s.reason, '')));
    UPDATE public.work_item_stage_suggestions SET status = 'APPLIED', applied_by_user_id = auth.uid(),
      applied_at = now(), updated_at = now() WHERE id = v_s.id AND status = 'PENDING';
  ELSE
    UPDATE public.work_item_stage_suggestions SET status = 'DISMISSED', dismiss_reason = COALESCE(p_reason, 'MCP_DISMISS'),
      updated_at = now() WHERE id = v_s.id AND status = 'PENDING';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'la sugerencia cambió' USING ERRCODE = 'MCP09'; END IF;
  v_after := jsonb_build_object('suggestion_status', CASE p_decision WHEN 'apply' THEN 'APPLIED' ELSE 'DISMISSED' END,
                                'work_item', public._mcp_wi_snapshot(v_w.id));
  RETURN public._mcp_finish('resolve_stage_suggestion', p_idempotency_key,
    jsonb_build_object('ok', true, 'suggestion_id', v_s.id) || v_after, 'stage_suggestion', v_s.id, v_before, v_after);
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_set_notification_state(p_ids uuid[], p_action text, p_until timestamp with time zone, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_n int; v_ids uuid[];
BEGIN
  v_prior := public._mcp_begin('set_notification_state', p_idempotency_key,
    jsonb_build_object('ids', p_ids, 'a', p_action, 'until', p_until));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 200 THEN
    RAISE EXCEPTION 'entre 1 y 200 IDs' USING ERRCODE = 'MCP22'; END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_ids) x;
  IF EXISTS (SELECT 1 FROM public.alert_instances WHERE id = ANY (v_ids) AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'WRONG_KIND: hay IDs de alertas; usa resolve_alert' USING ERRCODE = 'MCP22'; END IF;
  IF cardinality(public._notification_ids_visible_to_caller(v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'NOT_FOUND: notificación no encontrada' USING ERRCODE = 'MCP04'; END IF;
  SELECT count(*) INTO v_n FROM public.set_notification_user_state(v_ids, p_action, p_until);
  IF v_n <> cardinality(v_ids) THEN RAISE EXCEPTION 'no se actualizaron todas las notificaciones' USING ERRCODE = 'MCP09'; END IF;
  RETURN public._mcp_finish('set_notification_state', p_idempotency_key,
    jsonb_build_object('ok', true, 'updated', v_n, 'action', p_action,
      'states', (SELECT jsonb_agg(jsonb_build_object('notification_id', notification_id, 'read_at', read_at,
         'dismissed_at', dismissed_at, 'snoozed_until', snoozed_until))
         FROM public.notification_user_state WHERE user_id = auth.uid() AND notification_id = ANY (v_ids))),
    'notifications', NULL, NULL, jsonb_build_object('ids', v_ids, 'action', p_action));
END $function$
;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname IN ('mcp_move_work_item_stage','mcp_resolve_stage_suggestion','mcp_resolve_alert','mcp_set_notification_state','mcp_resolve_email_question','mcp_add_email_association','mcp_resolve_detected_process') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p.sig); END LOOP; END $$;
CREATE OR REPLACE FUNCTION public._mcp_client_key()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT COALESCE((public.mcp_caller_context()->>'oauth_client_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) $function$
;
CREATE OR REPLACE FUNCTION public._mcp_email_group_key(p_imid text, p_mid text, p_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ SELECT COALESCE('imid:' || NULLIF(p_imid, ''), 'mid:' || NULLIF(p_mid, ''), 'id:' || p_id::text) $function$
;
CREATE OR REPLACE FUNCTION public._mcp_feed_freshness(p_work_item_id uuid, p_page_items uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scope AS (
    SELECT w.id, w.last_synced_at, w.scrape_status, w.monitoring_enabled FROM public.work_items w
     WHERE w.deleted_at IS NULL AND (p_work_item_id IS NULL OR w.id = p_work_item_id)
  ), shown AS (
    SELECT s.* FROM scope s
     WHERE s.monitoring_enabled OR s.id = p_work_item_id OR s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))
     ORDER BY (s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))) DESC, s.id LIMIT 200
  ), latest AS (
    SELECT DISTINCT ON (t.work_item_id, t.provider, t.operation) t.work_item_id, t.provider, t.operation, t.status,
           t.error_code, t.started_at, t.finished_at, t.records_inserted, t.records_skipped
      FROM public.work_item_sync_timeline t JOIN scope s ON s.id = t.work_item_id
     WHERE t.created_at > now() - interval '30 days'
     ORDER BY t.work_item_id, t.provider, t.operation, COALESCE(t.finished_at, t.started_at, t.created_at) DESC
  ), last_ok AS (
    SELECT t.work_item_id, t.provider, t.operation, max(COALESCE(t.finished_at, t.started_at)) AS at
      FROM public.work_item_sync_timeline t JOIN scope s ON s.id = t.work_item_id
     WHERE t.status = 'success' AND t.created_at > now() - interval '90 days'
     GROUP BY 1, 2, 3
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('latest_check', '30 days', 'last_success', '90 days'),
    'scope', CASE WHEN p_work_item_id IS NULL THEN 'portfolio' ELSE 'work_item' END,
    'monitored_items', (SELECT count(*) FROM scope WHERE monitoring_enabled),
    'monitored_items_without_check', (SELECT count(*) FROM scope s WHERE s.monitoring_enabled
                                      AND NOT EXISTS (SELECT 1 FROM latest l WHERE l.work_item_id = s.id)),
    'items_listed', (SELECT count(*) FROM shown),
    'items_truncated', (SELECT count(*) FROM scope s WHERE s.monitoring_enabled OR s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))) > 200,
    'by_provider', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', provider, 'operation', operation,
        'items_checked', n, 'items_latest_success', n_ok, 'items_latest_not_success', n - n_ok,
        'oldest_last_success_at', oldest_ok, 'newest_last_success_at', newest_ok) ORDER BY provider, operation)
      FROM (SELECT l.provider, l.operation, count(*) n, count(*) FILTER (WHERE l.status = 'success') n_ok,
                   min(o.at) oldest_ok, max(o.at) newest_ok
              FROM latest l LEFT JOIN last_ok o USING (work_item_id, provider, operation)
             GROUP BY 1, 2) g), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('work_item_id', s.id, 'monitoring_enabled', s.monitoring_enabled,
        'cache_summary', jsonb_build_object('last_synced_at', s.last_synced_at, 'scrape_status', s.scrape_status),
        'sync_checks', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', l.provider, 'operation', l.operation,
             'status', l.status, 'successful_check', l.status = 'success', 'error_code', l.error_code,
             'started_at', l.started_at, 'finished_at', l.finished_at, 'records_inserted', l.records_inserted,
             'records_skipped', l.records_skipped, 'last_success_at', o.at) ORDER BY l.provider, l.operation)
           FROM latest l LEFT JOIN last_ok o USING (work_item_id, provider, operation) WHERE l.work_item_id = s.id), '[]'::jsonb))
        ORDER BY s.id)
      FROM shown s), '[]'::jsonb))
$function$
;
CREATE OR REPLACE FUNCTION public._mcp_feed_page(p_ts timestamp with time zone, p_kind text, p_id uuid, p_upper timestamp with time zone, p_limit integer, p_work_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_lim int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500); v_rows jsonb; v_n int; v_more boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  WITH vis AS (
    SELECT w.id FROM public.work_items w WHERE p_work_item_id IS NULL OR w.id = p_work_item_id
  ), ev AS (
    SELECT * FROM (
      SELECT COALESCE(a.updated_at, a.created_at) AS ts, 'actuacion'::text AS kind, a.id, a.work_item_id,
        md5(COALESCE(a.updated_at, a.created_at)::text || '|' || COALESCE(a.content_hash, '') || '|' || COALESCE(a.is_archived::text, '')) AS rev,
        jsonb_build_object('act_date', a.act_date, 'description', left(a.description, 400), 'source', a.source,
          'detected_at', a.detected_at, 'changed_at', a.changed_at, 'created_at', a.created_at,
          'updated_at', a.updated_at, 'is_archived', a.is_archived, 'content_hash', a.content_hash) AS data
        FROM public.work_item_acts a JOIN vis ON vis.id = a.work_item_id
       WHERE (COALESCE(a.updated_at, a.created_at), 'actuacion'::text, a.id) > (p_ts, p_kind, p_id)
         AND COALESCE(a.updated_at, a.created_at) <= p_upper
       ORDER BY 1, 3 LIMIT v_lim + 1) x
    UNION ALL SELECT * FROM (
      SELECT COALESCE(p.updated_at, p.created_at), 'estado'::text, p.id, p.work_item_id,
        md5(COALESCE(p.updated_at, p.created_at)::text || '|' || COALESCE(p.content_hash, '') || '|' || COALESCE(p.is_archived::text, '')),
        jsonb_build_object('title', left(p.title, 300), 'fecha_fijacion', p.fecha_fijacion,
          'fecha_desfijacion', p.fecha_desfijacion, 'tipo_publicacion', p.tipo_publicacion, 'source', p.source,
          'detected_at', p.detected_at, 'changed_at', p.changed_at, 'created_at', p.created_at,
          'updated_at', p.updated_at, 'is_archived', p.is_archived, 'content_hash', p.content_hash)
        FROM public.work_item_publicaciones p JOIN vis ON vis.id = p.work_item_id
       WHERE (COALESCE(p.updated_at, p.created_at), 'estado'::text, p.id) > (p_ts, p_kind, p_id)
         AND COALESCE(p.updated_at, p.created_at) <= p_upper
       ORDER BY 1, 3 LIMIT v_lim + 1) y
    UNION ALL SELECT * FROM (
      SELECT COALESCE(w.lifecycle_changed_at, w.created_at), 'work_item_lifecycle'::text, w.id, w.id,
        md5(COALESCE(w.lifecycle_changed_at, w.created_at)::text || '|' || w.lifecycle_state::text),
        jsonb_build_object('lifecycle_state', w.lifecycle_state, 'created_at', w.created_at,
          'lifecycle_changed_at', w.lifecycle_changed_at, 'deleted_at', w.deleted_at, 'purge_after', w.purge_after)
        FROM public.work_items w JOIN vis ON vis.id = w.id
       WHERE (COALESCE(w.lifecycle_changed_at, w.created_at), 'work_item_lifecycle'::text, w.id) > (p_ts, p_kind, p_id)
         AND COALESCE(w.lifecycle_changed_at, w.created_at) <= p_upper
       ORDER BY 1, 3 LIMIT v_lim + 1) z
  ), page AS (SELECT * FROM ev ORDER BY ts, kind, id LIMIT v_lim + 1)
  SELECT jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'work_item_id', work_item_id, 'change_ts', ts,
           'revision', rev, 'dedupe_key', kind || ':' || id || ':' || rev, 'data', data) ORDER BY ts, kind, id), count(*)
    INTO v_rows, v_n FROM page;
  v_more := COALESCE(v_n, 0) > v_lim;
  IF v_more THEN v_rows := v_rows - v_lim; END IF;
  RETURN jsonb_build_object('events', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more);
END $function$
;
CREATE OR REPLACE FUNCTION public._mcp_feed_step(p_client uuid, p_work_item_id uuid, p_mode text, p_ts timestamp with time zone, p_kind text, p_id uuid, p_upper timestamp with time zone, p_checkpoint timestamp with time zone, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_upper timestamptz := COALESCE(p_upper, now()); v_page jsonb; v_last jsonb; v_new uuid; v_cp timestamptz;
  v_wis uuid[]; v_more boolean;
BEGIN
  v_page := public._mcp_feed_page(p_ts, p_kind, p_id, v_upper, p_limit, p_work_item_id);
  v_more := (v_page->>'has_more')::boolean;
  v_last := (v_page->'events') -> (jsonb_array_length(v_page->'events') - 1);
  DELETE FROM public.mcp_feed_cursors WHERE user_id = auth.uid() AND expires_at < now();
  IF v_more THEN
    v_cp := p_checkpoint;
    INSERT INTO public.mcp_feed_cursors (user_id, client_key, work_item_id, mode, scan_ts, scan_kind, scan_id, scan_upper, checkpoint)
    VALUES (auth.uid(), p_client, p_work_item_id, p_mode, (v_last->>'change_ts')::timestamptz, v_last->>'kind',
            (v_last->>'id')::uuid, v_upper, p_checkpoint) RETURNING id INTO v_new;
  ELSE
    v_cp := GREATEST(v_upper, COALESCE(p_checkpoint, v_upper));
    INSERT INTO public.mcp_feed_cursors (user_id, client_key, work_item_id, mode, checkpoint)
    VALUES (auth.uid(), p_client, p_work_item_id, 'incremental', v_cp) RETURNING id INTO v_new;
  END IF;
  SELECT array_agg(DISTINCT (e->>'work_item_id')::uuid) INTO v_wis FROM jsonb_array_elements(v_page->'events') e;
  RETURN jsonb_build_object('mode', p_mode, 'events', v_page->'events', 'has_more', v_more,
    'caught_up', NOT v_more, 'next_cursor', 'c1.' || v_new::text,
    'scan_lower_exclusive', jsonb_build_object('change_ts', p_ts, 'kind', p_kind, 'id', p_id),
    'scan_upper_watermark', v_upper, 'checkpoint', v_cp,
    'overlap_window_seconds', 900,
    'freshness', public._mcp_feed_freshness(p_work_item_id, v_wis),
    'limitations', 'Cursor opaco guardado en el servidor, ligado a usuario, cliente de IA y filtro; caduca a los 30 días (entonces usa reconcile_since=checkpoint menos 15 min; nunca se reinicia en silencio). Cada pasada tiene un tope fijo (scan_upper_watermark); al terminarla checkpoint avanza a ese tope y la siguiente pasada relee 15 minutos antes del checkpoint. Cambios seleccionados por revisión (updated_at): incluye correcciones y archivados de filas antiguas; detected_at solo para mostrar. Cada evento muestra el estado ACTUAL de la fila: revisiones intermedias entre consultas se fusionan. Las purgas definitivas no generan evento. updated_at se fija al inicio de la transacción: una transacción que confirme más de 15 minutos después de iniciar puede no aparecer; reconcilia periódicamente. Primera llamada sin cursor: últimos 3 días. Frescura: solo status=success cuenta como consulta exitosa (empty, error, skipped, rejected, pending_upstream y partial no); los intentos diarios internos no son visibles para el usuario. Sin eventos no significa que los proveedores hayan respondido.');
END $function$
;
CREATE OR REPLACE FUNCTION public._mcp_message_radicado_bases(p_meta jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT left(regexp_replace(x, '[^0-9]', '', 'g'), 21))
                  FILTER (WHERE length(regexp_replace(x, '[^0-9]', '', 'g')) >= 21), ARRAY[]::text[])
  FROM (SELECT jsonb_array_elements_text(COALESCE(p_meta->k, '[]'::jsonb)) x
          FROM unnest(ARRAY['body_radicados', 'subject_radicados', 'radicados']) k
         WHERE jsonb_typeof(p_meta->k) = 'array') s
$function$
;
CREATE OR REPLACE FUNCTION public._mcp_subject_radicado_bases(p_subject text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT left(d, 21)) FILTER (WHERE length(d) BETWEEN 21 AND 23), ARRAY[]::text[])
    FROM (SELECT regexp_replace(m[1], '[^0-9]', '', 'g') AS d
            FROM regexp_matches(COALESCE(p_subject, ''), '(\d(?:[ .\-]?\d){20,22})', 'g') AS m) s
$function$
;
CREATE OR REPLACE FUNCTION public.mcp_list_email_questions(p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_lim int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_ts timestamptz; v_key text; v_write boolean := public.mcp_write_allowed(); v_groups jsonb; v_n int; v_last jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    BEGIN
      v_ts := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 't')::timestamptz;
      v_key := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'k';
    EXCEPTION WHEN others THEN v_ts := NULL; END;
    IF v_ts IS NULL OR v_key IS NULL THEN RAISE EXCEPTION 'CURSOR_INVALID' USING ERRCODE = 'MCP22'; END IF;
  END IF;
  WITH pending AS (   -- RLS limits rows to what the caller may see
    SELECT DISTINCT public._mcp_email_group_key(l.internet_message_id, l.message_id, l.id) AS gk
      FROM public.work_item_email_links l WHERE l.link_status = 'SUGGESTED'
  ), g AS (
    SELECT p.gk, max(COALESCE(l.received_at, l.created_at)) AS ts
      FROM pending p JOIN public.work_item_email_links l
        ON public._mcp_email_group_key(l.internet_message_id, l.message_id, l.id) = p.gk
     GROUP BY p.gk
  ), page AS (
    SELECT * FROM g WHERE v_ts IS NULL OR (g.ts, g.gk) < (v_ts, v_key)
     ORDER BY g.ts DESC, g.gk DESC LIMIT v_lim + 1
  ), links AS (
    SELECT p.gk, p.ts, l.*, w.title AS wi_title, w.radicado AS wi_radicado, w.owner_id AS wi_owner,
           w.deleted_at AS wi_deleted, w.lifecycle_state::text AS wi_state,
           left(regexp_replace(COALESCE(w.radicado, ''), '[^0-9]', '', 'g'), 21) AS wi_base,
           public._mcp_subject_radicado_bases(l.subject) AS subj_bases,
           public._mcp_message_radicado_bases(l.evidence_meta) AS meta_bases
      FROM page p JOIN public.work_item_email_links l
        ON public._mcp_email_group_key(l.internet_message_id, l.message_id, l.id) = p.gk
      LEFT JOIN public.work_items w ON w.id = l.work_item_id
  ), grp AS (
    SELECT gk, ts,
      (array_agg(jsonb_build_object('subject', subject, 'sender', sender, 'received_at', received_at,
         'direction', direction, 'has_attachments', has_attachments, 'attachment_names', attachment_names,
         'web_link', web_link, 'internet_message_id', internet_message_id, 'message_id', message_id)
         ORDER BY created_at, id))[1] AS source,
      bool_or(COALESCE(conflict_flag, false)) AS any_flag,
      jsonb_agg(jsonb_build_object(
        'link_id', id, 'work_item_id', work_item_id, 'work_item_title', wi_title, 'radicado', wi_radicado,
        'work_item_state', wi_state, 'link_status', link_status, 'confidence', confidence,
        'confidence_ceiling', confidence_ceiling, 'candidate_rank', candidate_rank, 'matched_by', matched_by,
        'matched_value', matched_value, 'signal_class', signal_class, 'evidence_type', evidence_type,
        'evidence_subtype', evidence_subtype, 'match_outcome', match_outcome, 'conflict_flag', conflict_flag,
        'stored_meta_radicado_bases', meta_bases,
        'scope', CASE WHEN user_id = v_uid AND wi_owner = v_uid AND wi_deleted IS NULL THEN 'writable' ELSE 'organization_view_only' END,
        'allowed_actions', CASE WHEN user_id = v_uid AND wi_owner = v_uid AND wi_deleted IS NULL AND v_write AND link_status = 'SUGGESTED'
                                THEN '["confirm","dismiss_all_suggestions"]'::jsonb ELSE '[]'::jsonb END)
        ORDER BY candidate_rank NULLS LAST, confidence DESC NULLS LAST, id) AS candidates,
      array_agg(DISTINCT wi_base) FILTER (WHERE wi_base <> '') AS cand_bases
    FROM links GROUP BY gk, ts
  ), sb AS (
    SELECT gk, array_agg(DISTINCT b) AS subj FROM links, unnest(subj_bases) b GROUP BY gk
  ), mb AS (
    SELECT gk, array_agg(DISTINCT b) AS meta FROM links, unnest(meta_bases) b GROUP BY gk
  ), fin AS (
    SELECT grp.*, COALESCE(sb.subj, ARRAY[]::text[]) AS subj, COALESCE(mb.meta, ARRAY[]::text[]) AS meta
      FROM grp LEFT JOIN sb USING (gk) LEFT JOIN mb USING (gk)
  )
  SELECT jsonb_agg(jsonb_build_object(
      'group_key', gk, 'latest_at', ts, 'source', source,
      'raw_subject_radicado_bases', subj, 'stored_meta_radicado_bases', meta,
      'conflict', any_flag
                  OR (SELECT count(DISTINCT b) FROM unnest(subj || meta) b) > 1
                  OR (cardinality(subj || meta) > 0 AND NOT COALESCE(cand_bases && (subj || meta), false)),
      'candidates', candidates) ORDER BY ts DESC, gk DESC), count(*)
    INTO v_groups, v_n FROM fin;
  v_groups := COALESCE(v_groups, '[]'::jsonb);
  IF v_n > v_lim THEN v_groups := v_groups - v_lim; END IF;
  v_last := v_groups -> (jsonb_array_length(v_groups) - 1);
  RETURN jsonb_build_object('questions', v_groups, 'has_more', COALESCE(v_n, 0) > v_lim,
    'next_cursor', CASE WHEN COALESCE(v_n, 0) > v_lim THEN
       replace(encode(convert_to(jsonb_build_object('t', v_last->>'latest_at', 'k', v_last->>'group_key')::text, 'UTF8'), 'base64'), E'\n', '') END,
    'can_write', v_write,
    'notes', 'Solo metadatos del correo (nunca cuerpos ni envíos). Agrupado por internet_message_id (o message_id). Una pregunta aparece mientras tenga al menos una sugerencia pendiente; se listan todos los candidatos del mensaje. scope=writable solo para vínculos propios en asuntos propios; organization_view_only nunca es gestionable. confirm (resolve_email_question) descarta las demás sugerencias del mensaje; si conflict=true usa add_email_association solo por decisión explícita del usuario. Confirmar un correo nunca cambia etapas ni da por cumplido un término. El cursor es solo posición de lectura (filas filtradas por RLS).');
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_list_updates(p_cursor text, p_limit integer DEFAULT 100, p_work_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_ck uuid; c public.mcp_feed_cursors%ROWTYPE; v_cid uuid;
  z uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  v_ck := public._mcp_client_key();
  IF p_cursor IS NULL OR p_cursor = '' THEN
    RETURN public._mcp_feed_step(v_ck, p_work_item_id, 'incremental', now() - interval '3 days', '', z, NULL, NULL, p_limit);
  END IF;
  IF p_cursor !~ '^c1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CURSOR_INVALID: cursor no reconocido (los cursores anteriores a esta versión no son válidos)' USING ERRCODE = 'MCP22'; END IF;
  v_cid := substr(p_cursor, 4)::uuid;
  SELECT * INTO c FROM public.mcp_feed_cursors WHERE id = v_cid AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'CURSOR_INVALID: cursor no reconocido' USING ERRCODE = 'MCP22'; END IF;
  IF c.client_key <> v_ck THEN RAISE EXCEPTION 'CURSOR_FOREIGN: el cursor pertenece a otra conexión' USING ERRCODE = 'MCP22'; END IF;
  IF c.work_item_id IS DISTINCT FROM p_work_item_id THEN RAISE EXCEPTION 'CURSOR_SCOPE_MISMATCH' USING ERRCODE = 'MCP22'; END IF;
  IF c.expires_at < now() THEN
    RAISE EXCEPTION 'CURSOR_EXPIRED: reconcilia con reconcile_since=% (checkpoint menos 15 minutos)',
      COALESCE(c.checkpoint, c.scan_ts) - interval '15 minutes' USING ERRCODE = 'MCP09'; END IF;
  IF c.scan_upper IS NULL THEN
    RETURN public._mcp_feed_step(v_ck, p_work_item_id, 'incremental', c.checkpoint - interval '15 minutes', '', z, NULL, c.checkpoint, p_limit);
  END IF;
  RETURN public._mcp_feed_step(v_ck, p_work_item_id, c.mode, c.scan_ts, c.scan_kind, c.scan_id, c.scan_upper, c.checkpoint, p_limit);
END $function$
;
CREATE OR REPLACE FUNCTION public.mcp_reconcile_updates(p_since timestamp with time zone, p_limit integer DEFAULT 100, p_work_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_since IS NULL OR p_since < now() - interval '400 days' OR p_since > now() THEN
    RAISE EXCEPTION 'RECONCILE_RANGE: reconcile_since debe estar dentro de 400 días' USING ERRCODE = 'MCP22'; END IF;
  RETURN public._mcp_feed_step(public._mcp_client_key(), p_work_item_id, 'reconcile', p_since, '',
    '00000000-0000-0000-0000-000000000000'::uuid, NULL, NULL, p_limit)
    || jsonb_build_object('reconcile_scope', 'Relee el estado ACTUAL de filas cuya revisión (updated_at) es posterior a reconcile_since (máximo 400 días). No es un historial ni una instantánea completa: revisiones intermedias, purgas definitivas y filas más antiguas que el límite no aparecen.');
END $function$
;

GRANT SELECT ON work_item_acts,work_item_publicaciones,work_item_sync_timeline,work_item_email_links TO authenticated;
GRANT SELECT,INSERT,DELETE ON mcp_feed_cursors TO authenticated;
ALTER TABLE mcp_feed_cursors ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON mcp_feed_cursors TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE work_item_acts ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON work_item_acts TO authenticated USING(EXISTS(SELECT 1 FROM work_items w WHERE w.id=work_item_id));
ALTER TABLE work_item_publicaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON work_item_publicaciones TO authenticated USING(EXISTS(SELECT 1 FROM work_items w WHERE w.id=work_item_id));
ALTER TABLE work_item_email_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON work_item_email_links TO authenticated USING(user_id=auth.uid());
-- Deliberately broader timeline visibility tests that the feed also joins visible matters.
ALTER TABLE work_item_sync_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY timeline_visible ON work_item_sync_timeline TO authenticated USING(true);
REVOKE ALL ON FUNCTION mcp_list_updates(text,integer,uuid),mcp_reconcile_updates(timestamptz,integer,uuid),mcp_list_email_questions(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mcp_list_updates(text,integer,uuid),mcp_reconcile_updates(timestamptz,integer,uuid),mcp_list_email_questions(text,integer) TO authenticated;
