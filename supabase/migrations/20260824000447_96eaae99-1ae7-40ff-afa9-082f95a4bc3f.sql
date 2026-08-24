-- ============ Fase 2, Migración 1: motor + estructura de overlays ============

-- 1.1 Anchor kind on rules (additive, behaviour-preserving default)
ALTER TABLE public.deadline_rules
  ADD COLUMN IF NOT EXISTS anchor_kind text NOT NULL DEFAULT 'ISSUANCE';
ALTER TABLE public.deadline_rules DROP CONSTRAINT IF EXISTS deadline_rules_anchor_kind_check;
ALTER TABLE public.deadline_rules ADD CONSTRAINT deadline_rules_anchor_kind_check
  CHECK (anchor_kind IN ('ISSUANCE','NOTIFICATION','TERM_EXPIRY','FACT_DATE','FILING_DATE'));

-- 1.2 YEARS support (caducidad 3 años, reloj de recurso 1 año)
ALTER TABLE public.deadline_rules DROP CONSTRAINT IF EXISTS deadline_rules_day_type_check;
ALTER TABLE public.deadline_rules ADD CONSTRAINT deadline_rules_day_type_check
  CHECK (day_type IN ('BUSINESS','CALENDAR','HOURS','MONTHS','YEARS'));

CREATE OR REPLACE FUNCTION public.compute_deadline_from_rule(p_anchor date, p_workflow text, p_deadline_type text)
 RETURNS TABLE(rule_id uuid, deadline_date date, day_type text, days_amount integer, norma text, requires_manual_review boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD; v_date DATE;
BEGIN
  SELECT * INTO r FROM public.deadline_rules
    WHERE workflow_type = p_workflow AND deadline_type = p_deadline_type AND is_active = true
    LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.requires_manual_review THEN
    RETURN QUERY SELECT r.id, NULL::DATE, r.day_type, r.days_amount, r.norma, true;
    RETURN;
  END IF;

  IF r.day_type = 'BUSINESS' THEN
    v_date := public.add_business_days_sql(p_anchor, r.days_amount, r.term_class);
  ELSIF r.day_type = 'CALENDAR' THEN
    v_date := p_anchor + r.days_amount;
  ELSIF r.day_type = 'MONTHS' THEN
    v_date := (p_anchor + (r.days_amount || ' months')::interval)::date;
  ELSIF r.day_type = 'YEARS' THEN
    v_date := (p_anchor + (r.days_amount || ' years')::interval)::date;
  ELSIF r.day_type = 'HOURS' THEN
    v_date := p_anchor + CEIL(r.days_amount::NUMERIC / 24)::INT;
  ELSE
    RETURN;
  END IF;

  IF v_date IS NULL OR NOT public.holiday_coverage_ok(p_anchor, v_date) THEN
    RETURN QUERY SELECT r.id, NULL::DATE, r.day_type, r.days_amount, r.norma, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT r.id, v_date, r.day_type, r.days_amount, r.norma, false;
END; $function$;

-- 1.3 Regime (overlay) catalogue -------------------------------------------
CREATE TABLE IF NOT EXISTS public.gov_procedure_regimes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  legal_basis text,
  verified boolean NOT NULL DEFAULT false,
  requires_manual_review boolean NOT NULL DEFAULT true,
  contested_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gov_regime_verified_needs_basis CHECK (verified = false OR legal_basis IS NOT NULL)
);
GRANT SELECT ON public.gov_procedure_regimes TO authenticated, anon;
GRANT ALL ON public.gov_procedure_regimes TO service_role;
ALTER TABLE public.gov_procedure_regimes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gov_regimes_read" ON public.gov_procedure_regimes;
CREATE POLICY "gov_regimes_read" ON public.gov_procedure_regimes FOR SELECT USING (true);
DROP POLICY IF EXISTS "gov_regimes_admin" ON public.gov_procedure_regimes;
CREATE POLICY "gov_regimes_admin" ON public.gov_procedure_regimes FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 1.4 Regime terms ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gov_procedure_regime_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regime_code text NOT NULL REFERENCES public.gov_procedure_regimes(code) ON DELETE CASCADE,
  deadline_type text NOT NULL,
  label text NOT NULL,
  duration_value integer,
  day_type text NOT NULL DEFAULT 'BUSINESS'
    CHECK (day_type IN ('BUSINESS','CALENDAR','MONTHS','YEARS')),
  term_class public.term_class NOT NULL DEFAULT 'ADMINISTRATIVO',
  anchor_kind text NOT NULL
    CHECK (anchor_kind IN ('ISSUANCE','NOTIFICATION','TERM_EXPIRY','FACT_DATE','FILING_DATE')),
  anchor_event_code text,
  max_extension_value integer,
  extension_condition text,
  norma text,
  requires_manual_review boolean NOT NULL DEFAULT false,
  is_background_timer boolean NOT NULL DEFAULT false,
  notes text,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (regime_code, deadline_type),
  CONSTRAINT gov_term_duration_or_review CHECK (
    requires_manual_review = true OR (duration_value IS NOT NULL AND duration_value > 0)
  ),
  CONSTRAINT gov_term_needs_norma CHECK (requires_manual_review = true OR norma IS NOT NULL)
);
GRANT SELECT ON public.gov_procedure_regime_terms TO authenticated, anon;
GRANT ALL ON public.gov_procedure_regime_terms TO service_role;
ALTER TABLE public.gov_procedure_regime_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gov_regime_terms_read" ON public.gov_procedure_regime_terms;
CREATE POLICY "gov_regime_terms_read" ON public.gov_procedure_regime_terms FOR SELECT USING (true);
DROP POLICY IF EXISTS "gov_regime_terms_admin" ON public.gov_procedure_regime_terms;
CREATE POLICY "gov_regime_terms_admin" ON public.gov_procedure_regime_terms FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 1.5 Regime stage applicability ------------------------------------------
CREATE TABLE IF NOT EXISTS public.gov_procedure_regime_stage_applicability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regime_code text NOT NULL REFERENCES public.gov_procedure_regimes(code) ON DELETE CASCADE,
  stage_code text NOT NULL,
  applicability text NOT NULL CHECK (applicability IN ('UNIVERSAL','CONDITIONAL','NOT_APPLICABLE')),
  label_override text,
  notes text,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (regime_code, stage_code)
);
GRANT SELECT ON public.gov_procedure_regime_stage_applicability TO authenticated, anon;
GRANT ALL ON public.gov_procedure_regime_stage_applicability TO service_role;
ALTER TABLE public.gov_procedure_regime_stage_applicability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gov_regime_stages_read" ON public.gov_procedure_regime_stage_applicability;
CREATE POLICY "gov_regime_stages_read" ON public.gov_procedure_regime_stage_applicability FOR SELECT USING (true);
DROP POLICY IF EXISTS "gov_regime_stages_admin" ON public.gov_procedure_regime_stage_applicability;
CREATE POLICY "gov_regime_stages_admin" ON public.gov_procedure_regime_stage_applicability FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- An overlay may never change stage identity or terminal classification:
-- every applicability row must point at an existing GOV_PROCEDURE catalog stage.
CREATE OR REPLACE FUNCTION public.gov_regime_stage_must_exist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_stages_global s
    WHERE s.workflow_type = 'GOV_PROCEDURE' AND s.code = NEW.stage_code AND s.active = true
  ) THEN
    RAISE EXCEPTION 'La etapa "%" no pertenece al catálogo de GOV_PROCEDURE; un régimen no puede crear etapas.', NEW.stage_code;
  END IF;
  RETURN NEW;
