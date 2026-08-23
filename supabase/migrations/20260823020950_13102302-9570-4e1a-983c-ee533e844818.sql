CREATE OR REPLACE FUNCTION public.bump_digest_token_usage(p_token_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.digest_document_tokens
     SET used_count = used_count + 1,
         last_used_at = now()
   WHERE id = p_token_id;
$$;

REVOKE ALL ON FUNCTION public.bump_digest_token_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_digest_token_usage(uuid) TO service_role;