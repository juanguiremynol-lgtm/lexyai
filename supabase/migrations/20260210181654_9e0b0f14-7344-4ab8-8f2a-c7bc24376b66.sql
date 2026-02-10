
-- 1) Add is_authoritative to provider_category_routes
ALTER TABLE public.provider_category_routes
  ADD COLUMN IF NOT EXISTS is_authoritative boolean NOT NULL DEFAULT false;

-- Partial unique index: at most one authoritative route per org+workflow+scope
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_category_routes_authoritative
  ON public.provider_category_routes (organization_id, workflow, scope)
  WHERE is_authoritative = true;

-- 2) Create provider_category_policies table (one row per org+workflow+scope)
CREATE TABLE public.provider_category_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow text NOT NULL,
  scope text NOT NULL DEFAULT 'BOTH',
  strategy text NOT NULL DEFAULT 'SELECT',
  merge_mode text NOT NULL DEFAULT 'UNION_PREFER_PRIMARY',
  merge_budget_max_providers integer NOT NULL DEFAULT 2,
  merge_budget_max_ms integer NOT NULL DEFAULT 15000,
  allow_merge_on_empty boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_strategy CHECK (strategy IN ('SELECT', 'MERGE')),
  CONSTRAINT chk_merge_mode CHECK (merge_mode IN ('UNION', 'UNION_PREFER_PRIMARY', 'VERIFY_ONLY')),
  CONSTRAINT chk_scope CHECK (scope IN ('ACTS', 'PUBS', 'BOTH'))
);

-- Unique per org+workflow+scope
CREATE UNIQUE INDEX idx_provider_category_policies_unique
  ON public.provider_category_policies (organization_id, workflow, scope);

-- RLS
ALTER TABLE public.provider_category_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read policies"
  ON public.provider_category_policies FOR SELECT
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om WHERE om.user_id = auth.uid()
  ));

CREATE POLICY "Org admins can manage policies"
  ON public.provider_category_policies FOR ALL
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om
    WHERE om.user_id = auth.uid() AND om.role IN ('OWNER', 'ADMIN')
  ));

-- 3) Act provenance join table
CREATE TABLE public.act_provenance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_act_id uuid NOT NULL,
  provider_instance_id uuid NOT NULL REFERENCES public.provider_instances(id) ON DELETE CASCADE,
  provider_event_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_act_provenance UNIQUE (work_item_act_id, provider_instance_id)
);

CREATE INDEX idx_act_provenance_act ON public.act_provenance(work_item_act_id);
CREATE INDEX idx_act_provenance_provider ON public.act_provenance(provider_instance_id);

ALTER TABLE public.act_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only for act_provenance"
  ON public.act_provenance FOR ALL
  USING (false);

-- 4) Pub provenance join table
CREATE TABLE public.pub_provenance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_pub_id uuid NOT NULL,
  provider_instance_id uuid NOT NULL REFERENCES public.provider_instances(id) ON DELETE CASCADE,
  provider_event_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pub_provenance UNIQUE (work_item_pub_id, provider_instance_id)
);

CREATE INDEX idx_pub_provenance_pub ON public.pub_provenance(work_item_pub_id);
CREATE INDEX idx_pub_provenance_provider ON public.pub_provenance(provider_instance_id);

ALTER TABLE public.pub_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only for pub_provenance"
  ON public.pub_provenance FOR ALL
  USING (false);

-- 5) Provider merge conflicts table
CREATE TABLE public.provider_merge_conflicts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL,
  scope text NOT NULL,
  dedupe_key text NOT NULL,
  field_name text NOT NULL,
  primary_value text,
  secondary_value text,
  primary_provider_instance_id uuid REFERENCES public.provider_instances(id),
  secondary_provider_instance_id uuid REFERENCES public.provider_instances(id),
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_merge_conflicts_org ON public.provider_merge_conflicts(organization_id);
CREATE INDEX idx_merge_conflicts_work_item ON public.provider_merge_conflicts(work_item_id);

ALTER TABLE public.provider_merge_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read conflicts"
  ON public.provider_merge_conflicts FOR SELECT
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om WHERE om.user_id = auth.uid()
  ));

CREATE POLICY "Service role manages conflicts"
  ON public.provider_merge_conflicts FOR ALL
  USING (false);
