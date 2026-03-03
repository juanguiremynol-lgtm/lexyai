
-- Estado attachment download queue for durable PDF ingestion
CREATE TABLE IF NOT EXISTS public.estado_attachment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL,
  publicacion_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  remote_url TEXT NOT NULL,
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'downloading', 'downloaded', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  storage_path TEXT,
  downloaded_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for queue processing
CREATE INDEX idx_estado_attachment_queue_status ON public.estado_attachment_queue (status, next_retry_at) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_estado_attachment_queue_work_item ON public.estado_attachment_queue (work_item_id);

-- Unique constraint to prevent duplicate downloads
CREATE UNIQUE INDEX idx_estado_attachment_queue_dedup ON public.estado_attachment_queue (publicacion_id, remote_url);

-- Enable RLS
ALTER TABLE public.estado_attachment_queue ENABLE ROW LEVEL SECURITY;

-- Only service role can manage the queue
CREATE POLICY "Service role manages attachment queue"
  ON public.estado_attachment_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can view their org's attachments  
CREATE POLICY "Users can view org attachment queue"
  ON public.estado_attachment_queue
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Updated_at trigger
CREATE TRIGGER update_estado_attachment_queue_updated_at
  BEFORE UPDATE ON public.estado_attachment_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
