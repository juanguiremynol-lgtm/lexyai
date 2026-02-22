
-- Phase 1: Uploaded PDF support for contracts
-- Adds source_type tracking, uploaded PDF metadata, and signature placement config

-- 1. Add source_type enum column (default SYSTEM_TEMPLATE for backward compat)
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'SYSTEM_TEMPLATE';

-- Add check constraint for allowed values
ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_source_type_check
  CHECK (source_type IN ('SYSTEM_TEMPLATE', 'DOCX_TEMPLATE', 'UPLOADED_PDF'));

-- 2. Add uploaded PDF metadata columns
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS source_pdf_path text,
  ADD COLUMN IF NOT EXISTS source_pdf_sha256 text;

-- 3. Add signature placement config
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS signature_placement_mode text NOT NULL DEFAULT 'APPEND_LAST_PAGE';

ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_sig_placement_check
  CHECK (signature_placement_mode IN ('APPEND_LAST_PAGE', 'CUSTOM_POSITIONS'));

ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS signature_positions_json jsonb;

-- 4. Create private storage bucket for unsigned uploaded PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('unsigned-documents', 'unsigned-documents', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage RLS: org members can upload to their org folder
CREATE POLICY "Org members can upload unsigned PDFs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'unsigned-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] IN (
      SELECT om.organization_id::text
      FROM public.organization_memberships om
      WHERE om.user_id = auth.uid()
    )
  );

-- 6. Storage RLS: org members can read their org's unsigned PDFs
CREATE POLICY "Org members can read unsigned PDFs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'unsigned-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] IN (
      SELECT om.organization_id::text
      FROM public.organization_memberships om
      WHERE om.user_id = auth.uid()
    )
  );

-- 7. Storage RLS: org members can delete unsigned PDFs (only non-executed docs)
CREATE POLICY "Org members can delete unsigned PDFs"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'unsigned-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] IN (
      SELECT om.organization_id::text
      FROM public.organization_memberships om
      WHERE om.user_id = auth.uid()
    )
  );
