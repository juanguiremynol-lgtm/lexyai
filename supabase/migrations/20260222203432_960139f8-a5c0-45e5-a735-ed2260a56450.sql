
-- ============================================================
-- HEARING CATALOG (Platform-level, managed by Super Admin)
-- ============================================================

CREATE TABLE public.hearing_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('CGP', 'CPACA', 'PENAL_906', 'LABORAL', 'TUTELA')),
  process_subtype TEXT,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  legal_basis TEXT,
  default_stage_order INTEGER NOT NULL DEFAULT 0,
  typical_purpose TEXT,
  typical_outputs TEXT[] DEFAULT '{}',
  typical_duration_minutes INTEGER,
  is_mandatory BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  needs_admin_review BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE public.hearing_flow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('CGP', 'CPACA', 'PENAL_906', 'LABORAL', 'TUTELA')),
  process_subtype TEXT,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE public.hearing_flow_template_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_template_id UUID NOT NULL REFERENCES public.hearing_flow_templates(id) ON DELETE CASCADE,
  hearing_type_id UUID NOT NULL REFERENCES public.hearing_types(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  is_checkpoint BOOLEAN DEFAULT false,
  checkpoint_label TEXT,
  is_optional BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (flow_template_id, step_order)
);

-- ============================================================
-- WORK ITEM HEARINGS (per work item, per tenant)
-- ============================================================

CREATE TABLE public.work_item_hearings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  hearing_type_id UUID REFERENCES public.hearing_types(id) ON DELETE SET NULL,
  custom_name TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'scheduled', 'held', 'postponed', 'cancelled')),
  postponed_to_id UUID REFERENCES public.work_item_hearings(id),
  scheduled_at TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  modality TEXT CHECK (modality IN ('presencial', 'virtual', 'mixta')),
  location TEXT,
  meeting_link TEXT,
  participants JSONB NOT NULL DEFAULT '[]',
  decisions_summary TEXT,
  notes_rich_text TEXT,
  notes_plain_text TEXT,
  key_moments JSONB NOT NULL DEFAULT '[]',
  flow_order INTEGER,
  tags TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.hearing_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  work_item_hearing_id UUID NOT NULL REFERENCES public.work_item_hearings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('transcript', 'excerpt', 'audio', 'screenshot', 'acta', 'auto', 'other')),
  storage_type TEXT NOT NULL CHECK (storage_type IN ('internal_upload', 'external_link')),
  storage_path TEXT,
  filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  file_hash TEXT,
  external_url TEXT,
  external_provider TEXT,
  title TEXT,
  extracted_text TEXT,
  access_policy TEXT NOT NULL DEFAULT 'team_only' CHECK (access_policy IN ('team_only', 'shareable_link')),
  shareable_link_expiry TIMESTAMPTZ,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.hearing_ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  work_item_hearing_id UUID NOT NULL REFERENCES public.work_item_hearings(id) ON DELETE CASCADE,
  authorized_by UUID NOT NULL REFERENCES auth.users(id),
  input_summary JSONB NOT NULL,
  model_id TEXT NOT NULL,
  gaps_to_verify JSONB NOT NULL DEFAULT '[]',
  points_of_interest JSONB NOT NULL DEFAULT '[]',
  follow_up_questions JSONB NOT NULL DEFAULT '[]',
  suggested_prompt_template TEXT,
  raw_response JSONB,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.hearing_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN (
    'hearing_created', 'hearing_updated', 'hearing_status_changed',
    'hearing_deleted', 'hearing_reordered',
    'artifact_uploaded', 'artifact_removed', 'artifact_link_added',
    'ai_authorized', 'ai_insight_generated', 'ai_insight_deleted',
    'key_moment_added', 'key_moment_removed',
    'task_spawned_from_hearing',
    'digest_exported'
  )),
  work_item_id UUID,
  work_item_hearing_id UUID,
  hearing_artifact_id UUID,
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.hearing_tenant_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  max_storage_per_hearing_mb INTEGER NOT NULL DEFAULT 200,
  allowed_file_types TEXT[] NOT NULL DEFAULT ARRAY['pdf', 'docx', 'txt', 'mp3', 'm4a', 'mp4', 'png', 'jpg'],
  max_file_size_mb INTEGER NOT NULL DEFAULT 50,
  ai_insights_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_generate_hearing_flow BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id)
);

