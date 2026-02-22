
-- Table for Super Admin branding presets used in Generic PDF Signing
CREATE TABLE public.generic_signing_branding_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID NOT NULL,
  name TEXT NOT NULL,
  logo_path TEXT,
  firm_name TEXT,
  firm_address TEXT,
  firm_phone TEXT,
  firm_email TEXT,
  firm_website TEXT,
  firm_tagline TEXT,
  show_andromeda_branding BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.generic_signing_branding_presets ENABLE ROW LEVEL SECURITY;

-- Only platform admins can manage presets
CREATE POLICY "Platform admins can manage branding presets"
ON public.generic_signing_branding_presets
FOR ALL
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

-- Trigger for updated_at
CREATE TRIGGER update_generic_signing_branding_presets_updated_at
BEFORE UPDATE ON public.generic_signing_branding_presets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
