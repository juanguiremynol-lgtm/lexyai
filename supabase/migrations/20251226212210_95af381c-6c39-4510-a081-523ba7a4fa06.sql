-- =====================================================
-- Alert System v2 Schema
-- =====================================================

-- Drop old review-related task types if needed (keep for backwards compat)
-- We'll just stop creating new REVIEW_PROCESS and REVIEW_FILING tasks

-- Create alert_rules table
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('CGP_FILING', 'CGP_CASE', 'ADMIN_PROCESS', 'PETICION', 'TUTELA')),
  entity_id UUID NOT NULL,
  rule_kind TEXT NOT NULL CHECK (rule_kind IN ('DATE_DUE', 'REPEAT_INTERVAL', 'PHASE_TRIGGER')),
  title TEXT NOT NULL,
  description TEXT,
  channels TEXT[] NOT NULL DEFAULT ARRAY['IN_APP'],
  email_recipients TEXT[],
  is_optional_user_defined BOOLEAN DEFAULT true,
  is_system_mandatory BOOLEAN DEFAULT false,
  due_at TIMESTAMPTZ,
  first_fire_at TIMESTAMPTZ,
  repeat_every_business_days INTEGER,
  repeat_every_days INTEGER,
  next_fire_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  stop_condition JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create alert_instances table
CREATE TABLE IF NOT EXISTS public.alert_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alert_rule_id UUID REFERENCES public.alert_rules(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED')),
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  next_fire_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB,
  actions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add new fields to peticiones for prórroga handling
ALTER TABLE public.peticiones 
ADD COLUMN IF NOT EXISTS prorogation_started_at TIMESTAMPTZ;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_alert_rules_owner ON public.alert_rules(owner_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_entity ON public.alert_rules(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON public.alert_rules(active, next_fire_at);
CREATE INDEX IF NOT EXISTS idx_alert_instances_owner ON public.alert_instances(owner_id);
CREATE INDEX IF NOT EXISTS idx_alert_instances_status ON public.alert_instances(status, severity);
CREATE INDEX IF NOT EXISTS idx_alert_instances_entity ON public.alert_instances(entity_type, entity_id);

-- Enable RLS on new tables
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_instances ENABLE ROW LEVEL SECURITY;

-- RLS Policies for alert_rules
CREATE POLICY "Users can view their own alert rules" 
ON public.alert_rules FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own alert rules" 
ON public.alert_rules FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own alert rules" 
ON public.alert_rules FOR UPDATE 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own alert rules" 
ON public.alert_rules FOR DELETE 
USING (auth.uid() = owner_id);

-- RLS Policies for alert_instances
CREATE POLICY "Users can view their own alert instances" 
ON public.alert_instances FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own alert instances" 
ON public.alert_instances FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own alert instances" 
ON public.alert_instances FOR UPDATE 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own alert instances" 
ON public.alert_instances FOR DELETE 
USING (auth.uid() = owner_id);

-- Trigger for updated_at on alert_rules
CREATE TRIGGER update_alert_rules_updated_at
BEFORE UPDATE ON public.alert_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();