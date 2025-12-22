-- Create integrations table for storing external service connections (ICARUS, etc.)
CREATE TABLE public.integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('ICARUS')),
  status text NOT NULL DEFAULT 'DISCONNECTED' CHECK (status IN ('CONNECTED', 'ERROR', 'DISCONNECTED')),
  secret_encrypted text,
  secret_last4 text,
  metadata jsonb DEFAULT '{}'::jsonb,
  expires_at timestamp with time zone,
  last_sync_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(owner_id, provider)
);

-- Enable RLS
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- RLS policies for integrations
CREATE POLICY "Users can view own integrations"
  ON public.integrations FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own integrations"
  ON public.integrations FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own integrations"
  ON public.integrations FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own integrations"
  ON public.integrations FOR DELETE
  USING (auth.uid() = owner_id);

-- Create trigger for updated_at
CREATE TRIGGER update_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create icarus_sync_runs table for diagnostics
CREATE TABLE public.icarus_sync_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCESS', 'ERROR', 'PARTIAL')),
  classification text,
  mode text DEFAULT 'manual' CHECK (mode IN ('manual', 'scheduled')),
  processes_found integer DEFAULT 0,
  events_created integer DEFAULT 0,
  steps jsonb DEFAULT '[]'::jsonb,
  attempts jsonb DEFAULT '[]'::jsonb,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.icarus_sync_runs ENABLE ROW LEVEL SECURITY;

-- RLS policies for icarus_sync_runs
CREATE POLICY "Users can view own icarus_sync_runs"
  ON public.icarus_sync_runs FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Service role can insert icarus_sync_runs"
  ON public.icarus_sync_runs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update icarus_sync_runs"
  ON public.icarus_sync_runs FOR UPDATE
  USING (true);