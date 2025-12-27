-- Create desacato_incidents table for tracking contempt incidents
CREATE TABLE public.desacato_incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tutela_id UUID NOT NULL REFERENCES public.filings(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'DESACATO_RADICACION',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  radicacion_date DATE,
  requerimiento_date DATE,
  segunda_solicitud_date DATE,
  apertura_date DATE,
  fallo_date DATE,
  fallo_favorable BOOLEAN
);

-- Enable RLS
ALTER TABLE public.desacato_incidents ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view own desacato_incidents"
  ON public.desacato_incidents
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own desacato_incidents"
  ON public.desacato_incidents
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own desacato_incidents"
  ON public.desacato_incidents
  FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own desacato_incidents"
  ON public.desacato_incidents
  FOR DELETE
  USING (auth.uid() = owner_id);

-- Create indexes
CREATE INDEX idx_desacato_incidents_tutela_id ON public.desacato_incidents(tutela_id);
CREATE INDEX idx_desacato_incidents_owner_id ON public.desacato_incidents(owner_id);
CREATE INDEX idx_desacato_incidents_phase ON public.desacato_incidents(phase);

-- Create trigger for updated_at
CREATE TRIGGER update_desacato_incidents_updated_at
  BEFORE UPDATE ON public.desacato_incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();