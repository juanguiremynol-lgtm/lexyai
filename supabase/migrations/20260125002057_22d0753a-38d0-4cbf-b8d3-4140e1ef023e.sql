-- =============================================================
-- PHASE 2 HARDENING: MONITORING, RATE LIMITS, AND PERFORMANCE
-- =============================================================

-- 1) SYSTEM HEALTH TABLES
-- =============================================================

-- System health events (log all issues and key events)
CREATE TABLE public.system_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OK', 'WARN', 'ERROR')),
  message TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- System health heartbeat (last known state per service)
CREATE TABLE public.system_health_heartbeat (
  service TEXT PRIMARY KEY,
  last_ok_at TIMESTAMPTZ NULL,
  last_error_at TIMESTAMPTZ NULL,
  last_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (last_status IN ('UNKNOWN', 'OK', 'WARN', 'ERROR')),
  last_message TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Job runs (execution log for cron/scheduled jobs)
CREATE TABLE public.job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  organization_id UUID NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'OK', 'ERROR')),
  processed_count INT DEFAULT 0,
  error TEXT NULL,
  duration_ms INT NULL
);

-- 2) RATE LIMITS TABLE
-- =============================================================
CREATE TABLE public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 0,
  UNIQUE (organization_id, key, window_start)
);

-- 3) RLS POLICIES
-- =============================================================

-- System health events: org members can read their own, service role can insert
ALTER TABLE public.system_health_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their system health events"
  ON public.system_health_events FOR SELECT
  USING (
    organization_id IS NULL OR 
    organization_id = get_user_organization_id()
  );

CREATE POLICY "Service role can insert system health events"
  ON public.system_health_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can insert for their org"
  ON public.system_health_events FOR INSERT
  WITH CHECK (
    organization_id IS NULL OR 
    organization_id = get_user_organization_id()
  );

-- System health heartbeat: everyone can read, service role writes
ALTER TABLE public.system_health_heartbeat ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can read heartbeat"
  ON public.system_health_heartbeat FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage heartbeat"
  ON public.system_health_heartbeat FOR ALL
  USING (true);

-- Job runs: org-scoped read, service role writes
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their job runs"
  ON public.job_runs FOR SELECT
  USING (
    organization_id IS NULL OR 
    organization_id = get_user_organization_id()
  );

CREATE POLICY "Service role can manage job runs"
  ON public.job_runs FOR ALL
  USING (true);

-- Rate limits: org-scoped
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their rate limits"
  ON public.rate_limits FOR SELECT
  USING (organization_id = get_user_organization_id());

CREATE POLICY "Service role can manage rate limits"
  ON public.rate_limits FOR ALL
  USING (true);

CREATE POLICY "Users can manage their org rate limits"
  ON public.rate_limits FOR ALL
  USING (organization_id = get_user_organization_id());

-- 4) PERFORMANCE INDEXES
-- =============================================================

-- Work items indexes (most queried table)
CREATE INDEX IF NOT EXISTS idx_work_items_org_id ON public.work_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_work_items_org_workflow_stage ON public.work_items(owner_id, workflow_type, stage);
CREATE INDEX IF NOT EXISTS idx_work_items_org_radicado ON public.work_items(owner_id, radicado) WHERE radicado IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_org_deleted ON public.work_items(owner_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_work_items_active ON public.work_items(owner_id, status, deleted_at) WHERE deleted_at IS NULL;

-- Clients indexes
CREATE INDEX IF NOT EXISTS idx_clients_org_id ON public.clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_clients_org_name ON public.clients(owner_id, name);
CREATE INDEX IF NOT EXISTS idx_clients_deleted ON public.clients(owner_id, deleted_at);

-- Tasks indexes
CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON public.tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status_due ON public.tasks(owner_id, status, due_at);

-- Work item acts indexes
CREATE INDEX IF NOT EXISTS idx_work_item_acts_org ON public.work_item_acts(owner_id);
CREATE INDEX IF NOT EXISTS idx_work_item_acts_item_date ON public.work_item_acts(work_item_id, created_at DESC);

-- Process events indexes
CREATE INDEX IF NOT EXISTS idx_process_events_org ON public.process_events(owner_id);
CREATE INDEX IF NOT EXISTS idx_process_events_filing_date ON public.process_events(filing_id, created_at DESC);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_date ON public.audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

-- Email outbox indexes
CREATE INDEX IF NOT EXISTS idx_email_outbox_pending ON public.email_outbox(organization_id, status, next_attempt_at) 
  WHERE status IN ('PENDING', 'FAILED');

-- Alert instances indexes
CREATE INDEX IF NOT EXISTS idx_alert_instances_org ON public.alert_instances(owner_id);
CREATE INDEX IF NOT EXISTS idx_alert_instances_status ON public.alert_instances(owner_id, status, created_at DESC);

-- System health indexes
CREATE INDEX IF NOT EXISTS idx_system_health_events_org_date ON public.system_health_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_health_events_service ON public.system_health_events(service, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_name_date ON public.job_runs(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_org_date ON public.job_runs(organization_id, started_at DESC);