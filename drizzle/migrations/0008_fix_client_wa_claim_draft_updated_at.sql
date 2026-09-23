-- client_wa_drafts has no updated_at column, so every claim raised 42703 and
-- no approved notice could ever be sent. The claim stays a single atomic
-- statement; it simply stops writing a column that does not exist.
CREATE OR REPLACE FUNCTION public.client_wa_claim_draft(_draft uuid)
RETURNS public.client_wa_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE claimed public.client_wa_drafts;
BEGIN
  UPDATE public.client_wa_drafts d
     SET status = 'SENDING'
   WHERE d.id = _draft
     AND d.status = 'APPROVED'
     AND d.approved_by IS NOT NULL
     AND d.approved_at IS NOT NULL
     AND d.expires_at > now()
     AND public.is_org_member(d.organization_id)
     AND EXISTS (
       SELECT 1 FROM public.client_wa_consent c
        WHERE c.id = d.consent_id
          AND c.revoked_at IS NULL
          AND c.client_id = d.client_id
          AND c.organization_id = d.organization_id
     )
  RETURNING d.* INTO claimed;

  RETURN claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.client_wa_claim_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_wa_claim_draft(uuid) TO authenticated, service_role;