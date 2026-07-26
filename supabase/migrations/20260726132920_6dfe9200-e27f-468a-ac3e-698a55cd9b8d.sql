CREATE OR REPLACE FUNCTION public.contribute_court_email(
  p_court_name text,
  p_court_email text,
  p_court_city text DEFAULT NULL,
  p_court_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_court_email IS NULL OR position('@' in p_court_email) = 0 THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;
  IF p_court_name IS NULL OR length(btrim(p_court_name)) = 0 THEN
    RAISE EXCEPTION 'INVALID_COURT_NAME';
  END IF;

  IF p_court_code IS NOT NULL AND length(btrim(p_court_code)) > 0 THEN
    SELECT id INTO v_id FROM public.court_emails WHERE court_code = p_court_code LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM public.court_emails
     WHERE court_code IS NULL AND lower(btrim(court_name)) = lower(btrim(p_court_name))
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.court_emails (court_code, court_name, court_email, court_city, source, contributed_by)
    VALUES (nullif(btrim(coalesce(p_court_code,'')),''), p_court_name, p_court_email, p_court_city, 'user_contribution', v_uid)
    RETURNING id INTO v_id;
  ELSE
    -- never overwrite entries curated/verified by the platform
    UPDATE public.court_emails
       SET court_email = p_court_email,
           court_city = COALESCE(p_court_city, court_city),
           court_name = COALESCE(NULLIF(btrim(p_court_name), ''), court_name),
           source = 'user_contribution',
           contributed_by = v_uid,
           updated_at = now()
     WHERE id = v_id
       AND COALESCE(source, 'user_contribution') = 'user_contribution';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.contribute_court_email(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contribute_court_email(text, text, text, text) TO authenticated;