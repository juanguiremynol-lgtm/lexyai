-- Add ICARUS-specific fields to monitored_processes
ALTER TABLE public.monitored_processes
ADD COLUMN IF NOT EXISTS demandantes TEXT,
ADD COLUMN IF NOT EXISTS demandados TEXT,
ADD COLUMN IF NOT EXISTS juez_ponente TEXT,
ADD COLUMN IF NOT EXISTS last_action_date DATE,
ADD COLUMN IF NOT EXISTS last_action_date_raw TEXT,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'MANUAL',
ADD COLUMN IF NOT EXISTS source_run_id UUID,
ADD COLUMN IF NOT EXISTS source_payload JSONB;

-- Create icarus_import_runs table
CREATE TABLE public.icarus_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_name TEXT NOT NULL,
  file_hash TEXT,
  rows_total INTEGER DEFAULT 0,
  rows_valid INTEGER DEFAULT 0,
  rows_imported INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_code TEXT,
  error_message TEXT
);

-- Enable RLS on icarus_import_runs
ALTER TABLE public.icarus_import_runs ENABLE ROW LEVEL SECURITY;

-- RLS policies for icarus_import_runs
CREATE POLICY "Users can view own import runs"
ON public.icarus_import_runs
FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own import runs"
ON public.icarus_import_runs
FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own import runs"
ON public.icarus_import_runs
FOR UPDATE
USING (auth.uid() = owner_id);

-- Create icarus_import_rows table for diagnostics
CREATE TABLE public.icarus_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.icarus_import_runs(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  radicado_raw TEXT,
  radicado_norm TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT,
  source_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on icarus_import_rows
ALTER TABLE public.icarus_import_rows ENABLE ROW LEVEL SECURITY;

-- RLS policies for icarus_import_rows
CREATE POLICY "Users can view own import rows"
ON public.icarus_import_rows
FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own import rows"
ON public.icarus_import_rows
FOR INSERT
WITH CHECK (auth.uid() = owner_id);

-- Create index for efficient lookups
CREATE INDEX idx_icarus_import_rows_run_id ON public.icarus_import_rows(run_id);
CREATE INDEX idx_monitored_processes_radicado ON public.monitored_processes(owner_id, radicado);