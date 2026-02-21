
-- 1) Document retention policies — org-level overrides per document type
CREATE TABLE public.document_retention_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  document_type TEXT NOT NULL,
  retention_years INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, document_type)
);

ALTER TABLE public.document_retention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org retention policies"
ON public.document_retention_policies FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Org admins can manage retention policies"
ON public.document_retention_policies FOR ALL
USING (
  organization_id IN (
    SELECT om.organization_id FROM public.organization_memberships om
    WHERE om.user_id = auth.uid() AND om.role IN ('OWNER', 'ADMIN')
  )
);

-- 2) Add retention columns to generated_documents
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_years INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS delete_blocked_reason TEXT;

-- 3) Index for retention queries
CREATE INDEX IF NOT EXISTS idx_generated_docs_retention
  ON public.generated_documents(retention_expires_at)
  WHERE deleted_at IS NULL;

-- 4) Trigger to auto-set retention_expires_at when document is finalized
CREATE OR REPLACE FUNCTION public.set_document_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention_years INTEGER;
BEGIN
  -- Only act when transitioning to finalized
  IF NEW.finalized_at IS NOT NULL AND (OLD.finalized_at IS NULL OR OLD.finalized_at IS DISTINCT FROM NEW.finalized_at) THEN
    -- Check for org-level override
    SELECT retention_years INTO v_retention_years
    FROM document_retention_policies
    WHERE organization_id = NEW.organization_id
      AND document_type = NEW.document_type;

    -- Fall back to default 10 years
    IF v_retention_years IS NULL THEN
      v_retention_years := 10;
    END IF;

    NEW.retention_years := v_retention_years;
    NEW.retention_expires_at := NEW.finalized_at + (v_retention_years || ' years')::interval;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_document_retention
BEFORE UPDATE ON public.generated_documents
FOR EACH ROW
EXECUTE FUNCTION public.set_document_retention();
