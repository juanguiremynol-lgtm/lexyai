
-- Drop existing function that conflicts
DROP FUNCTION IF EXISTS public.user_has_accepted_current_terms(uuid);
DROP FUNCTION IF EXISTS public.user_has_accepted_current_terms();

-- =============================================================
-- Ops Hardening: Terms Compliance Audit-Grade Adjustments
-- =============================================================

-- 1. Add pending_terms_acceptance to profiles (OAuth hard gate)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS pending_terms_acceptance boolean NOT NULL DEFAULT false;

-- 2. Add server_received_at and scroll_gated to terms_acceptance
ALTER TABLE public.terms_acceptance 
ADD COLUMN IF NOT EXISTS server_received_at timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS scroll_gated boolean DEFAULT true;

-- 3. Create DB function to check terms acceptance (RLS enforcement)
CREATE OR REPLACE FUNCTION public.user_has_accepted_current_terms(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.terms_acceptance ta
    JOIN public.terms_versions tv ON tv.version = ta.terms_version AND tv.active = true
    WHERE ta.user_id = p_user_id
      AND ta.checkbox_terms = true
      AND ta.checkbox_age = true
  )
  OR EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM public.terms_versions WHERE active = true
  )
$$;

-- 4. Create function to get active terms from DB (canonical source)
CREATE OR REPLACE FUNCTION public.get_active_terms()
RETURNS TABLE(
  terms_version text,
  terms_last_updated date,
  terms_text text,
  terms_text_hash text,
  privacy_version text,
  privacy_text text,
  privacy_text_hash text,
  operador_razon_social text,
  operador_nit text,
  operador_domicilio text,
  operador_correo text,
  operador_correo_privacidad text,
  operador_telefono text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tv.version,
    tv.last_updated,
    tv.text,
    tv.text_hash,
    ppv.version,
    ppv.text,
    ppv.text_hash,
    'LEX ET LITTERAE S.A.S.'::text,
    '901782559-8'::text,
    'Carrera 32 # 7 B Sur 52, Oficina 113, Medellín, Antioquia, Colombia'::text,
    'erikajohana123@hotmail.com'::text,
    'erikajohana123@hotmail.com'::text,
    '3205146627'::text
  FROM public.terms_versions tv
  CROSS JOIN public.privacy_policy_versions ppv
  WHERE tv.active = true AND ppv.active = true
  LIMIT 1
$$;

-- 5. Compute proper hashes for seed data
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE public.terms_versions 
SET text_hash = encode(digest(
  regexp_replace(trim(text), E'\\r\\n', E'\\n', 'g'),
  'sha256'
), 'hex')
WHERE active = true AND text_hash = 'seed-placeholder-will-be-updated-by-app';

UPDATE public.privacy_policy_versions 
SET text_hash = encode(digest(
  regexp_replace(trim(text), E'\\r\\n', E'\\n', 'g'),
  'sha256'
), 'hex')
WHERE active = true AND text_hash = 'seed-placeholder-will-be-updated-by-app';

-- 6. Trigger: set pending_terms for new profiles
CREATE OR REPLACE FUNCTION public.set_pending_terms_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM terms_versions WHERE active = true) THEN
    IF NOT public.user_has_accepted_current_terms(NEW.id) THEN
      NEW.pending_terms_acceptance := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_pending_terms ON public.profiles;
CREATE TRIGGER trg_set_pending_terms
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pending_terms_for_new_user();

-- 7. Trigger: clear pending_terms when terms accepted
CREATE OR REPLACE FUNCTION public.clear_pending_terms_on_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.checkbox_terms = true AND NEW.checkbox_age = true THEN
    UPDATE public.profiles
    SET pending_terms_acceptance = false
    WHERE id = NEW.user_id
      AND pending_terms_acceptance = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_pending_terms ON public.terms_acceptance;
CREATE TRIGGER trg_clear_pending_terms
  AFTER INSERT ON public.terms_acceptance
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_pending_terms_on_accept();

-- 8. Trigger: flag all users for re-acceptance when terms version changes
CREATE OR REPLACE FUNCTION public.flag_users_for_reacceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active = true AND (OLD.active IS DISTINCT FROM true) THEN
    UPDATE public.profiles
    SET pending_terms_acceptance = true
    WHERE id NOT IN (SELECT user_id FROM platform_admins);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_reacceptance ON public.terms_versions;
CREATE TRIGGER trg_flag_reacceptance
  AFTER UPDATE ON public.terms_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_users_for_reacceptance();
