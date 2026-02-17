
-- 1. Org-wide task templates (admin-managed, users consume)
CREATE TABLE public.org_task_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIA' CHECK (priority IN ('ALTA', 'MEDIA', 'BAJA')),
  default_cadence_days INTEGER DEFAULT 3,
  category TEXT NOT NULL DEFAULT 'custom' CHECK (category IN ('milestone', 'legal_term', 'custom')),
  workflow_types TEXT[] DEFAULT '{}', -- empty = all workflow types
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.org_task_templates ENABLE ROW LEVEL SECURITY;

-- Admins can CRUD
CREATE POLICY "Org admins can manage templates"
  ON public.org_task_templates FOR ALL
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- All org members can read active templates
CREATE POLICY "Org members can read active templates"
  ON public.org_task_templates FOR SELECT
  USING (public.is_org_member(organization_id) AND is_active = true);

CREATE INDEX idx_org_task_templates_org ON public.org_task_templates(organization_id);

-- 2. Org default alert policy (admin sets defaults for new work items)
CREATE TABLE public.org_alert_defaults (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_by UUID NOT NULL REFERENCES public.profiles(id),
  -- Default alert settings for new work items
  staleness_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  staleness_threshold_days INTEGER NOT NULL DEFAULT 30,
  new_actuacion_alert BOOLEAN NOT NULL DEFAULT true,
  new_estado_alert BOOLEAN NOT NULL DEFAULT true,
  task_due_alert BOOLEAN NOT NULL DEFAULT true,
  alert_channels TEXT[] NOT NULL DEFAULT '{in_app}',
  email_digest_enabled BOOLEAN NOT NULL DEFAULT false,
  alert_cadence_days INTEGER NOT NULL DEFAULT 3,
  -- Scope: which workflow types this applies to (empty = all)
  applies_to_workflow_types TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

ALTER TABLE public.org_alert_defaults ENABLE ROW LEVEL SECURITY;

-- Admins can manage
CREATE POLICY "Org admins can manage alert defaults"
  ON public.org_alert_defaults FOR ALL
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- All org members can read
CREATE POLICY "Org members can read alert defaults"
  ON public.org_alert_defaults FOR SELECT
  USING (public.is_org_member(organization_id));

-- Trigger for updated_at
CREATE TRIGGER update_org_task_templates_updated_at
  BEFORE UPDATE ON public.org_task_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_org_alert_defaults_updated_at
  BEFORE UPDATE ON public.org_alert_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
