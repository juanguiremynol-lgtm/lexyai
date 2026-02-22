-- Allow content_html to be NULL for UPLOADED_PDF documents
ALTER TABLE public.generated_documents
  ALTER COLUMN content_html DROP NOT NULL;

-- Ensure content_html is present for template-based documents
-- and source_pdf_path is present for uploaded PDFs
ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_content_source_check
  CHECK (
    (source_type IN ('SYSTEM_TEMPLATE', 'DOCX_TEMPLATE') AND content_html IS NOT NULL)
    OR
    (source_type = 'UPLOADED_PDF' AND source_pdf_path IS NOT NULL AND source_pdf_sha256 IS NOT NULL)
  );