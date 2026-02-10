
-- ============================================================
-- External Provider Connector System — Schema Migration
-- ============================================================

-- 1) Enums
DO $$ BEGIN
  CREATE TYPE provider_auth_type AS ENUM ('API_KEY', 'HMAC_SHARED_SECRET');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE work_item_source_status AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE work_item_source_scrape_status AS ENUM ('OK', 'SCRAPING_PENDING', 'EMPTY', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Global connector templates (superadmin-owned)
CREATE TABLE IF NOT EXISTS public.provider_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  schema_version text NOT NULL DEFAULT 'atenia.v1',
  capabilities text[] NOT NULL DEFAULT '{}',
  allowed_domains text[] NOT NULL DEFAULT '{}',
  is_enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_connectors_enabled_idx
  ON public.provider_connectors (is_enabled);

-- 3) Org-scoped provider instances
CREATE TABLE IF NOT EXISTS public.provider_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  connector_id uuid NOT NULL REFERENCES public.provider_connectors(id) ON DELETE RESTRICT,
  name text NOT NULL,
  base_url text NOT NULL,
  auth_type provider_auth_type NOT NULL,
  timeout_ms int NOT NULL DEFAULT 8000,
  rpm_limit int NOT NULL DEFAULT 60,
  is_enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS provider_instances_org_idx
  ON public.provider_instances (organization_id);

-- 4) Secrets (deny-all RLS; only service_role reads/writes)
CREATE TABLE IF NOT EXISTS public.provider_instance_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_instance_id uuid NOT NULL REFERENCES public.provider_instances(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  key_version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  cipher_text bytea NOT NULL,
  nonce bytea NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  UNIQUE (provider_instance_id, key_version)
);

-- Partial unique index: only one active secret per instance
CREATE UNIQUE INDEX IF NOT EXISTS provider_instance_secrets_active_uniq
  ON public.provider_instance_secrets (provider_instance_id) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS provider_instance_secrets_active_idx
  ON public.provider_instance_secrets (provider_instance_id, is_active);

-- 5) Work item sources (attachment to provider)
CREATE TABLE IF NOT EXISTS public.work_item_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  provider_instance_id uuid NOT NULL REFERENCES public.provider_instances(id) ON DELETE RESTRICT,
  provider_case_id text,
  source_input_type text NOT NULL,
  source_input_value text NOT NULL,
  source_url text,
  status work_item_source_status NOT NULL DEFAULT 'ACTIVE',
  scrape_status work_item_source_scrape_status NOT NULL DEFAULT 'ERROR',
  last_synced_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_provider_latency_ms int,
  consecutive_failures int NOT NULL DEFAULT 0,
  consecutive_404_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, provider_instance_id)
);

CREATE INDEX IF NOT EXISTS work_item_sources_org_idx
  ON public.work_item_sources (organization_id);
CREATE INDEX IF NOT EXISTS work_item_sources_work_item_idx
  ON public.work_item_sources (work_item_id);

-- 6) Link-only external references
CREATE TABLE IF NOT EXISTS public.work_item_external_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  label text,
  url text NOT NULL,
  kind text NOT NULL DEFAULT 'REFERENCE',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_item_external_links_work_item_idx
  ON public.work_item_external_links (work_item_id);

-- 7) Provider sync traces
CREATE TABLE IF NOT EXISTS public.provider_sync_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  work_item_id uuid,
  work_item_source_id uuid,
  provider_instance_id uuid,
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  result_code text,
  ok boolean NOT NULL DEFAULT false,
  latency_ms int,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_sync_traces_org_created_idx
  ON public.provider_sync_traces (organization_id, created_at DESC);

-- 8) Provenance columns on canonical tables
ALTER TABLE public.work_item_acts ADD COLUMN IF NOT EXISTS provider_instance_id uuid;
ALTER TABLE public.work_item_acts ADD COLUMN IF NOT EXISTS provider_case_id text;
ALTER TABLE public.work_item_acts ADD COLUMN IF NOT EXISTS provenance jsonb;

ALTER TABLE public.work_item_publicaciones ADD COLUMN IF NOT EXISTS provider_instance_id uuid;
ALTER TABLE public.work_item_publicaciones ADD COLUMN IF NOT EXISTS provider_case_id text;
ALTER TABLE public.work_item_publicaciones ADD COLUMN IF NOT EXISTS provenance jsonb;

-- 9) RLS
ALTER TABLE public.provider_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_instance_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_item_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_item_external_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_sync_traces ENABLE ROW LEVEL SECURITY;

-- Connectors: readable by authenticated, writable only by platform admin
CREATE POLICY "connectors_select" ON public.provider_connectors
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "connectors_insert_platform_admin" ON public.provider_connectors
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());

CREATE POLICY "connectors_update_platform_admin" ON public.provider_connectors
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Instances: org-scoped read, org-admin write
CREATE POLICY "instances_select_org" ON public.provider_instances
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id() OR public.is_platform_admin());

CREATE POLICY "instances_insert_org_admin" ON public.provider_instances
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_org_admin(organization_id));

CREATE POLICY "instances_update_org_admin" ON public.provider_instances
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_org_admin(organization_id))
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_org_admin(organization_id));

-- Secrets: deny-all (service_role bypasses RLS)
CREATE POLICY "secrets_deny_all" ON public.provider_instance_secrets
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Work item sources: org-scoped
CREATE POLICY "sources_select_org" ON public.work_item_sources
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id() OR public.is_platform_admin());

CREATE POLICY "sources_insert_org" ON public.work_item_sources
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "sources_update_org" ON public.work_item_sources
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "sources_delete_org" ON public.work_item_sources
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id());

-- External links: org-scoped
CREATE POLICY "links_select_org" ON public.work_item_external_links
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id() OR public.is_platform_admin());

CREATE POLICY "links_insert_org" ON public.work_item_external_links
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "links_delete_org" ON public.work_item_external_links
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id());

-- Traces: org-scoped read-only
CREATE POLICY "traces_select_org" ON public.provider_sync_traces
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id() OR public.is_platform_admin());

-- updated_at triggers
CREATE TRIGGER trg_provider_connectors_updated_at
  BEFORE UPDATE ON public.provider_connectors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_provider_instances_updated_at
  BEFORE UPDATE ON public.provider_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_work_item_sources_updated_at
  BEFORE UPDATE ON public.work_item_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
