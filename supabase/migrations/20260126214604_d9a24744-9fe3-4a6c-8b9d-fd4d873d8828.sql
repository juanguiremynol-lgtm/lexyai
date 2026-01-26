-- ============================================
-- NOTIFICATION RULES TABLE (org-scoped rules engine)
-- ============================================
CREATE TABLE public.notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Scope filters
  workflow_types TEXT[] DEFAULT '{}', -- empty = all workflows
  alert_categories TEXT[] DEFAULT '{}', -- MILESTONE, HEARING, TERMS, SYSTEM, UPDATES
  severity_min TEXT NOT NULL DEFAULT 'INFO', -- INFO, WARNING, CRITICAL
  
  -- Trigger conditions
  trigger_event TEXT NOT NULL, -- ON_ALERT_CREATE, ON_STATUS_CHANGE, ON_DUE_APPROACHING, ON_STALE
  trigger_params JSONB DEFAULT '{}', -- e.g. {"days_before": 3} for due approaching
  
  -- Throttling/dedupe
  dedupe_window_minutes INTEGER DEFAULT 1440, -- 24 hours default
  max_per_10min INTEGER DEFAULT 10,
  
  -- Recipient configuration
  recipient_mode TEXT NOT NULL DEFAULT 'OWNER', -- OWNER, ASSIGNED, SPECIFIC, DISTRIBUTION, ROLE
  recipient_emails TEXT[] DEFAULT '{}', -- for SPECIFIC mode
  recipient_role TEXT, -- for ROLE mode
  use_recipient_directory BOOLEAN DEFAULT false, -- use notification_recipients table
  
  -- Template
  email_template_id TEXT, -- optional template reference
  subject_template TEXT,
  body_template TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ -- soft delete
);

-- Enable RLS
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Org members can view notification rules"
  ON public.notification_rules FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Org admins can manage notification rules"
  ON public.notification_rules FOR ALL
  USING (public.is_org_admin(organization_id));

-- Indexes
CREATE INDEX idx_notification_rules_org ON public.notification_rules(organization_id);
CREATE INDEX idx_notification_rules_enabled ON public.notification_rules(organization_id, enabled) WHERE deleted_at IS NULL;

-- ============================================
-- NOTIFICATION RECIPIENTS TABLE (org-level directory)
-- ============================================
CREATE TABLE public.notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  label TEXT NOT NULL, -- "Main Admin", "Litigation Team", etc.
  enabled BOOLEAN NOT NULL DEFAULT true,
  tags TEXT[] DEFAULT '{}', -- for grouping
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(organization_id, email)
);

-- Enable RLS
ALTER TABLE public.notification_recipients ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Org members can view recipients"
  ON public.notification_recipients FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Org admins can manage recipients"
  ON public.notification_recipients FOR ALL
  USING (public.is_org_admin(organization_id));

-- Index
CREATE INDEX idx_notification_recipients_org ON public.notification_recipients(organization_id);

-- ============================================
-- EMAIL DELIVERY EVENTS TABLE (webhook audit trail)
-- ============================================
CREATE TABLE public.email_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email_outbox_id UUID REFERENCES public.email_outbox(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL, -- QUEUED, SENT, DELIVERED, OPENED, CLICKED, BOUNCED, COMPLAINED, FAILED
  raw_payload JSONB,
  provider_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Org members can view delivery events"
  ON public.email_delivery_events FOR SELECT
  USING (public.is_org_member(organization_id));

-- Index
CREATE INDEX idx_email_delivery_events_outbox ON public.email_delivery_events(email_outbox_id);
CREATE INDEX idx_email_delivery_events_org ON public.email_delivery_events(organization_id, created_at DESC);

-- ============================================
-- EXTEND EMAIL_OUTBOX WITH AUDIT METADATA
-- ============================================
ALTER TABLE public.email_outbox
ADD COLUMN IF NOT EXISTS notification_rule_id UUID REFERENCES public.notification_rules(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS trigger_reason TEXT, -- machine-readable: hearing_reminder_72h, critical_alert_created
ADD COLUMN IF NOT EXISTS trigger_event TEXT, -- ON_ALERT_CREATE, ON_STATUS_CHANGE, etc.
ADD COLUMN IF NOT EXISTS work_item_id UUID REFERENCES public.work_items(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS alert_instance_id UUID REFERENCES public.alert_instances(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS template_id TEXT,
ADD COLUMN IF NOT EXISTS template_variables JSONB,
ADD COLUMN IF NOT EXISTS triggered_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS dedupe_key TEXT; -- for preventing duplicate sends

-- Index for dedupe checking
CREATE INDEX IF NOT EXISTS idx_email_outbox_dedupe ON public.email_outbox(organization_id, dedupe_key, created_at DESC) WHERE dedupe_key IS NOT NULL;

-- Index for work item lookups
CREATE INDEX IF NOT EXISTS idx_email_outbox_work_item ON public.email_outbox(work_item_id) WHERE work_item_id IS NOT NULL;

-- ============================================
-- UPDATED_AT TRIGGER FOR NOTIFICATION_RULES
-- ============================================
CREATE TRIGGER update_notification_rules_updated_at
  BEFORE UPDATE ON public.notification_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_notification_recipients_updated_at
  BEFORE UPDATE ON public.notification_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON TABLE public.notification_rules IS 'Org-scoped email notification rules configured by admins';
COMMENT ON TABLE public.notification_recipients IS 'Org-level directory of notification email recipients';
COMMENT ON TABLE public.email_delivery_events IS 'Webhook events for email delivery tracking (Resend, etc.)';
COMMENT ON COLUMN public.email_outbox.trigger_reason IS 'Machine-readable reason code like hearing_reminder_72h, critical_alert_created';
COMMENT ON COLUMN public.email_outbox.dedupe_key IS 'Composite key for preventing duplicate emails within dedupe window';