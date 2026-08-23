-- ============================================================
-- FASE 1 · §3 — Multidimensional workflow / stage catalog
-- ============================================================

-- 3.1 Workflow definitions ---------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL UNIQUE,
  label text NOT NULL,
  catalog_governed boolean NOT NULL DEFAULT false,
  legal_basis text,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workflow_definitions TO authenticated, anon;
GRANT ALL ON public.workflow_definitions TO service_role;
ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workflow_definitions_read" ON public.workflow_definitions;
CREATE POLICY "workflow_definitions_read" ON public.workflow_definitions FOR SELECT USING (true);
DROP POLICY IF EXISTS "workflow_definitions_admin" ON public.workflow_definitions;
CREATE POLICY "workflow_definitions_admin" ON public.workflow_definitions FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 3.2 Stage catalog (global) -------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_stages_global (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_terminal boolean NOT NULL DEFAULT false,
  is_procedurally_live boolean NOT NULL DEFAULT true,
  expected_next_event text,
  legal_basis text,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_type, code)
);
GRANT SELECT ON public.workflow_stages_global TO authenticated, anon;
GRANT ALL ON public.workflow_stages_global TO service_role;
ALTER TABLE public.workflow_stages_global ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workflow_stages_global_read" ON public.workflow_stages_global;
CREATE POLICY "workflow_stages_global_read" ON public.workflow_stages_global FOR SELECT USING (true);
DROP POLICY IF EXISTS "workflow_stages_global_admin" ON public.workflow_stages_global;
CREATE POLICY "workflow_stages_global_admin" ON public.workflow_stages_global FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 3.3 Stage overrides (labels / ordering / alert prefs ONLY) ------
CREATE TABLE IF NOT EXISTS public.workflow_stages_org_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  stage_id uuid NOT NULL REFERENCES public.workflow_stages_global(id) ON DELETE CASCADE,
  label text,
  display_order integer,
  alert_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, stage_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_stages_org_override TO authenticated;
GRANT ALL ON public.workflow_stages_org_override TO service_role;
ALTER TABLE public.workflow_stages_org_override ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_override_org_read" ON public.workflow_stages_org_override;
CREATE POLICY "stage_override_org_read" ON public.workflow_stages_org_override FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "stage_override_org_write" ON public.workflow_stages_org_override;
CREATE POLICY "stage_override_org_write" ON public.workflow_stages_org_override FOR ALL TO authenticated
  USING (organization_id = public.get_user_organization_id() OR public.is_platform_admin())
  WITH CHECK (organization_id = public.get_user_organization_id() OR public.is_platform_admin());

-- 3.4 Allowed transitions -----------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_stage_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL,
  from_stage_code text NOT NULL,
  to_stage_code text NOT NULL,
  allowed_by_suggestion boolean NOT NULL DEFAULT false,
  requires_explicit_user_action boolean NOT NULL DEFAULT true,
  is_regression_allowed boolean NOT NULL DEFAULT false,
  legal_basis text,
  notes text,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_type, from_stage_code, to_stage_code)
);
GRANT SELECT ON public.workflow_stage_transitions TO authenticated, anon;
GRANT ALL ON public.workflow_stage_transitions TO service_role;
ALTER TABLE public.workflow_stage_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workflow_transitions_read" ON public.workflow_stage_transitions;
CREATE POLICY "workflow_transitions_read" ON public.workflow_stage_transitions FOR SELECT USING (true);
DROP POLICY IF EXISTS "workflow_transitions_admin" ON public.workflow_stage_transitions;
CREATE POLICY "workflow_transitions_admin" ON public.workflow_stage_transitions FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 3.5 Event vocabulary --------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_event_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  event_kind text NOT NULL DEFAULT 'PROCEDURAL'
    CHECK (event_kind IN ('PROCEDURAL','SYSTEM','ADMINISTRATIVE','NOISE')),
  is_excluded_from_inference boolean NOT NULL DEFAULT false,
  legal_basis text,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_type, code)
);
GRANT SELECT ON public.workflow_event_catalog TO authenticated, anon;
GRANT ALL ON public.workflow_event_catalog TO service_role;
ALTER TABLE public.workflow_event_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workflow_event_catalog_read" ON public.workflow_event_catalog;
CREATE POLICY "workflow_event_catalog_read" ON public.workflow_event_catalog FOR SELECT USING (true);
DROP POLICY IF EXISTS "workflow_event_catalog_admin" ON public.workflow_event_catalog;
CREATE POLICY "workflow_event_catalog_admin" ON public.workflow_event_catalog FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TABLE IF NOT EXISTS public.workflow_event_stage_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL,
  event_code text NOT NULL,
  pattern_regex text,
  pattern_keywords text[] NOT NULL DEFAULT '{}',
  base_confidence numeric NOT NULL DEFAULT 0.5 CHECK (base_confidence >= 0 AND base_confidence <= 1),
  priority integer NOT NULL DEFAULT 100,
  suggested_stage_code text,
  is_excluded boolean NOT NULL DEFAULT false,
  notes text,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workflow_event_stage_patterns TO authenticated, anon;