END; $function$;
DROP TRIGGER IF EXISTS trg_gov_regime_stage_must_exist ON public.gov_procedure_regime_stage_applicability;
CREATE TRIGGER trg_gov_regime_stage_must_exist
  BEFORE INSERT OR UPDATE ON public.gov_procedure_regime_stage_applicability
  FOR EACH ROW EXECUTE FUNCTION public.gov_regime_stage_must_exist();

-- 1.6 Per-work-item sanctioning state -------------------------------------
CREATE TABLE IF NOT EXISTS public.gov_procedure_work_item_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  owner_id uuid,
  regime_code text NOT NULL DEFAULT 'CPACA_GENERAL'
    REFERENCES public.gov_procedure_regimes(code),
  authority_name text,
  authority_email_domain text,
  authority_expediente text,
  fact_date date,
  conducta_continuada boolean NOT NULL DEFAULT false,
  cessation_date date,
  investigados_count integer,
  prueba_en_exterior boolean NOT NULL DEFAULT false,
  hubo_periodo_probatorio boolean NOT NULL DEFAULT false,
  sancion_notificada_at date,
  attention_status text CHECK (attention_status IS NULL OR attention_status IN
    ('NONE','MONITORING','ACTION_REQUIRED','MANUAL_REVIEW')),
  requires_manual_review boolean NOT NULL DEFAULT false,
  manual_review_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gov_state_continuada_needs_cessation CHECK (
    conducta_continuada = false OR cessation_date IS NOT NULL OR requires_manual_review = true
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gov_procedure_work_item_state TO authenticated;
GRANT ALL ON public.gov_procedure_work_item_state TO service_role;
ALTER TABLE public.gov_procedure_work_item_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gov_state_org_read" ON public.gov_procedure_work_item_state;
CREATE POLICY "gov_state_org_read" ON public.gov_procedure_work_item_state FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS "gov_state_org_write" ON public.gov_procedure_work_item_state;
CREATE POLICY "gov_state_org_write" ON public.gov_procedure_work_item_state FOR ALL TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());

