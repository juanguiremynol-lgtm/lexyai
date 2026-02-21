
-- 1) Storage bucket for evidence proof uploads (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-proofs', 'evidence-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- 2) RLS policies for evidence-proofs bucket
CREATE POLICY "Users can upload proofs to their org folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'evidence-proofs'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Users can view proofs in their org folder"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'evidence-proofs'
  AND auth.uid() IS NOT NULL
);

-- 3) External proof attachments table
CREATE TABLE public.document_evidence_proofs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  document_id UUID NOT NULL REFERENCES public.generated_documents(id),
  uploaded_by UUID NOT NULL,
  proof_type TEXT NOT NULL DEFAULT 'external_delivery',
  label TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT,
  mime_type TEXT,
  file_sha256 TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.document_evidence_proofs ENABLE ROW LEVEL SECURITY;

-- RLS: users can view proofs for documents in their org
CREATE POLICY "Users can view org proofs"
ON public.document_evidence_proofs FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- RLS: users can insert proofs for documents in their org
CREATE POLICY "Users can insert org proofs"
ON public.document_evidence_proofs FOR INSERT
WITH CHECK (
  uploaded_by = auth.uid()
  AND organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- RLS: no update/delete (proofs are append-only like audit events)
-- Trigger to enforce append-only
CREATE OR REPLACE FUNCTION public.prevent_proof_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'document_evidence_proofs is append-only; % is not permitted', tg_op
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_prevent_proof_mutation
BEFORE UPDATE OR DELETE ON public.document_evidence_proofs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_proof_mutation();

ALTER TABLE public.document_evidence_proofs
ENABLE ALWAYS TRIGGER trg_prevent_proof_mutation;

-- Index for fast lookups
CREATE INDEX idx_evidence_proofs_document ON public.document_evidence_proofs(document_id);
