-- Add acta_reparto_received_at milestone field to work_items
ALTER TABLE public.work_items 
ADD COLUMN IF NOT EXISTS acta_reparto_received_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS acta_reparto_notes TEXT NULL;

-- Create work_item_reminders table for automated milestone tracking reminders
CREATE TYPE public.reminder_type AS ENUM (
  'ACTA_REPARTO_PENDING',
  'RADICADO_PENDING', 
  'EXPEDIENTE_PENDING',
  'AUTO_ADMISORIO_PENDING'
);

CREATE TYPE public.reminder_status AS ENUM (
  'ACTIVE',
  'COMPLETED',
  'SNOOZED',
  'DISMISSED'
);

CREATE TABLE public.work_item_reminders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  
  -- Reminder classification
  reminder_type public.reminder_type NOT NULL,
  
  -- Scheduling
  cadence_business_days INTEGER NOT NULL DEFAULT 5,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_triggered_at TIMESTAMPTZ NULL,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  
  -- Status tracking
  status public.reminder_status NOT NULL DEFAULT 'ACTIVE',
  completed_at TIMESTAMPTZ NULL,
  dismissed_at TIMESTAMPTZ NULL,
  snoozed_until TIMESTAMPTZ NULL,
  
  -- Audit
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX idx_work_item_reminders_org_status ON public.work_item_reminders(organization_id, status);
CREATE INDEX idx_work_item_reminders_work_item ON public.work_item_reminders(work_item_id);
CREATE INDEX idx_work_item_reminders_next_run ON public.work_item_reminders(next_run_at) WHERE status = 'ACTIVE';
CREATE INDEX idx_work_item_reminders_owner ON public.work_item_reminders(owner_id);

-- Unique constraint: only one active reminder per type per work_item
CREATE UNIQUE INDEX idx_work_item_reminders_unique_active 
ON public.work_item_reminders(work_item_id, reminder_type) 
WHERE status = 'ACTIVE';

-- Enable RLS
ALTER TABLE public.work_item_reminders ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can only access reminders for their work_items
CREATE POLICY "Users can view their own reminders" 
ON public.work_item_reminders 
FOR SELECT 
USING (owner_id = auth.uid());

CREATE POLICY "Users can create reminders for their work items" 
ON public.work_item_reminders 
FOR INSERT 
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update their own reminders" 
ON public.work_item_reminders 
FOR UPDATE 
USING (owner_id = auth.uid());

CREATE POLICY "Users can delete their own reminders" 
ON public.work_item_reminders 
FOR DELETE 
USING (owner_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_work_item_reminders_updated_at
BEFORE UPDATE ON public.work_item_reminders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();