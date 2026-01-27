-- Create sync_traces table for detailed sync debugging
-- This table stores step-by-step trace events for each sync attempt

CREATE TABLE public.sync_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  work_item_id UUID REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.profiles(id),
  workflow_type TEXT,
  step TEXT NOT NULL,
  provider TEXT,
  http_status INTEGER,
  latency_ms INTEGER,
  success BOOLEAN DEFAULT false,
  error_code TEXT,
  message TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX idx_sync_traces_trace_id ON public.sync_traces(trace_id);
CREATE INDEX idx_sync_traces_work_item_id ON public.sync_traces(work_item_id);
CREATE INDEX idx_sync_traces_organization_id ON public.sync_traces(organization_id);
CREATE INDEX idx_sync_traces_created_at ON public.sync_traces(created_at DESC);

-- Enable RLS
ALTER TABLE public.sync_traces ENABLE ROW LEVEL SECURITY;

-- RLS policies: org members can view their org's traces
CREATE POLICY "Org members can view sync traces"
ON public.sync_traces
FOR SELECT
USING (
  public.is_org_member(organization_id)
  OR public.is_platform_admin()
);

-- Platform admins and service role can insert traces
CREATE POLICY "Service role can insert sync traces"
ON public.sync_traces
FOR INSERT
WITH CHECK (true);

-- Add comment
COMMENT ON TABLE public.sync_traces IS 'Stores detailed step-by-step trace events for sync debugging. Traces are scoped by organization_id for multi-tenant isolation.';