
-- ============================================================
-- Coverage Gap Signal Table
-- Tracks when external providers return no data for a work item
-- ============================================================

CREATE TABLE public.work_item_coverage_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  workflow TEXT NOT NULL,
  data_kind TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  radicado TEXT NOT NULL,
  despacho TEXT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrences INT NOT NULL DEFAULT 1,
  last_http_status INT NULL,
  last_response_redacted JSONB NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe: one gap per (work_item, data_kind, provider)
CREATE UNIQUE INDEX idx_coverage_gaps_dedupe 
  ON public.work_item_coverage_gaps (work_item_id, data_kind, provider_key);

-- Fast lookup by org + status
CREATE INDEX idx_coverage_gaps_org_status
  ON public.work_item_coverage_gaps (org_id, status);

-- Enable RLS
ALTER TABLE public.work_item_coverage_gaps ENABLE ROW LEVEL SECURITY;

-- Org members can read their org's gaps
CREATE POLICY "Org members can view coverage gaps"
  ON public.work_item_coverage_gaps
  FOR SELECT
  USING (public.is_org_member(org_id));

-- Only service role can write (edge functions)
-- No INSERT/UPDATE/DELETE policies for authenticated users
-- Service role bypasses RLS automatically
