-- A.3: the ceiling is a ceiling, not a floor that excludes.
ALTER TABLE public.email_matching_thresholds
  ADD COLUMN IF NOT EXISTS weak_suggest_floor numeric NOT NULL DEFAULT 0.05;

-- A.4.1: honest composition of the seeded registry.
ALTER TABLE public.authorities DROP CONSTRAINT IF EXISTS authorities_authority_kind_check;
UPDATE public.authorities
SET authority_kind = CASE
  WHEN canonical_name ~* '(ramajudicial|cortesuprema|consejodeestado|juzgado|tribunal|notificacionesrj)'
    THEN 'JUDICIAL'
  ELSE 'ADMINISTRATIVA'
END;

ALTER TABLE public.authority_domains
  ADD COLUMN IF NOT EXISTS verified_by uuid;

-- A.4.2(b): first human-confirmed link promotes an observed domain to verified.
CREATE OR REPLACE FUNCTION public.promote_authority_domain_on_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_domain text;
BEGIN
  IF NEW.link_status <> 'CONFIRMED' OR COALESCE(OLD.link_status,'') = 'CONFIRMED' THEN
    RETURN NEW;
  END IF;
  v_domain := lower(split_part(COALESCE(NEW.sender,''), '@', 2));
  IF v_domain = '' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.authority_domain_blocklist b WHERE lower(b.domain) = v_domain) THEN
    RETURN NEW; -- shared public domains never confer strong status
  END IF;

  UPDATE public.authority_domains
    SET verification_status = 'VERIFIED',
        verification_source = 'CONFIRMED_LINK',
        verified_at = now(),
        verified_by = NEW.user_id,
        observed_count = COALESCE(observed_count, 0) + 1,
        updated_at = now()
  WHERE lower(domain) = v_domain
    AND verification_status IS DISTINCT FROM 'VERIFIED';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_authority_domain ON public.work_item_email_links;
CREATE TRIGGER trg_promote_authority_domain
  AFTER UPDATE OF link_status ON public.work_item_email_links
  FOR EACH ROW EXECUTE FUNCTION public.promote_authority_domain_on_confirmation();

-- Guard the obvious failure explicitly (B.5).
INSERT INTO public.authority_domain_blocklist (domain, reason)
VALUES
  ('gmail.com','Dominio público compartido'),
  ('hotmail.com','Dominio público compartido'),
  ('outlook.com','Dominio público compartido'),
  ('yahoo.com','Dominio público compartido'),
  ('yahoo.es','Dominio público compartido'),
  ('icloud.com','Dominio público compartido'),
  ('live.com','Dominio público compartido')
ON CONFLICT DO NOTHING;
