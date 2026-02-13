
-- Create a function to check if beta enrollment is still open
CREATE OR REPLACE FUNCTION public.is_beta_enrollment_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*) < 100 FROM public.organizations;
$$;

-- Create a function that blocks new org creation when limit reached
CREATE OR REPLACE FUNCTION public.enforce_beta_enrollment_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.organizations) >= 100 THEN
    RAISE EXCEPTION 'Beta enrollment limit reached (100 organizations). New signups are suspended until further notice.';
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to organizations table (fires before insert)
CREATE TRIGGER enforce_beta_limit
  BEFORE INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_beta_enrollment_limit();
