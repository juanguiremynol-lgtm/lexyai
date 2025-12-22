-- Create enum for data sources
DO $$ BEGIN
  CREATE TYPE public.data_source AS ENUM ('CPNU', 'PUBLICACIONES', 'HISTORICO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create enum for event types
DO $$ BEGIN
  CREATE TYPE public.process_event_type AS ENUM (
    'ACTUACION', 'ESTADO_ELECTRONICO', 'NOTIFICACION', 
    'AUTO', 'SENTENCIA', 'PROVIDENCIA', 'MEMORIAL', 
    'TRASLADO', 'AUDIENCIA', 'OTRO'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create monitored_processes table for standalone process monitoring
CREATE TABLE IF NOT EXISTS public.monitored_processes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  radicado TEXT NOT NULL,
  despacho_name TEXT,
  department TEXT,
  municipality TEXT,
  jurisdiction TEXT,
  sources_enabled JSONB DEFAULT '["CPNU"]'::jsonb,
  monitoring_enabled BOOLEAN DEFAULT false,
  monitoring_schedule TEXT DEFAULT '0 7 * * *',
  last_checked_at TIMESTAMPTZ,
  last_change_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, radicado)
);

-- Enable RLS on monitored_processes
ALTER TABLE public.monitored_processes ENABLE ROW LEVEL SECURITY;

-- RLS policies for monitored_processes
CREATE POLICY "Users can view own monitored_processes" 
  ON public.monitored_processes FOR SELECT 
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own monitored_processes" 
  ON public.monitored_processes FOR INSERT 
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own monitored_processes" 
  ON public.monitored_processes FOR UPDATE 
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own monitored_processes" 
  ON public.monitored_processes FOR DELETE 
  USING (auth.uid() = owner_id);

-- Add new columns to process_events table if they don't exist
ALTER TABLE public.process_events 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'CPNU',
  ADD COLUMN IF NOT EXISTS hash_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS detail TEXT,
  ADD COLUMN IF NOT EXISTS monitored_process_id UUID REFERENCES public.monitored_processes(id) ON DELETE CASCADE;

-- Create index on hash_fingerprint for deduplication
CREATE INDEX IF NOT EXISTS idx_process_events_fingerprint ON public.process_events(hash_fingerprint);
CREATE INDEX IF NOT EXISTS idx_process_events_source ON public.process_events(source);
CREATE INDEX IF NOT EXISTS idx_process_events_monitored ON public.process_events(monitored_process_id);

-- Create evidence_snapshots table
CREATE TABLE IF NOT EXISTS public.evidence_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  process_event_id UUID REFERENCES public.process_events(id) ON DELETE CASCADE,
  monitored_process_id UUID REFERENCES public.monitored_processes(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  screenshot_path TEXT,
  raw_html TEXT,
  raw_markdown TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on evidence_snapshots
ALTER TABLE public.evidence_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS policies for evidence_snapshots
CREATE POLICY "Users can view own evidence_snapshots" 
  ON public.evidence_snapshots FOR SELECT 
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own evidence_snapshots" 
  ON public.evidence_snapshots FOR INSERT 
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can delete own evidence_snapshots" 
  ON public.evidence_snapshots FOR DELETE 
  USING (auth.uid() = owner_id);

-- Create trigger for updated_at on monitored_processes
CREATE TRIGGER update_monitored_processes_updated_at
  BEFORE UPDATE ON public.monitored_processes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index on monitored_processes for faster queries
CREATE INDEX IF NOT EXISTS idx_monitored_processes_owner ON public.monitored_processes(owner_id);
CREATE INDEX IF NOT EXISTS idx_monitored_processes_monitoring ON public.monitored_processes(monitoring_enabled) WHERE monitoring_enabled = true;