
-- =============================================================
-- Audit-Grade Hardening: 6-point compliance fixes
-- =============================================================

-- 1. Canonical text normalization function (deterministic hashing)
-- Rule: UTF-8, CRLF→LF, no BOM, global trim
CREATE OR REPLACE FUNCTION public.canonicalize_legal_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(both E'\n\r\t ' FROM 
    regexp_replace(
      regexp_replace(p_text, E'\xEF\xBB\xBF', '', 'g'),  -- Remove BOM
      E'\\r\\n|\\r', E'\\n', 'g'                           -- Normalize line endings
    )
  )
$$;

-- 2. Fix user_has_accepted_current_terms to check BOTH T&C AND privacy policy
CREATE OR REPLACE FUNCTION public.user_has_accepted_current_terms(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Platform admins bypass
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id) THEN true
    -- No active terms configured = allow
    WHEN NOT EXISTS (SELECT 1 FROM public.terms_versions WHERE active = true) THEN true
    ELSE (
      SELECT EXISTS (
        SELECT 1
        FROM public.terms_acceptance ta
        JOIN public.terms_versions tv ON tv.version = ta.terms_version AND tv.active = true
        LEFT JOIN public.privacy_policy_versions ppv ON ppv.active = true
        WHERE ta.user_id = p_user_id
          AND ta.checkbox_terms = true
          AND ta.checkbox_age = true
          -- If privacy policy exists, verify acceptance matches
          AND (ppv.version IS NULL OR ta.privacy_policy_version = ppv.version)
      )
    )
  END
$$;

-- 3. Trigger: flag re-acceptance on PRIVACY POLICY version changes too
CREATE OR REPLACE FUNCTION public.flag_users_for_reacceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fires when a new version becomes active (for either T&C or privacy policy)
  IF NEW.active = true AND (OLD.active IS DISTINCT FROM true) THEN
    UPDATE public.profiles
    SET pending_terms_acceptance = true
    WHERE id NOT IN (SELECT user_id FROM platform_admins);
  END IF;
  RETURN NEW;
END;
$$;

-- Add the trigger to privacy_policy_versions (T&C already has it)
DROP TRIGGER IF EXISTS trg_flag_reacceptance_privacy ON public.privacy_policy_versions;
CREATE TRIGGER trg_flag_reacceptance_privacy
  AFTER UPDATE ON public.privacy_policy_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_users_for_reacceptance();

-- 4. Re-canonicalize existing hashes to ensure consistency
UPDATE public.terms_versions 
SET text_hash = encode(digest(
  public.canonicalize_legal_text(text),
  'sha256'
), 'hex')
WHERE active = true;

UPDATE public.privacy_policy_versions 
SET text_hash = encode(digest(
  public.canonicalize_legal_text(text),
  'sha256'
), 'hex')
WHERE active = true;

-- 5. Update get_active_terms to use canonicalized hash
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

-- 6. Auto-hash on INSERT/UPDATE of terms_versions
CREATE OR REPLACE FUNCTION public.auto_hash_legal_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Always recompute hash from canonicalized text on write
  NEW.text_hash := encode(digest(
    public.canonicalize_legal_text(NEW.text),
    'sha256'
  ), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_hash_terms ON public.terms_versions;
CREATE TRIGGER trg_auto_hash_terms
  BEFORE INSERT OR UPDATE OF text ON public.terms_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_hash_legal_text();

DROP TRIGGER IF EXISTS trg_auto_hash_privacy ON public.privacy_policy_versions;
CREATE TRIGGER trg_auto_hash_privacy
  BEFORE INSERT OR UPDATE OF text ON public.privacy_policy_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_hash_legal_text();
