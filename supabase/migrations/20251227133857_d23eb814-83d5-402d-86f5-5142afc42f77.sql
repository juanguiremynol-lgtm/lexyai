-- Create organizations table for multi-tenant support
CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  brand_logo_url TEXT,
  brand_tagline TEXT DEFAULT 'Asistente jurídico digital',
  brand_primary_color TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Add organization_id to profiles table
ALTER TABLE public.profiles ADD COLUMN organization_id UUID REFERENCES public.organizations(id);

-- Create trigger for updated_at on organizations
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS policies for organizations
-- Users can view their own organization
CREATE POLICY "Users can view their own organization"
  ON public.organizations
  FOR SELECT
  USING (
    id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Allow service role full access for initial setup
CREATE POLICY "Service role can manage organizations"
  ON public.organizations
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create security definer function to check org membership
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

-- Insert default ATENIA organization
INSERT INTO public.organizations (id, name, slug, brand_tagline)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'ATENIA',
  'atenia',
  'Asistente jurídico digital'
);

-- Update existing profiles to use the default organization
UPDATE public.profiles SET organization_id = 'a0000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;