GRANT ALL ON public.workflow_event_stage_patterns TO service_role;
ALTER TABLE public.workflow_event_stage_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workflow_event_patterns_read" ON public.workflow_event_stage_patterns;
CREATE POLICY "workflow_event_patterns_read" ON public.workflow_event_stage_patterns FOR SELECT USING (true);
DROP POLICY IF EXISTS "workflow_event_patterns_admin" ON public.workflow_event_stage_patterns;
CREATE POLICY "workflow_event_patterns_admin" ON public.workflow_event_stage_patterns FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 3.6 updated_at triggers ------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflow_definitions','workflow_stages_global','workflow_stages_org_override',
    'workflow_stage_transitions','workflow_event_catalog','workflow_event_stage_patterns'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- 3.7 Suggestion chain: nullable catalog FK -------------------------
ALTER TABLE public.work_item_stage_suggestions
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.workflow_stages_global(id);

-- 3.8 Fail-closed stage guard (catalog-governed workflows only) -----
CREATE OR REPLACE FUNCTION public.enforce_catalog_stage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_governed boolean;
BEGIN
  IF NEW.stage IS NULL OR NEW.workflow_type IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage
     AND NEW.workflow_type IS NOT DISTINCT FROM OLD.workflow_type THEN
    RETURN NEW;
  END IF;

  SELECT catalog_governed INTO v_governed
  FROM public.workflow_definitions
  WHERE workflow_type = NEW.workflow_type::text AND active = true;

  IF COALESCE(v_governed, false) = false THEN
    RETURN NEW; -- pass-through for every non catalog-governed workflow
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_stages_global s
    WHERE s.workflow_type = NEW.workflow_type::text
      AND s.code = NEW.stage AND s.active = true
  ) THEN
    RAISE EXCEPTION 'Etapa "%" no pertenece al catálogo de % (flujo gobernado por catálogo).',
      NEW.stage, NEW.workflow_type;
  END IF;

  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_enforce_catalog_stage ON public.work_items;
CREATE TRIGGER trg_enforce_catalog_stage
  BEFORE INSERT OR UPDATE OF stage, workflow_type ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_catalog_stage();

-- 3.9 Deadline dimensions (additive) --------------------------------
ALTER TABLE public.work_item_deadlines
  ADD COLUMN IF NOT EXISTS term_class public.term_class NOT NULL DEFAULT 'JUDICIAL',
  ADD COLUMN IF NOT EXISTS anchor_kind text,
  ADD COLUMN IF NOT EXISTS anchor_source text,
  ADD COLUMN IF NOT EXISTS anchor_provenance_note text,
  ADD COLUMN IF NOT EXISTS supersedes_deadline_id uuid REFERENCES public.work_item_deadlines(id),
  ADD COLUMN IF NOT EXISTS deadline_status text,
  ADD COLUMN IF NOT EXISTS extension_validity text,
  ADD COLUMN IF NOT EXISTS legal_effect text,
  ADD COLUMN IF NOT EXISTS requires_manual_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.work_item_deadlines
  DROP CONSTRAINT IF EXISTS work_item_deadlines_deadline_status_chk;
ALTER TABLE public.work_item_deadlines
  ADD CONSTRAINT work_item_deadlines_deadline_status_chk
  CHECK (deadline_status IS NULL OR deadline_status IN
    ('VIGENTE','PROXIMO','OVERDUE','SUSPENDIDO','SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO'));

ALTER TABLE public.work_item_deadlines
  DROP CONSTRAINT IF EXISTS work_item_deadlines_extension_validity_chk;
ALTER TABLE public.work_item_deadlines
  ADD CONSTRAINT work_item_deadlines_extension_validity_chk
  CHECK (extension_validity IS NULL OR extension_validity IN
    ('VALID','LATE','EXCEEDS_CAP','INCOMPLETE','MANUAL_REVIEW'));

