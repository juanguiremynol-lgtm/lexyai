-- Create work_item_deadlines table (unified deadlines for all workflow types)
CREATE TABLE IF NOT EXISTS public.work_item_deadlines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  deadline_type TEXT NOT NULL, -- e.g., 'TRASLADO_DEMANDA', 'REFORMA', 'APELACION_SENTENCIA', etc.
  label TEXT NOT NULL, -- Human-readable label
  description TEXT,
  trigger_event TEXT NOT NULL, -- What triggered this deadline (e.g., 'NOTIFICACION_ELECTRONICA')
  trigger_date DATE NOT NULL, -- When the trigger occurred
  deadline_date DATE NOT NULL, -- Calculated deadline date
  business_days_count INTEGER, -- Number of business days used in calculation
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'MET', 'MISSED', 'CANCELLED')),
  met_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  calculation_meta JSONB, -- Stores calculation details for explainability
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.work_item_deadlines ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own work_item_deadlines"
  ON public.work_item_deadlines FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert their own work_item_deadlines"
  ON public.work_item_deadlines FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update their own work_item_deadlines"
  ON public.work_item_deadlines FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Users can delete their own work_item_deadlines"
  ON public.work_item_deadlines FOR DELETE
  USING (owner_id = auth.uid());

-- Create index for fast lookups
CREATE INDEX idx_work_item_deadlines_work_item_id ON public.work_item_deadlines(work_item_id);
CREATE INDEX idx_work_item_deadlines_status ON public.work_item_deadlines(status);
CREATE INDEX idx_work_item_deadlines_deadline_date ON public.work_item_deadlines(deadline_date);

-- Add updated_at trigger
CREATE TRIGGER update_work_item_deadlines_updated_at
  BEFORE UPDATE ON public.work_item_deadlines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add CPACA to entity_type enum for alert_rules and alert_instances if not exists
-- First check if CPACA exists in entity type usage
DO $$
BEGIN
  -- Update existing alert_rules to support CPACA
  -- The entity_type is TEXT so no enum changes needed
  NULL;
END $$;