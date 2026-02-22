
-- Create document_pdf_jobs table for async PDF generation pipeline
CREATE TABLE public.document_pdf_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.generated_documents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  result_path TEXT,
  pdf_sha256 TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- Index for polling/processing
CREATE INDEX idx_pdf_jobs_status ON public.document_pdf_jobs(status) WHERE status IN ('queued', 'running');
CREATE INDEX idx_pdf_jobs_document ON public.document_pdf_jobs(document_id);

-- Enable RLS
ALTER TABLE public.document_pdf_jobs ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's jobs
CREATE POLICY "Org members can read pdf_jobs"
  ON public.document_pdf_jobs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.organization_id = document_pdf_jobs.organization_id
        AND om.user_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_pdf_jobs_updated_at
  BEFORE UPDATE ON public.document_pdf_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