-- 3.10 PETICION subtype catalog --------------------------------------
CREATE TABLE IF NOT EXISTS public.peticion_subtypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  duration_value integer,
  duration_unit text NOT NULL DEFAULT 'BUSINESS_DAYS'
    CHECK (duration_unit IN ('BUSINESS_DAYS','CALENDAR_DAYS','MONTHS')),
  term_class public.term_class NOT NULL DEFAULT 'ADMINISTRATIVO',
  legal_basis text NOT NULL,
  requires_user_term boolean NOT NULL DEFAULT false,
  requires_silence_effect boolean NOT NULL DEFAULT false,
  default_silence_effect text NOT NULL DEFAULT 'NEGATIVE_GENERAL'
    CHECK (default_silence_effect IN ('NEGATIVE_GENERAL','POSITIVE_SPECIAL','NEGATIVE_SPECIAL','NONE','MANUAL_REVIEW')),
  allows_org_duration_override boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peticion_subtypes_term_present
    CHECK (requires_user_term = true OR duration_value > 0)
);
GRANT SELECT ON public.peticion_subtypes TO authenticated, anon;
GRANT ALL ON public.peticion_subtypes TO service_role;
ALTER TABLE public.peticion_subtypes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "peticion_subtypes_read" ON public.peticion_subtypes;
CREATE POLICY "peticion_subtypes_read" ON public.peticion_subtypes FOR SELECT USING (true);
DROP POLICY IF EXISTS "peticion_subtypes_admin" ON public.peticion_subtypes;
CREATE POLICY "peticion_subtypes_admin" ON public.peticion_subtypes FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP TRIGGER IF EXISTS trg_peticion_subtypes_updated_at ON public.peticion_subtypes;
CREATE TRIGGER trg_peticion_subtypes_updated_at BEFORE UPDATE ON public.peticion_subtypes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3.11 Per-work-item PETICION state (parallel dimensions) -------------
CREATE TABLE IF NOT EXISTS public.peticion_work_item_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  owner_id uuid,
  subtype_code text NOT NULL REFERENCES public.peticion_subtypes(code),
  is_inter_authority boolean NOT NULL DEFAULT false,
  special_norm_citation text,
  special_term_value integer,
  special_term_unit text CHECK (special_term_unit IS NULL OR special_term_unit IN ('BUSINESS_DAYS','CALENDAR_DAYS','MONTHS')),
  special_legal_basis text,
  silence_effect text NOT NULL DEFAULT 'NEGATIVE_GENERAL'
    CHECK (silence_effect IN ('NEGATIVE_GENERAL','POSITIVE_SPECIAL','NEGATIVE_SPECIAL','NONE','MANUAL_REVIEW')),
  sent_at date,
  authority_received_at date,
  competent_authority_received_at date,
  anchor_source text CHECK (anchor_source IS NULL OR anchor_source IN
    ('AUTHORITY_RECEIPT','SEND_DATE','COMPETENT_AUTHORITY_RECEIPT','MANUAL')),
  anchor_provenance_note text,
  authority_name text,
  authority_email_domain text,
  authority_radicado text,
  deadline_status text,
  legal_effect text,
  attention_status text CHECK (attention_status IS NULL OR attention_status IN
    ('NONE','MONITORING','ACTION_REQUIRED','MANUAL_REVIEW')),
  requires_manual_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peticion_state_special_norm_complete CHECK (
    subtype_code <> 'NORMA_ESPECIAL'
    OR (special_norm_citation IS NOT NULL AND special_term_value > 0
        AND special_term_unit IS NOT NULL AND special_legal_basis IS NOT NULL)
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.peticion_work_item_state TO authenticated;
GRANT ALL ON public.peticion_work_item_state TO service_role;
ALTER TABLE public.peticion_work_item_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "peticion_state_org_read" ON public.peticion_work_item_state;
CREATE POLICY "peticion_state_org_read" ON public.peticion_work_item_state FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS "peticion_state_org_write" ON public.peticion_work_item_state;
CREATE POLICY "peticion_state_org_write" ON public.peticion_work_item_state FOR ALL TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());

DROP TRIGGER IF EXISTS trg_peticion_state_updated_at ON public.peticion_work_item_state;
CREATE TRIGGER trg_peticion_state_updated_at BEFORE UPDATE ON public.peticion_work_item_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3.12 PETICION event ledger (EVENT dimension) -------------------------
CREATE TABLE IF NOT EXISTS public.peticion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  owner_id uuid,
  event_code text NOT NULL,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  source text NOT NULL DEFAULT 'SYSTEM'
    CHECK (source IN ('SYSTEM','USER','EMAIL_EVIDENCE','IMPORT')),
  deadline_id uuid REFERENCES public.work_item_deadlines(id),
  legal_effect text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, event_code, event_date, deadline_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.peticion_events TO authenticated;
GRANT ALL ON public.peticion_events TO service_role;
ALTER TABLE public.peticion_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "peticion_events_org_read" ON public.peticion_events;
CREATE POLICY "peticion_events_org_read" ON public.peticion_events FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS "peticion_events_org_write" ON public.peticion_events;
CREATE POLICY "peticion_events_org_write" ON public.peticion_events FOR ALL TO authenticated
  USING (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (organization_id = public.get_user_organization_id() OR owner_id = auth.uid() OR public.is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_peticion_events_wi ON public.peticion_events(work_item_id, event_date DESC);