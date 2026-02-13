
-- Phase 2: Add subscription_events table for audit trail of subscription lifecycle
-- This table records all state changes in human-readable Spanish for compliance
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- ADMIN_EXTEND_TRIAL, ADMIN_FORCE_RE_VERIFY, PAYMENT_VERIFIED, ACTIVATION_REQUESTED, etc.
  description TEXT NOT NULL, -- Spanish human-readable description for the event
  actor_user_id UUID, -- null for system events
  actor_type TEXT NOT NULL DEFAULT 'SYSTEM', -- ADMIN, SYSTEM, PAYMENT_GATEWAY
  metadata JSONB, -- previous_state, new_state, reason, etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT subscription_events_event_type_valid CHECK (
    event_type IN (
      'ADMIN_EXTEND_TRIAL', 'ADMIN_FORCE_RE_VERIFY', 'ADMIN_SCHEDULE_CANCELLATION', 
      'ADMIN_REVERSE_CANCELLATION', 'ADMIN_GRANT_COMP',
      'PAYMENT_VERIFIED', 'PAYMENT_FAILED', 'PAYMENT_REJECTED',
      'ACTIVATION_REQUESTED', 'ACTIVATION_COMPLETED', 'ACTIVATION_FAILED',
      'RENEWAL_SCHEDULED', 'RENEWAL_COMPLETED', 'RENEWAL_FAILED',
      'CANCELLATION_SCHEDULED', 'CANCELLATION_REVERSED', 'CANCELLATION_COMPLETED',
      'TRIAL_ENDED', 'COMP_EXPIRED', 'SUSPENSION', 'REACTIVATION'
    )
  )
);

-- Index for efficient lookups
CREATE INDEX idx_subscription_events_org_created ON public.subscription_events(organization_id, created_at DESC);
CREATE INDEX idx_subscription_events_event_type ON public.subscription_events(event_type);

-- Enable RLS
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- Only platform admins can view subscription events (for cross-org transparency)
CREATE POLICY "Platform admins can read all subscription events"
  ON public.subscription_events
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Only service_role can insert (from edge functions)
CREATE POLICY "Only service_role can insert subscription events"
  ON public.subscription_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);
