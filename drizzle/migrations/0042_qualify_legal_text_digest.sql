CREATE OR REPLACE FUNCTION public.auto_hash_legal_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.text_hash := encode(extensions.digest(public.canonicalize_legal_text(NEW.text), 'sha256'), 'hex');
  RETURN NEW;
END;
$function$;