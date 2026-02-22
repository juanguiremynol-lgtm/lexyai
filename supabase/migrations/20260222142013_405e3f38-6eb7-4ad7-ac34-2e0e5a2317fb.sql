-- Add distribution_sent_at to document_pdf_jobs for email idempotency
ALTER TABLE public.document_pdf_jobs
ADD COLUMN IF NOT EXISTS distribution_sent_at timestamptz DEFAULT NULL;