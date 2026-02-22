
-- Platform PDF Settings: single-row config for Gotenberg endpoint management
-- Super Admin only - no code changes needed to switch from demo to self-hosted

CREATE TYPE public.pdf_provider_mode AS ENUM ('DEMO', 'DIRECT');

CREATE TABLE public.platform_pdf_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'GOTENBERG',
  gotenberg_url text,
  mode public.pdf_provider_mode NOT NULL DEFAULT 'DEMO',
  enabled boolean NOT NULL DEFAULT true,
  timeout_seconds integer NOT NULL DEFAULT 30,
  max_html_bytes integer NOT NULL DEFAULT 4000000,
  allow_html_fallback boolean NOT NULL DEFAULT false,
  last_health_check_at timestamptz,
  last_health_status text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  updated_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default row (DEMO mode, matching current behavior)
INSERT INTO public.platform_pdf_settings (provider, mode, enabled, timeout_seconds, max_html_bytes, allow_html_fallback)
VALUES ('GOTENBERG', 'DEMO', true, 30, 4000000, false);

-- Enable RLS
ALTER TABLE public.platform_pdf_settings ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read
CREATE POLICY "Platform admins can read pdf settings"
ON public.platform_pdf_settings FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid()
  )
);

-- Only platform admins can update
CREATE POLICY "Platform admins can update pdf settings"
ON public.platform_pdf_settings FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid()
  )
);

-- Service role needs read access for edge functions
-- Edge functions use service_role key which bypasses RLS, so no extra policy needed

-- Create a SECURITY DEFINER function for edge functions to read settings without auth
CREATE OR REPLACE FUNCTION public.get_pdf_provider_settings()
RETURNS TABLE (
  gotenberg_url text,
  mode public.pdf_provider_mode,
  enabled boolean,
  timeout_seconds integer,
  max_html_bytes integer,
  allow_html_fallback boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    gotenberg_url,
    mode,
    enabled,
    timeout_seconds,
    max_html_bytes,
    allow_html_fallback
  FROM public.platform_pdf_settings
  LIMIT 1;
$$;
