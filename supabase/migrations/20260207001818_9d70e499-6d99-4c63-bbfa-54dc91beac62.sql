
-- Atenia AI Reports table for sync supervisor diagnostics
CREATE TABLE public.atenia_ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'DAILY_AUDIT',
  
  -- Summary metrics
  total_work_items INT DEFAULT 0,
  items_synced_ok INT DEFAULT 0,
  items_synced_partial INT DEFAULT 0,
  items_failed INT DEFAULT 0,
  new_actuaciones_found INT DEFAULT 0,
  new_publicaciones_found INT DEFAULT 0,
  
  -- Provider health snapshot
  provider_status JSONB DEFAULT '{}',
  
  -- Diagnostics array (human-readable Spanish)
  diagnostics JSONB DEFAULT '[]',
  
  -- Remediation actions taken
  remediation_actions JSONB DEFAULT '[]',
  
  -- Gemini AI diagnosis (if used)
  ai_diagnosis TEXT,
  
  -- Lexy data readiness flag
  lexy_data_ready BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, report_date, report_type)
);

-- Indexes
CREATE INDEX idx_atenia_reports_date ON public.atenia_ai_reports (report_date DESC);
CREATE INDEX idx_atenia_reports_org ON public.atenia_ai_reports (organization_id);

-- RLS
ALTER TABLE public.atenia_ai_reports ENABLE ROW LEVEL SECURITY;

-- Platform admins can read all reports
CREATE POLICY "Platform admins can read all reports"
ON public.atenia_ai_reports FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
);

-- Org admins can read their org's reports
CREATE POLICY "Org admins can read own org reports"
ON public.atenia_ai_reports FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.organization_memberships
    WHERE user_id = auth.uid()
    AND organization_id = atenia_ai_reports.organization_id
    AND role IN ('admin', 'owner')
  )
);

-- Service role insert (edge functions use service role)
CREATE POLICY "Service role can insert reports"
ON public.atenia_ai_reports FOR INSERT
WITH CHECK (true);

-- Service role update
CREATE POLICY "Service role can update reports"
ON public.atenia_ai_reports FOR UPDATE
USING (true);

-- Retention cleanup: keep 90 days
COMMENT ON TABLE public.atenia_ai_reports IS 'Atenia AI sync supervisor diagnostic reports. Retain 90 days.';
