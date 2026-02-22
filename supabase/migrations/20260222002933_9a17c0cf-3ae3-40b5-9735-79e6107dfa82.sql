
-- Document configuration settings per org/user for field overrides, sections, defaults
CREATE TABLE public.document_configurations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  field_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled_sections JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_lawyer_id_type TEXT NOT NULL DEFAULT 'CC',
  default_client_id_type TEXT NOT NULL DEFAULT 'CC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_configurations_unique_org UNIQUE NULLS NOT DISTINCT (organization_id, document_type, user_id)
);

ALTER TABLE public.document_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can manage org document configs"
  ON public.document_configurations FOR ALL
  USING (
    (organization_id IS NOT NULL AND is_org_admin(organization_id))
    OR (user_id = auth.uid())
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND is_org_admin(organization_id))
    OR (user_id = auth.uid())
  );

CREATE POLICY "Org members can read org document configs"
  ON public.document_configurations FOR SELECT
  USING (
    organization_id IS NOT NULL AND is_org_member(organization_id)
  );

CREATE TRIGGER update_document_configurations_updated_at
  BEFORE UPDATE ON public.document_configurations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
