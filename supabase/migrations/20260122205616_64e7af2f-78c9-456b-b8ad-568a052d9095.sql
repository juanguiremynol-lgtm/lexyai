-- Create workflow_type enum for unified work items
CREATE TYPE public.workflow_type AS ENUM (
  'CGP',          -- Código General del Proceso (civil lawsuits)
  'PETICION',     -- Derechos de Petición
  'TUTELA',       -- Acción de Tutela
  'GOV_PROCEDURE', -- Vía Gubernativa (administrative procedure before authorities)
  'CPACA'         -- Contencioso Administrativo (judicial litigation)
);

-- Create item_source enum to track where items came from
CREATE TYPE public.item_source AS ENUM (
  'ICARUS_IMPORT',
  'SCRAPE_API', 
  'MANUAL',
  'EMAIL_IMPORT',
  'MIGRATION'
);

-- Create item_status enum for general status
CREATE TYPE public.item_status AS ENUM (
  'ACTIVE',
  'INACTIVE', 
  'CLOSED',
  'ARCHIVED'
);

-- Create the unified work_items table
CREATE TABLE public.work_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Client and matter relationships
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
  
  -- Workflow classification
  workflow_type public.workflow_type NOT NULL,
  stage TEXT NOT NULL, -- Current stage within the workflow (Kanban column)
  status public.item_status NOT NULL DEFAULT 'ACTIVE',
  
  -- CGP-specific: phase within CGP workflow
  cgp_phase public.cgp_phase DEFAULT 'FILING', -- Only applicable when workflow_type = 'CGP'
  cgp_phase_source public.cgp_phase_source DEFAULT 'AUTO',
  
  -- Source tracking
  source public.item_source NOT NULL DEFAULT 'MANUAL',
  source_reference TEXT, -- Import batch ID, run ID, etc.
  source_payload JSONB, -- Raw payload from source
  
  -- Core identification
  radicado TEXT, -- 23-digit Colombian radicado (for judicial items)
  radicado_verified BOOLEAN DEFAULT FALSE,
  
  -- Authority/court information
  authority_name TEXT, -- Court name or administrative authority
  authority_email TEXT,
  authority_city TEXT,
  authority_department TEXT,
  
  -- Parties
  demandantes TEXT,
  demandados TEXT,
  
  -- Descriptive info
  title TEXT, -- Display title
  description TEXT,
  notes TEXT,
  
  -- Key dates
  auto_admisorio_date TIMESTAMPTZ, -- When auto admisorio was granted (CGP)
  filing_date TIMESTAMPTZ, -- When filed/submitted
  last_action_date TIMESTAMPTZ, -- Most recent action
  last_action_description TEXT,
  
  -- Flags and UI state
  is_flagged BOOLEAN DEFAULT FALSE,
  monitoring_enabled BOOLEAN DEFAULT TRUE,
  email_linking_enabled BOOLEAN DEFAULT TRUE,
  
  -- External references
  expediente_url TEXT,
  sharepoint_url TEXT,
  
  -- Scraping/monitoring state
  scrape_status public.scrape_status DEFAULT 'NOT_ATTEMPTED',
  last_checked_at TIMESTAMPTZ,
  last_crawled_at TIMESTAMPTZ,
  scraped_fields JSONB,
  
  -- Statistics
  total_actuaciones INTEGER DEFAULT 0,
  
  -- Legacy IDs for migration tracking
  legacy_filing_id UUID,
  legacy_process_id UUID,
  legacy_cgp_item_id UUID,
  legacy_peticion_id UUID,
  legacy_cpaca_id UUID,
  legacy_admin_process_id UUID,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add indexes for common queries
CREATE INDEX idx_work_items_owner_id ON public.work_items(owner_id);
CREATE INDEX idx_work_items_workflow_type ON public.work_items(workflow_type);
CREATE INDEX idx_work_items_stage ON public.work_items(stage);
CREATE INDEX idx_work_items_client_id ON public.work_items(client_id);
CREATE INDEX idx_work_items_radicado ON public.work_items(radicado);
CREATE INDEX idx_work_items_status ON public.work_items(status);
CREATE INDEX idx_work_items_workflow_stage ON public.work_items(workflow_type, stage);

-- Unique constraint to prevent duplicates (same owner + radicado + workflow)
CREATE UNIQUE INDEX idx_work_items_unique_radicado 
  ON public.work_items(owner_id, radicado, workflow_type) 
  WHERE radicado IS NOT NULL;

-- Enable RLS
ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own work items"
  ON public.work_items FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own work items"
  ON public.work_items FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own work items"
  ON public.work_items FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own work items"
  ON public.work_items FOR DELETE
  USING (auth.uid() = owner_id);

-- Trigger for updated_at
CREATE TRIGGER update_work_items_updated_at
  BEFORE UPDATE ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create table for acts/actuaciones linked to work items
CREATE TABLE public.work_item_acts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  
  -- Act details
  act_date DATE,
  act_date_raw TEXT,
  description TEXT NOT NULL,
  act_type TEXT,
  
  -- Source tracking
  source TEXT DEFAULT 'MANUAL',
  source_reference TEXT,
  raw_data JSONB,
  
  -- Deduplication
  hash_fingerprint TEXT NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint to prevent duplicate acts
CREATE UNIQUE INDEX idx_work_item_acts_unique 
  ON public.work_item_acts(work_item_id, hash_fingerprint);

CREATE INDEX idx_work_item_acts_work_item ON public.work_item_acts(work_item_id);
CREATE INDEX idx_work_item_acts_owner ON public.work_item_acts(owner_id);
CREATE INDEX idx_work_item_acts_date ON public.work_item_acts(act_date DESC);

-- Enable RLS
ALTER TABLE public.work_item_acts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own work item acts"
  ON public.work_item_acts FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own work item acts"
  ON public.work_item_acts FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own work item acts"
  ON public.work_item_acts FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own work item acts"
  ON public.work_item_acts FOR DELETE
  USING (auth.uid() = owner_id);