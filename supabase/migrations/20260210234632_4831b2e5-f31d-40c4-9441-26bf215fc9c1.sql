
-- =====================================================
-- Provider AI Guide + Schema-Tolerant Ingestion Tables
-- =====================================================

-- 1) provider_ai_sessions: Tracks AI guide conversations per wizard run
CREATE TABLE public.provider_ai_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_user_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('PLATFORM', 'ORG')),
  wizard_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_ai_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read all AI sessions"
  ON public.provider_ai_sessions FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Org members can read their org AI sessions"
  ON public.provider_ai_sessions FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Authenticated users can create their own sessions"
  ON public.provider_ai_sessions FOR INSERT
  WITH CHECK (auth.uid() = actor_user_id);

-- 2) provider_ai_messages: Individual messages in AI guide sessions
CREATE TABLE public.provider_ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.provider_ai_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_ai_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read messages for sessions they can access"
  ON public.provider_ai_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_ai_sessions s
      WHERE s.id = session_id
      AND (public.is_platform_admin() OR public.is_org_member(s.organization_id))
    )
  );

CREATE POLICY "Authenticated users can insert messages"
  ON public.provider_ai_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provider_ai_sessions s
      WHERE s.id = session_id AND s.actor_user_id = auth.uid()
    )
  );

CREATE INDEX idx_provider_ai_messages_session ON public.provider_ai_messages(session_id, created_at);

-- 3) provider_raw_snapshots: Raw provider payloads for forensic/replay
CREATE TABLE public.provider_raw_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  work_item_id uuid NOT NULL,
  provider_instance_id uuid NOT NULL REFERENCES public.provider_instances(id),
  scope text NOT NULL CHECK (scope IN ('ACTS', 'PUBS', 'BOTH')),
  provider_case_id text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('OK', 'PENDING', 'EMPTY', 'ERROR')),
  normalized_error_code text
);

ALTER TABLE public.provider_raw_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read their snapshots"
  ON public.provider_raw_snapshots FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Service role inserts snapshots"
  ON public.provider_raw_snapshots FOR INSERT
  WITH CHECK (true);

CREATE INDEX idx_raw_snapshots_org_wi ON public.provider_raw_snapshots(organization_id, work_item_id, fetched_at DESC);
CREATE INDEX idx_raw_snapshots_instance ON public.provider_raw_snapshots(provider_instance_id, provider_case_id, fetched_at DESC);

-- 4) provider_mapping_specs: Deterministic mapping rules per connector
CREATE TABLE public.provider_mapping_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visibility text NOT NULL CHECK (visibility IN ('GLOBAL', 'ORG_PRIVATE')),
  organization_id uuid REFERENCES public.organizations(id),
  provider_connector_id uuid NOT NULL REFERENCES public.provider_connectors(id),
  schema_version text NOT NULL DEFAULT 'v1',
  scope text NOT NULL CHECK (scope IN ('ACTS', 'PUBS', 'BOTH')),
  spec jsonb NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'DEPRECATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_required_for_private CHECK (visibility = 'GLOBAL' OR organization_id IS NOT NULL)
);

ALTER TABLE public.provider_mapping_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage GLOBAL specs"
  ON public.provider_mapping_specs FOR ALL
  USING (visibility = 'GLOBAL' AND public.is_platform_admin());

CREATE POLICY "Org admins can manage ORG_PRIVATE specs"
  ON public.provider_mapping_specs FOR ALL
  USING (visibility = 'ORG_PRIVATE' AND public.is_org_admin(organization_id));

CREATE POLICY "Org members can read all visible specs"
  ON public.provider_mapping_specs FOR SELECT
  USING (
    visibility = 'GLOBAL'
    OR public.is_org_member(organization_id)
    OR public.is_platform_admin()
  );

CREATE UNIQUE INDEX idx_mapping_spec_active
  ON public.provider_mapping_specs(provider_connector_id, schema_version, scope)
  WHERE status = 'ACTIVE';

CREATE TRIGGER set_mapping_spec_updated_at
  BEFORE UPDATE ON public.provider_mapping_specs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Extras tables for unmapped fields (avoids touching canonical schema)
CREATE TABLE public.work_item_act_extras (
  work_item_act_id uuid PRIMARY KEY REFERENCES public.work_item_acts(id) ON DELETE CASCADE,
  extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_item_act_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read act extras"
  ON public.work_item_act_extras FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.work_item_acts a
      WHERE a.id = work_item_act_id
      AND public.is_org_member(a.organization_id)
    )
  );

CREATE POLICY "Service role inserts act extras"
  ON public.work_item_act_extras FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role updates act extras"
  ON public.work_item_act_extras FOR UPDATE
  USING (true);

CREATE TRIGGER set_act_extras_updated_at
  BEFORE UPDATE ON public.work_item_act_extras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.work_item_pub_extras (
  work_item_pub_id uuid PRIMARY KEY REFERENCES public.work_item_publicaciones(id) ON DELETE CASCADE,
  extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_item_pub_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read pub extras"
  ON public.work_item_pub_extras FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.work_item_publicaciones p
      WHERE p.id = work_item_pub_id
      AND public.is_org_member(p.organization_id)
    )
  );

CREATE POLICY "Service role inserts pub extras"
  ON public.work_item_pub_extras FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role updates pub extras"
  ON public.work_item_pub_extras FOR UPDATE
  USING (true);

CREATE TRIGGER set_pub_extras_updated_at
  BEFORE UPDATE ON public.work_item_pub_extras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
