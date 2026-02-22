
CREATE TABLE public.custom_docx_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL DEFAULT 'Mi plantilla',
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  storage_path TEXT NOT NULL,
  upload_sha256 TEXT NOT NULL,
  file_size_bytes INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_immutable BOOLEAN NOT NULL DEFAULT false,
  placeholders_found TEXT[] NOT NULL DEFAULT '{}',
  missing_required_placeholders TEXT[] NOT NULL DEFAULT '{}',
  unknown_placeholders TEXT[] NOT NULL DEFAULT '{}',
  invalid_tokens TEXT[] NOT NULL DEFAULT '{}',
  conditional_blocks_found TEXT[] NOT NULL DEFAULT '{}',
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','valid','blocked','warning')),
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_docx_templates_org ON public.custom_docx_templates(organization_id, document_type);
CREATE INDEX idx_custom_docx_templates_active ON public.custom_docx_templates(organization_id, document_type, is_active) WHERE is_active = true;

ALTER TABLE public.custom_docx_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read docx templates"
ON public.custom_docx_templates FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.organization_memberships
    WHERE user_id = auth.uid()
  )
  OR user_id = auth.uid()
);

CREATE POLICY "Admins and owners can insert docx templates"
ON public.custom_docx_templates FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  OR (
    organization_id IS NOT NULL
    AND public.is_org_admin(organization_id)
  )
);

CREATE POLICY "Owners and admins can update docx templates"
ON public.custom_docx_templates FOR UPDATE
USING (
  is_immutable = false
  AND (
    user_id = auth.uid()
    OR (
      organization_id IS NOT NULL
      AND public.is_org_admin(organization_id)
    )
  )
);

CREATE POLICY "Owners and admins can delete docx templates"
ON public.custom_docx_templates FOR DELETE
USING (
  is_immutable = false
  AND (
    user_id = auth.uid()
    OR (
      organization_id IS NOT NULL
      AND public.is_org_admin(organization_id)
    )
  )
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('docx-templates', 'docx-templates', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload docx templates"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'docx-templates' AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can read their org docx templates"
ON storage.objects FOR SELECT
USING (bucket_id = 'docx-templates' AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete their own docx templates"
ON storage.objects FOR DELETE
USING (bucket_id = 'docx-templates' AND auth.uid() IS NOT NULL);

CREATE TRIGGER update_custom_docx_templates_updated_at
BEFORE UPDATE ON public.custom_docx_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
