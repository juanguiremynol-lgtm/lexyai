-- =====================================================
-- MULTI-TENANT SAAS ARCHITECTURE MIGRATION
-- =====================================================

-- 1. Add created_by and is_active to organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- 2. Create organization_memberships table (replaces simple user_roles for org membership)
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- 3. Create user_preferences table
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_alerts_enabled boolean DEFAULT true,
  ui_alerts_enabled boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- 4. Create email_outbox table for multi-user email delivery
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  to_user_id uuid REFERENCES auth.users(id),
  subject text NOT NULL,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error text,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- 5. Add organization_id to tables that need it
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.work_item_acts ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.work_item_deadlines ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.alert_instances ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.process_events ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.actuaciones ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.peticiones ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.cpaca_processes ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.icarus_import_runs ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- 6. Enable RLS on new tables
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- 7. Create helper function to check organization membership
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships
    WHERE organization_id = org_id
      AND user_id = auth.uid()
  )
$$;

-- 8. Create helper function to check if user is org admin/owner
CREATE OR REPLACE FUNCTION public.is_org_admin(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role IN ('OWNER', 'ADMIN')
  )
$$;

-- 9. Create helper function to get user's organization ID
CREATE OR REPLACE FUNCTION public.get_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

-- 10. RLS Policies for organization_memberships
CREATE POLICY "Users can view memberships of their organizations"
  ON public.organization_memberships FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Org admins can insert memberships"
  ON public.organization_memberships FOR INSERT
  WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Org admins can update memberships"
  ON public.organization_memberships FOR UPDATE
  USING (public.is_org_admin(organization_id));

CREATE POLICY "Org admins can delete memberships"
  ON public.organization_memberships FOR DELETE
  USING (public.is_org_admin(organization_id));

-- 11. RLS Policies for user_preferences
CREATE POLICY "Users can view their own preferences"
  ON public.user_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(organization_id));

CREATE POLICY "Users can update their own preferences"
  ON public.user_preferences FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own preferences"
  ON public.user_preferences FOR DELETE
  USING (user_id = auth.uid());

-- 12. RLS Policies for email_outbox
CREATE POLICY "Users can view emails for their organization"
  ON public.email_outbox FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Service role can manage email outbox"
  ON public.email_outbox FOR ALL
  USING (true)
  WITH CHECK (true);

-- 13. Update trigger for organization_memberships
CREATE TRIGGER update_organization_memberships_updated_at
  BEFORE UPDATE ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 14. Update trigger for user_preferences
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 15. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_organization_memberships_org_id ON public.organization_memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_memberships_user_id ON public.organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_org_user ON public.user_preferences(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON public.email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_org ON public.email_outbox(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON public.clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_work_items_org ON public.work_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON public.alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON public.tasks(organization_id);