-- 1.7 Notifications (the anchor of nearly every term) ---------------------
CREATE TABLE IF NOT EXISTS public.gov_procedure_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  owner_id uuid,
  acto_code text NOT NULL,
  modality text NOT NULL CHECK (modality IN ('PERSONAL','AVISO','ELECTRONICA','CONDUCTA_CONCLUYENTE')),
  issuance_date date,
  sent_date date,
  effective_date date,
  effective_date_confidence text NOT NULL DEFAULT 'DECLARED'
    CHECK (effective_date_confidence IN ('DECLARED','COMPUTED','UNKNOWN')),
  requires_manual_review boolean NOT NULL DEFAULT false,
  manual_review_reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'MANUAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_notifications_wi ON public.gov_procedure_notifications(work_item_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gov_procedure_notifications TO authenticated;
GRANT ALL ON public.gov_procedure_notifications TO service_role;
ALTER TABLE public.gov_procedure_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gov_notif_org_read" ON public.gov_procedure_notifications;
CREATE POLICY "gov_notif_org_read" ON public.gov_procedure_notifications FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS "gov_notif_org_write" ON public.gov_procedure_notifications;
CREATE POLICY "gov_notif_org_write" ON public.gov_procedure_notifications FOR ALL TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());

-- Non-personal modalities have modality-specific completion rules that are not
-- modelled yet: capture the declared date and force manual review (invariant 2).
CREATE OR REPLACE FUNCTION public.gov_notification_review_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.effective_date IS NULL THEN
    NEW.requires_manual_review := true;
    NEW.manual_review_reason := COALESCE(NEW.manual_review_reason,
      'Sin fecha de perfeccionamiento de la notificación');
  ELSIF NEW.modality <> 'PERSONAL' AND NEW.effective_date_confidence = 'DECLARED' THEN
    NEW.requires_manual_review := true;
    NEW.manual_review_reason := COALESCE(NEW.manual_review_reason,
      'Modalidad ' || NEW.modality || ': la fecha en que se entiende surtida la notificación requiere verificación');
  END IF;
  RETURN NEW;
END; $function$;
DROP TRIGGER IF EXISTS trg_gov_notification_review_guard ON public.gov_procedure_notifications;
CREATE TRIGGER trg_gov_notification_review_guard
  BEFORE INSERT OR UPDATE ON public.gov_procedure_notifications
  FOR EACH ROW EXECUTE FUNCTION public.gov_notification_review_guard();

-- 1.8 Recursos (each one carries its own 1-year clock, art. 52 inc. 2) -----
CREATE TABLE IF NOT EXISTS public.gov_procedure_recursos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  owner_id uuid,
  recurso_type text NOT NULL CHECK (recurso_type IN ('REPOSICION','APELACION','QUEJA')),
  filed_date date NOT NULL,
  filed_timely boolean NOT NULL DEFAULT true,
  resolved_date date,
  outcome text CHECK (outcome IS NULL OR outcome IN
    ('CONFIRMA','REVOCA','MODIFICA','RECHAZA','SILENCIO_POSITIVO')),
  deadline_id uuid REFERENCES public.work_item_deadlines(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_recursos_wi ON public.gov_procedure_recursos(work_item_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gov_procedure_recursos TO authenticated;
GRANT ALL ON public.gov_procedure_recursos TO service_role;
ALTER TABLE public.gov_procedure_recursos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gov_recursos_org_read" ON public.gov_procedure_recursos;
CREATE POLICY "gov_recursos_org_read" ON public.gov_procedure_recursos FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS "gov_recursos_org_write" ON public.gov_procedure_recursos;
CREATE POLICY "gov_recursos_org_write" ON public.gov_procedure_recursos FOR ALL TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());

-- 1.9 updated_at triggers
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gov_procedure_regimes','gov_procedure_regime_terms',
    'gov_procedure_regime_stage_applicability','gov_procedure_work_item_state',
    'gov_procedure_notifications','gov_procedure_recursos'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- 1.10 Linked-but-distinct proceedings
ALTER TABLE public.work_item_successions DROP CONSTRAINT IF EXISTS work_item_successions_relation_type_check;
ALTER TABLE public.work_item_successions ADD CONSTRAINT work_item_successions_relation_type_check
  CHECK (relation_type IN ('SEGUNDA_INSTANCIA','REMISION_COMPETENCIA','EJECUTIVO_CONTINUACION',
                           'CONFLICTO_COMPETENCIA','COBRO_COACTIVO','MEDIO_DE_CONTROL'));