-- Add hearing reminder intervals to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS hearing_reminder_days jsonb DEFAULT '[1, 3, 7]'::jsonb;

-- Create peticion_phase enum
CREATE TYPE public.peticion_phase AS ENUM (
  'PETICION_RADICADA',
  'CONSTANCIA_RADICACION',
  'RESPUESTA'
);

-- Create peticiones table
CREATE TABLE public.peticiones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  
  -- Peticion details
  entity_name TEXT NOT NULL,
  entity_type TEXT CHECK (entity_type IN ('PUBLIC', 'PRIVATE')) DEFAULT 'PUBLIC',
  entity_email TEXT,
  entity_address TEXT,
  
  -- Subject and content
  subject TEXT NOT NULL,
  description TEXT,
  
  -- Tracking
  radicado TEXT,
  filed_at TIMESTAMP WITH TIME ZONE,
  constancia_received_at TIMESTAMP WITH TIME ZONE,
  response_received_at TIMESTAMP WITH TIME ZONE,
  
  -- Deadlines (15 business days from filed_at, can be extended)
  deadline_at TIMESTAMP WITH TIME ZONE,
  prorogation_requested BOOLEAN DEFAULT false,
  prorogation_deadline_at TIMESTAMP WITH TIME ZONE,
  
  -- Phase
  phase peticion_phase NOT NULL DEFAULT 'PETICION_RADICADA',
  
  -- Escalation to tutela
  escalated_to_tutela BOOLEAN DEFAULT false,
  tutela_filing_id UUID REFERENCES public.filings(id) ON DELETE SET NULL,
  
  -- Notes and metadata
  notes TEXT,
  proof_file_path TEXT,
  response_file_path TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.peticiones ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view own peticiones" 
ON public.peticiones 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own peticiones" 
ON public.peticiones 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own peticiones" 
ON public.peticiones 
FOR UPDATE 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own peticiones" 
ON public.peticiones 
FOR DELETE 
USING (auth.uid() = owner_id);

-- Create trigger for updated_at
CREATE TRIGGER update_peticiones_updated_at
BEFORE UPDATE ON public.peticiones
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create peticion_alerts table for tracking deadline alerts
CREATE TABLE public.peticion_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  peticion_id UUID NOT NULL REFERENCES public.peticiones(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('DEADLINE_WARNING', 'DEADLINE_CRITICAL', 'PROROGATION_DEADLINE', 'UNANSWERED_ESCALATE')),
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARN', 'CRITICAL')),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for peticion_alerts
ALTER TABLE public.peticion_alerts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for peticion_alerts
CREATE POLICY "Users can view own peticion_alerts" 
ON public.peticion_alerts 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own peticion_alerts" 
ON public.peticion_alerts 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own peticion_alerts" 
ON public.peticion_alerts 
FOR UPDATE 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own peticion_alerts" 
ON public.peticion_alerts 
FOR DELETE 
USING (auth.uid() = owner_id);