CREATE TABLE public.hearing_user_ai_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, organization_id)
);

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE public.hearing_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hearing_flow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hearing_flow_template_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_item_hearings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hearing_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hearing_ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hearing_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hearing_tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hearing_user_ai_prefs ENABLE ROW LEVEL SECURITY;

-- Catalog: read for authenticated, write for platform admins
CREATE POLICY "anyone reads active hearing types" ON public.hearing_types
  FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "admins manage hearing types" ON public.hearing_types
  FOR ALL TO authenticated USING (public.is_platform_admin());

CREATE POLICY "anyone reads active flow templates" ON public.hearing_flow_templates
  FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "admins manage flow templates" ON public.hearing_flow_templates
  FOR ALL TO authenticated USING (public.is_platform_admin());

CREATE POLICY "read flow steps" ON public.hearing_flow_template_steps
  FOR SELECT TO authenticated USING (
    flow_template_id IN (SELECT id FROM public.hearing_flow_templates WHERE is_active = true)
  );
CREATE POLICY "admins manage flow steps" ON public.hearing_flow_template_steps
  FOR ALL TO authenticated USING (public.is_platform_admin());

-- Work item hearings: org membership via organization_memberships
CREATE POLICY "org members access hearings" ON public.work_item_hearings
  FOR ALL TO authenticated USING (
    organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "org members access artifacts" ON public.hearing_artifacts
  FOR ALL TO authenticated USING (
    organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "org members read ai insights" ON public.hearing_ai_insights
  FOR SELECT TO authenticated USING (
    organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "org members insert ai insights" ON public.hearing_ai_insights
  FOR INSERT TO authenticated WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "org admins manage tenant config" ON public.hearing_tenant_config
  FOR ALL TO authenticated USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  );

CREATE POLICY "users manage own ai prefs" ON public.hearing_user_ai_prefs
  FOR ALL TO authenticated USING (user_id = auth.uid());

CREATE POLICY "org members read audit log" ON public.hearing_audit_log
  FOR SELECT TO authenticated USING (
    organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "org members insert audit log" ON public.hearing_audit_log
  FOR INSERT TO authenticated WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_hearing_types_jurisdiction ON public.hearing_types (jurisdiction, process_subtype) WHERE is_active = true;
CREATE INDEX idx_flow_templates_jurisdiction ON public.hearing_flow_templates (jurisdiction, process_subtype) WHERE is_active = true;
CREATE INDEX idx_flow_steps_template ON public.hearing_flow_template_steps (flow_template_id, step_order);
CREATE INDEX idx_wih_work_item ON public.work_item_hearings (work_item_id, flow_order);
CREATE INDEX idx_wih_org ON public.work_item_hearings (organization_id);
CREATE INDEX idx_wih_status ON public.work_item_hearings (work_item_id, status);
CREATE INDEX idx_wih_scheduled ON public.work_item_hearings (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_ha_hearing ON public.hearing_artifacts (work_item_hearing_id);
CREATE INDEX idx_hai_hearing ON public.hearing_ai_insights (work_item_hearing_id) WHERE is_deleted = false;
CREATE INDEX idx_hal_org ON public.hearing_audit_log (organization_id, created_at DESC);
CREATE INDEX idx_wih_notes_search ON public.work_item_hearings
  USING gin(to_tsvector('spanish', COALESCE(notes_plain_text, '') || ' ' || COALESCE(decisions_summary, '')));

-- ============================================================
-- STORAGE BUCKET
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hearing-artifacts', 'hearing-artifacts', false, 52428800,
  ARRAY['application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'image/png', 'image/jpeg']
);

CREATE POLICY "org members upload hearing artifacts" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'hearing-artifacts');
CREATE POLICY "org members read hearing artifacts" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'hearing-artifacts');
CREATE POLICY "org members delete hearing artifacts" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'hearing-artifacts');

-- ============================================================
-- SEED: Colombian Hearing Catalog
-- ============================================================

INSERT INTO public.hearing_types (jurisdiction, process_subtype, name, short_name, aliases, legal_basis, default_stage_order, typical_purpose, typical_outputs, is_mandatory) VALUES
('CGP', 'declarativo', 'Audiencia Inicial (Art. 372 CGP)', 'Audiencia Inicial',
  ARRAY['audiencia del 372', 'audiencia de saneamiento', 'audiencia de conciliación inicial'],
  'Art. 372 CGP', 10,
  'Saneamiento del proceso, fijación del litigio, conciliación, decreto de pruebas, interrogatorio de partes',
  ARRAY['auto_interlocutorio', 'acta', 'grabacion'], true),
('CGP', 'declarativo', 'Audiencia de Instrucción y Juzgamiento (Art. 373 CGP)', 'Instrucción y Juzgamiento',
  ARRAY['audiencia del 373', 'audiencia de juzgamiento', 'audiencia de instrucción'],
  'Art. 373 CGP', 20,
  'Práctica de pruebas, alegatos de conclusión, sentencia',
  ARRAY['auto_interlocutorio', 'sentencia', 'acta', 'grabacion'], true),
('CGP', 'ejecutivo', 'Audiencia de Conciliación y Decisión de Excepciones', 'Audiencia Ejecutivo',
  ARRAY['audiencia de excepciones ejecutivo', 'audiencia 443'],
  'Art. 443 CGP', 10,
  'Conciliación, decisión sobre excepciones de mérito',
  ARRAY['auto_interlocutorio', 'sentencia', 'acta'], true),
('CGP', 'verbal_sumario', 'Audiencia Única (Art. 392 CGP)', 'Audiencia Única',
  ARRAY['audiencia del verbal sumario', 'audiencia concentrada'],
  'Art. 392 CGP', 10,
  'Saneamiento, fijación del litigio, pruebas, alegatos y sentencia en una sola audiencia',
  ARRAY['sentencia', 'acta', 'grabacion'], true);

INSERT INTO public.hearing_types (jurisdiction, process_subtype, name, short_name, aliases, legal_basis, default_stage_order, typical_purpose, typical_outputs, is_mandatory) VALUES
('CPACA', NULL, 'Audiencia Inicial (Art. 180 CPACA)', 'Audiencia Inicial CPACA',
  ARRAY['audiencia del 180', 'audiencia inicial contencioso'],
  'Art. 180 CPACA', 10,
  'Saneamiento, fijación del litigio, posibilidad de conciliación, decreto de pruebas',
  ARRAY['auto_interlocutorio', 'acta', 'grabacion'], true),
('CPACA', NULL, 'Audiencia de Pruebas (Art. 181 CPACA)', 'Audiencia de Pruebas CPACA',
  ARRAY['audiencia del 181', 'práctica de pruebas contencioso'],
  'Art. 181 CPACA', 20,
  'Práctica de pruebas decretadas',
  ARRAY['acta', 'grabacion', 'dictamen'], true),
('CPACA', NULL, 'Audiencia de Alegaciones y Juzgamiento (Art. 182 CPACA)', 'Alegaciones y Juzgamiento',
  ARRAY['audiencia del 182', 'alegatos contencioso', 'juzgamiento CPACA'],
  'Art. 182 CPACA', 30,
  'Alegatos de conclusión y sentencia',
  ARRAY['sentencia', 'acta', 'grabacion'], true);

INSERT INTO public.hearing_types (jurisdiction, process_subtype, name, short_name, aliases, legal_basis, default_stage_order, typical_purpose, typical_outputs, is_mandatory) VALUES
('PENAL_906', NULL, 'Audiencia de Formulación de Imputación', 'Imputación',
  ARRAY['imputación', 'formulación de cargos inicial'],
  'Art. 286-294 Ley 906', 10,
  'La Fiscalía comunica formalmente al investigado los hechos jurídicamente relevantes',
  ARRAY['acta', 'grabacion'], true),
('PENAL_906', NULL, 'Audiencia de Solicitud de Medida de Aseguramiento', 'Medida de Aseguramiento',
  ARRAY['medida de aseguramiento', 'detención preventiva'],
  'Art. 306-320 Ley 906', 15,
  'Solicitud de medida cautelar personal por la Fiscalía',
  ARRAY['auto_interlocutorio', 'acta'], false),
('PENAL_906', NULL, 'Audiencia de Formulación de Acusación', 'Acusación',
  ARRAY['acusación', 'formulación de acusación'],
  'Art. 336-343 Ley 906', 20,
  'Presentación formal del escrito de acusación por la Fiscalía',
  ARRAY['acta', 'grabacion'], true),
('PENAL_906', NULL, 'Audiencia Preparatoria', 'Preparatoria',
  ARRAY['audiencia preparatoria penal', 'preparatoria del juicio oral'],
  'Art. 355-365 Ley 906', 30,
  'Descubrimiento probatorio, solicitud y decreto de pruebas, estipulaciones',
  ARRAY['auto_interlocutorio', 'acta', 'grabacion'], true),
('PENAL_906', NULL, 'Audiencia de Juicio Oral', 'Juicio Oral',
  ARRAY['juicio oral', 'audiencia de juicio', 'juicio público'],
  'Art. 366-397 Ley 906', 40,
  'Práctica de pruebas, interrogatorios, contrainterrogatorios, alegatos',
  ARRAY['acta', 'grabacion'], true),
('PENAL_906', NULL, 'Audiencia de Lectura de Fallo', 'Lectura de Fallo',
  ARRAY['sentido del fallo', 'lectura de sentencia penal'],
  'Art. 446-448 Ley 906', 50,
  'Lectura del sentido del fallo (absolución o condena)',
  ARRAY['sentencia', 'acta', 'grabacion'], true),
('PENAL_906', NULL, 'Audiencia de Individualización de Pena y Sentencia', 'Individualización de Pena',
  ARRAY['dosificación de pena', 'individualización penal'],
  'Art. 446-448 Ley 906', 55,
  'Determinación de la pena concreta e incidentes de reparación',
  ARRAY['sentencia', 'acta'], true);

INSERT INTO public.hearing_types (jurisdiction, process_subtype, name, short_name, aliases, legal_basis, default_stage_order, typical_purpose, typical_outputs, is_mandatory) VALUES
('LABORAL', NULL, 'Audiencia de Conciliación, Decisión de Excepciones, Saneamiento y Fijación del Litigio', 'Audiencia Obligatoria de Conciliación',
  ARRAY['audiencia de conciliación laboral', 'primera audiencia laboral', 'audiencia del 77'],
  'Art. 77 CPT y SS', 10,
  'Conciliación obligatoria, excepciones previas, saneamiento, fijación del litigio, decreto de pruebas',
  ARRAY['auto_interlocutorio', 'acta', 'grabacion'], true),
('LABORAL', NULL, 'Audiencia de Trámite y Juzgamiento', 'Trámite y Juzgamiento Laboral',
  ARRAY['segunda audiencia laboral', 'audiencia de juzgamiento laboral', 'audiencia del 80'],
  'Art. 80 CPT y SS', 20,
  'Práctica de pruebas, alegatos y sentencia',
  ARRAY['sentencia', 'acta', 'grabacion'], true);

INSERT INTO public.hearing_types (jurisdiction, process_subtype, name, short_name, aliases, legal_basis, default_stage_order, typical_purpose, typical_outputs, is_mandatory, needs_admin_review) VALUES
('TUTELA', NULL, 'Audiencia de Pacto de Cumplimiento (si aplica)', 'Pacto de Cumplimiento Tutela',
  ARRAY['audiencia tutela', 'audiencia de pruebas tutela'],
  'Decreto 2591/1991', 10,
  'Práctica de pruebas o audiencia especial en tutela (infrecuente; la mayoría se decide por escrito)',
  ARRAY['acta'], false, true),
('CGP', NULL, 'Audiencia de Conciliación Extrajudicial', 'Conciliación Extrajudicial',
  ARRAY['conciliación prejudicial', 'conciliación extrajudicial'],
  'Ley 640/2001', 0,
  'Requisito de procedibilidad en ciertos procesos; intento de conciliación antes de demandar',
  ARRAY['acta_conciliacion', 'constancia_no_acuerdo'], false, true),
('LABORAL', NULL, 'Audiencia de Conciliación Extrajudicial', 'Conciliación Extrajudicial Laboral',
  ARRAY['conciliación prejudicial laboral'],
  'Art. 28 CPT y SS', 0,
  'Requisito de procedibilidad: intento de conciliación antes de demandar',
  ARRAY['acta_conciliacion', 'constancia_no_acuerdo'], false, true);

-- ============================================================
-- DEFAULT FLOW TEMPLATES
-- ============================================================

INSERT INTO public.hearing_flow_templates (jurisdiction, process_subtype, name, is_default) VALUES
('CGP', 'declarativo', 'Proceso Declarativo CGP (Estándar)', true),
('CGP', 'ejecutivo', 'Proceso Ejecutivo CGP (Estándar)', true),
('CGP', 'verbal_sumario', 'Proceso Verbal Sumario CGP (Estándar)', true),
('CPACA', NULL, 'Proceso Contencioso Administrativo (Estándar)', true),
('PENAL_906', NULL, 'Proceso Penal Acusatorio Ley 906 (Estándar)', true),
('LABORAL', NULL, 'Proceso Laboral (Estándar)', true);

-- Link steps for each flow template
INSERT INTO public.hearing_flow_template_steps (flow_template_id, hearing_type_id, step_order, is_optional)
SELECT ft.id, ht.id, ht.default_stage_order, NOT ht.is_mandatory
FROM public.hearing_flow_templates ft
JOIN public.hearing_types ht ON ht.jurisdiction = ft.jurisdiction
  AND COALESCE(ht.process_subtype, '') = COALESCE(ft.process_subtype, '')
WHERE ft.is_default = true AND ht.is_active = true AND ht.default_stage_order > 0
ORDER BY ft.id, ht.default_stage_order;

-- ============================================================
-- AUTO-GENERATION TRIGGER (safe wrapper)
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_generate_hearing_flow()
RETURNS TRIGGER AS $$
DECLARE
  flow_id UUID;
  tenant_config RECORD;
BEGIN
  BEGIN
    IF NEW.workflow_type IN ('PETICION', 'TUTELA') THEN
      RETURN NEW;
    END IF;

    SELECT * INTO tenant_config FROM public.hearing_tenant_config
    WHERE organization_id = NEW.organization_id;

    IF tenant_config IS NULL OR tenant_config.auto_generate_hearing_flow = true THEN
      SELECT id INTO flow_id FROM public.hearing_flow_templates
      WHERE jurisdiction = NEW.workflow_type
        AND is_default = true AND is_active = true
      ORDER BY process_subtype NULLS LAST
      LIMIT 1;

      IF flow_id IS NOT NULL THEN
        INSERT INTO public.work_item_hearings (
          organization_id, work_item_id, hearing_type_id, status, flow_order, created_by
        )
        SELECT
          NEW.organization_id, NEW.id, fts.hearing_type_id,
          'planned', fts.step_order, NEW.owner_id
        FROM public.hearing_flow_template_steps fts
        WHERE fts.flow_template_id = flow_id
        ORDER BY fts.step_order;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] auto_generate_hearing_flow failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    BEGIN
      INSERT INTO public.trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
      VALUES ('auto_generate_hearing_flow', 'work_items', SQLERRM, SQLSTATE, NEW.id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_generate_hearing_flow
  AFTER INSERT ON public.work_items
  FOR EACH ROW
  WHEN (NEW.workflow_type IS NOT NULL)
  EXECUTE FUNCTION public.auto_generate_hearing_flow();
