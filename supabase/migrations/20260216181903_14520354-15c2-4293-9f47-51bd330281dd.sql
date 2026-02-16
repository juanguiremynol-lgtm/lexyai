
-- =====================================================
-- Terms & Conditions + Privacy Policy Compliance Schema
-- Immutable acceptance records, versioning, re-acceptance
-- =====================================================

-- 1. Terms versions (versionable T&C documents)
CREATE TABLE public.terms_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  last_updated DATE NOT NULL DEFAULT CURRENT_DATE,
  title TEXT NOT NULL DEFAULT 'Términos y Condiciones de Uso – ANDROMEDA (Colombia)',
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL, -- SHA-256 of the text
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Only one active version at a time
CREATE UNIQUE INDEX idx_terms_versions_active ON public.terms_versions (active) WHERE active = true;

ALTER TABLE public.terms_versions ENABLE ROW LEVEL SECURITY;

-- Everyone can read active terms
CREATE POLICY "Anyone can read terms versions"
  ON public.terms_versions FOR SELECT
  USING (true);

-- Only platform admins can insert/update
CREATE POLICY "Platform admins can manage terms"
  ON public.terms_versions FOR INSERT
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Platform admins can update terms"
  ON public.terms_versions FOR UPDATE
  USING (public.is_platform_admin());

-- 2. Privacy policy versions
CREATE TABLE public.privacy_policy_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  title TEXT NOT NULL DEFAULT 'Política de Tratamiento de Datos Personales',
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  database_validity_clause_present BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX idx_privacy_policy_active ON public.privacy_policy_versions (active) WHERE active = true;

ALTER TABLE public.privacy_policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read privacy policy versions"
  ON public.privacy_policy_versions FOR SELECT
  USING (true);

CREATE POLICY "Platform admins can manage privacy policy"
  ON public.privacy_policy_versions FOR INSERT
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Platform admins can update privacy policy"
  ON public.privacy_policy_versions FOR UPDATE
  USING (public.is_platform_admin());

-- 3. Terms acceptance log (APPEND-ONLY / IMMUTABLE)
CREATE TABLE public.terms_acceptance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  operador_razon_social TEXT NOT NULL DEFAULT 'LEX ET LITTERAE S.A.S.',
  operador_nit TEXT NOT NULL DEFAULT '901782559-8',
  terms_version TEXT NOT NULL,
  terms_last_updated_date DATE NOT NULL,
  terms_text_hash TEXT NOT NULL,
  privacy_policy_version TEXT,
  privacy_policy_text_hash TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acceptance_method TEXT NOT NULL DEFAULT 'registration_web',
  ip_address TEXT,
  user_agent TEXT,
  locale TEXT DEFAULT 'es-CO',
  checkbox_terms BOOLEAN NOT NULL DEFAULT false,
  checkbox_age BOOLEAN NOT NULL DEFAULT false,
  checkbox_marketing BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookup of user's latest acceptance
CREATE INDEX idx_terms_acceptance_user ON public.terms_acceptance (user_id, accepted_at DESC);
CREATE INDEX idx_terms_acceptance_version ON public.terms_acceptance (terms_version);

ALTER TABLE public.terms_acceptance ENABLE ROW LEVEL SECURITY;

-- Users can read their own acceptances
CREATE POLICY "Users can read own acceptances"
  ON public.terms_acceptance FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own acceptances (append-only)
CREATE POLICY "Users can insert own acceptances"
  ON public.terms_acceptance FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Platform admins can read all acceptances (audit)
CREATE POLICY "Platform admins can read all acceptances"
  ON public.terms_acceptance FOR SELECT
  USING (public.is_platform_admin());

-- NO UPDATE OR DELETE policies — append-only by design

-- 4. Prevent updates/deletes on terms_acceptance via trigger
CREATE OR REPLACE FUNCTION public.prevent_terms_acceptance_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'terms_acceptance records are immutable and cannot be modified or deleted';
END;
$$;

CREATE TRIGGER prevent_terms_acceptance_update
  BEFORE UPDATE ON public.terms_acceptance
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_terms_acceptance_mutation();

CREATE TRIGGER prevent_terms_acceptance_delete
  BEFORE DELETE ON public.terms_acceptance
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_terms_acceptance_mutation();

-- 5. Function to check if user has accepted current terms
CREATE OR REPLACE FUNCTION public.user_has_accepted_current_terms(p_user_id UUID DEFAULT auth.uid())
  RETURNS BOOLEAN
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_active_version TEXT;
  v_accepted BOOLEAN;
BEGIN
  -- Get the currently active terms version
  SELECT version INTO v_active_version
  FROM public.terms_versions
  WHERE active = true
  LIMIT 1;

  -- If no active terms, allow access (terms not yet configured)
  IF v_active_version IS NULL THEN
    RETURN true;
  END IF;

  -- Check if user has accepted this version
  SELECT EXISTS (
    SELECT 1
    FROM public.terms_acceptance
    WHERE user_id = p_user_id
      AND terms_version = v_active_version
      AND checkbox_terms = true
      AND checkbox_age = true
  ) INTO v_accepted;

  RETURN v_accepted;
END;
$$;

-- 6. Seed the initial v1.0 terms version
INSERT INTO public.terms_versions (version, last_updated, text, text_hash, active) VALUES (
  'v1.0',
  '2026-02-16',
  'TÉRMINOS Y CONDICIONES DE USO – ANDROMEDA (COLOMBIA)',
  'seed-placeholder-will-be-updated-by-app',
  true
);

-- 7. Seed initial privacy policy version
INSERT INTO public.privacy_policy_versions (version, effective_date, text, text_hash, active, database_validity_clause_present) VALUES (
  'v1.0',
  '2026-02-16',
  'Política de Tratamiento de Datos Personales – ANDROMEDA',
  'seed-placeholder-will-be-updated-by-app',
  true,
  true
);
