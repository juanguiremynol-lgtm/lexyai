-- Create table for judicial term suspensions
CREATE TABLE public.judicial_term_suspensions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  reason TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  scope TEXT NOT NULL DEFAULT 'GLOBAL_JUDICIAL',
  scope_value TEXT, -- Optional: for BY_JURISDICTION or BY_COURT scopes
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Create index for efficient date range queries
CREATE INDEX idx_judicial_suspensions_dates ON public.judicial_term_suspensions(start_date, end_date) WHERE active = true;
CREATE INDEX idx_judicial_suspensions_owner ON public.judicial_term_suspensions(owner_id);

-- Enable RLS
ALTER TABLE public.judicial_term_suspensions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own judicial suspensions" 
ON public.judicial_term_suspensions 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own judicial suspensions" 
ON public.judicial_term_suspensions 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own judicial suspensions" 
ON public.judicial_term_suspensions 
FOR UPDATE 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own judicial suspensions" 
ON public.judicial_term_suspensions 
FOR DELETE 
USING (auth.uid() = owner_id);

-- Trigger for updated_at
CREATE TRIGGER update_judicial_term_suspensions_updated_at
BEFORE UPDATE ON public.judicial_term_suspensions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();