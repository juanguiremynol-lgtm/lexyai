-- Estados Staleness Alert Engine
-- Track ingestion runs and settings for staleness alerts

-- 1. Create ingestion_runs table to track ESTADOS ingestion events
CREATE TABLE IF NOT EXISTS public.ingestion_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  ingestion_type TEXT NOT NULL DEFAULT 'ESTADOS', -- ESTADOS, CRAWLER, ICARUS
  source TEXT NOT NULL DEFAULT 'ICARUS', -- ICARUS, SCRAPER, API
  status TEXT NOT NULL DEFAULT 'SUCCESS', -- SUCCESS, FAIL, PARTIAL
  rows_processed INTEGER DEFAULT 0,
  rows_imported INTEGER DEFAULT 0,
  rows_duplicate INTEGER DEFAULT 0,
  rows_failed INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add staleness alert settings to organizations table
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS estados_staleness_alerts_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS estados_staleness_email_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS estados_staleness_threshold_days INTEGER DEFAULT 3;

-- 3. Create estados_staleness_alerts table to track alert state
CREATE TABLE IF NOT EXISTS public.estados_staleness_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, RESOLVED, DISMISSED
  last_ingestion_at TIMESTAMPTZ,
  alert_created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_email_sent_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  emails_sent_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

-- 4. Enable RLS
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados_staleness_alerts ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies for ingestion_runs
CREATE POLICY "Users can view their organization ingestion runs"
  ON public.ingestion_runs FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can insert ingestion runs for their organization"
  ON public.ingestion_runs FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

-- 6. RLS policies for estados_staleness_alerts
CREATE POLICY "Users can view their organization staleness alerts"
  ON public.estados_staleness_alerts FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can update their organization staleness alerts"
  ON public.estados_staleness_alerts FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

-- 7. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_org_created 
  ON public.ingestion_runs(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_type_status 
  ON public.ingestion_runs(ingestion_type, status);

CREATE INDEX IF NOT EXISTS idx_staleness_alerts_org_status 
  ON public.estados_staleness_alerts(organization_id, status);

-- 8. Add trigger for updated_at
CREATE TRIGGER update_estados_staleness_alerts_updated_at
  BEFORE UPDATE ON public.estados_staleness_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();