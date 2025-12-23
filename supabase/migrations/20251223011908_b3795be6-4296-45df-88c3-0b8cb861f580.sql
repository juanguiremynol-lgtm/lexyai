-- Table to store Estados data imported from Excel
CREATE TABLE public.process_estados (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  monitored_process_id UUID REFERENCES public.monitored_processes(id) ON DELETE CASCADE,
  radicado TEXT NOT NULL,
  distrito TEXT,
  despacho TEXT,
  juez_ponente TEXT,
  demandantes TEXT,
  demandados TEXT,
  fecha_ultima_actuacion DATE,
  fecha_ultima_actuacion_raw TEXT,
  import_run_id UUID,
  source_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table to track Estados import runs
CREATE TABLE public.estados_import_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_hash TEXT,
  rows_total INTEGER DEFAULT 0,
  rows_matched INTEGER DEFAULT 0,
  rows_unmatched INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add foreign key for import_run_id
ALTER TABLE public.process_estados 
ADD CONSTRAINT process_estados_import_run_id_fkey 
FOREIGN KEY (import_run_id) REFERENCES public.estados_import_runs(id) ON DELETE CASCADE;

-- Table to track when processes/filings were last reviewed
CREATE TABLE public.review_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- 'FILING' or 'PROCESS'
  entity_id UUID NOT NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Track last Estados import to generate biweekly reminders
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_estados_import_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS estados_import_interval_days INTEGER DEFAULT 14;

-- Track last review per process/filing
ALTER TABLE public.monitored_processes ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.filings ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP WITH TIME ZONE;

-- Enable RLS
ALTER TABLE public.process_estados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for process_estados
CREATE POLICY "Users can view own process_estados" 
ON public.process_estados FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own process_estados" 
ON public.process_estados FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can delete own process_estados" 
ON public.process_estados FOR DELETE 
USING (auth.uid() = owner_id);

-- RLS policies for estados_import_runs
CREATE POLICY "Users can view own estados_import_runs" 
ON public.estados_import_runs FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own estados_import_runs" 
ON public.estados_import_runs FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own estados_import_runs" 
ON public.estados_import_runs FOR UPDATE 
USING (auth.uid() = owner_id);

-- RLS policies for review_logs
CREATE POLICY "Users can view own review_logs" 
ON public.review_logs FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own review_logs" 
ON public.review_logs FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

-- Add new task types for weekly review and estados import
-- Note: This requires updating the enum - let's add REVIEW_PROCESS and IMPORT_ESTADOS
DO $$ 
BEGIN
  -- Add REVIEW_PROCESS if not exists
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'REVIEW_PROCESS' AND enumtypid = 'public.task_type'::regtype) THEN
    ALTER TYPE public.task_type ADD VALUE 'REVIEW_PROCESS';
  END IF;
  
  -- Add REVIEW_FILING if not exists
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'REVIEW_FILING' AND enumtypid = 'public.task_type'::regtype) THEN
    ALTER TYPE public.task_type ADD VALUE 'REVIEW_FILING';
  END IF;
  
  -- Add IMPORT_ESTADOS if not exists
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'IMPORT_ESTADOS' AND enumtypid = 'public.task_type'::regtype) THEN
    ALTER TYPE public.task_type ADD VALUE 'IMPORT_ESTADOS';
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX idx_process_estados_radicado ON public.process_estados(radicado);
CREATE INDEX idx_process_estados_monitored_process_id ON public.process_estados(monitored_process_id);
CREATE INDEX idx_review_logs_entity ON public.review_logs(entity_type, entity_id);