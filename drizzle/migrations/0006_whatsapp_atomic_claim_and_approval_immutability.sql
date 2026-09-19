-- AUDIT FINDING 8 — two concurrent send requests both read an APPROVED draft
-- and both call the provider: the client gets the same notice twice and the
-- evidence table records two sends. The claim becomes atomic and a SENDING
-- state exists between approval and the provider's answer.
ALTER TABLE public.client_wa_drafts DROP CONSTRAINT IF EXISTS chk_wa_draft_status;
ALTER TABLE public.client_wa_drafts ADD CONSTRAINT chk_wa_draft_status
  CHECK (status = ANY (ARRAY['PENDING','APPROVED','SENDING','SENT','DISCARDED','EXPIRED','FAILED']));

CREATE OR REPLACE FUNCTION public.client_wa_claim_draft(_draft uuid)
RETURNS public.client_wa_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE claimed public.client_wa_drafts;
BEGIN
  -- Single statement: only one caller can move APPROVED -> SENDING.
  UPDATE public.client_wa_drafts d
     SET status = 'SENDING', updated_at = now()
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

  RETURN claimed; -- NULL row when the claim was lost or preconditions failed
END;
$$;

REVOKE ALL ON FUNCTION public.client_wa_claim_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_wa_claim_draft(uuid) TO authenticated, service_role;

-- Approval facts are evidence: once recorded they cannot be rewritten, and the
-- draft can never be re-pointed at a different client, matter or consent.
CREATE OR REPLACE FUNCTION public.client_wa_freeze_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'approved_by is immutable once set';
  END IF;
  IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'approved_at is immutable once set';
  END IF;
  IF OLD.status IN ('APPROVED','SENDING','SENT') THEN
    IF NEW.consent_id IS DISTINCT FROM OLD.consent_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.work_item_id IS DISTINCT FROM OLD.work_item_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.body_text IS DISTINCT FROM OLD.body_text THEN
      RAISE EXCEPTION 'an approved notice cannot be re-targeted or rewritten';
    END IF;
  END IF;
  IF OLD.status = 'SENT' AND NEW.status <> 'SENT' THEN
    RAISE EXCEPTION 'a sent notice cannot change state';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_wa_freeze_approval ON public.client_wa_drafts;
CREATE TRIGGER trg_client_wa_freeze_approval
  BEFORE UPDATE ON public.client_wa_drafts
  FOR EACH ROW EXECUTE FUNCTION public.client_wa_freeze_approval();