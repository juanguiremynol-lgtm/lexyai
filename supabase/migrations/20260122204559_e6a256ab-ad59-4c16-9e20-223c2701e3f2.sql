-- ======================================================
-- CGP UNIFIED MODEL: Create cgp_items table
-- This represents a single CGP lifecycle entity with two phases:
-- FILING (Radicación) = Before auto admisorio
-- PROCESS (Proceso) = After auto admisorio
-- ======================================================

-- Create CGP phase enum
CREATE TYPE cgp_phase AS ENUM ('FILING', 'PROCESS');

-- Create CGP status enum  
CREATE TYPE cgp_status AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED', 'REJECTED');

-- Create phase source enum for tracking manual overrides
CREATE TYPE cgp_phase_source AS ENUM ('AUTO', 'MANUAL');

-- Create the unified cgp_items table
CREATE TABLE public.cgp_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  
  -- Identity fields
  radicado TEXT,
  court_name TEXT,
  court_department TEXT,
  court_city TEXT,
  court_email TEXT,
  demandantes TEXT,
  demandados TEXT,
  juez_ponente TEXT,
  
  -- Phase management
  phase cgp_phase NOT NULL DEFAULT 'FILING',
  phase_source cgp_phase_source NOT NULL DEFAULT 'AUTO',
  status cgp_status NOT NULL DEFAULT 'ACTIVE',
  
  -- Case classification  
  filing_type TEXT DEFAULT 'Demanda',
  case_family TEXT DEFAULT 'CGP',
  case_subtype TEXT,
  practice_area TEXT,
  
  -- CGP process phase (for cases with auto_admisorio)
  process_phase TEXT DEFAULT 'PENDIENTE_REGISTRO_MEDIDA_CAUTELAR',
  
  -- Filing workflow fields (phase = FILING)
  filing_status TEXT DEFAULT 'SENT_TO_REPARTO',
  sla_acta_due_at TIMESTAMPTZ,
  sla_court_reply_due_at TIMESTAMPTZ,
  sla_receipt_due_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  reparto_email_to TEXT,
  reparto_reference TEXT,
  acta_received_at TIMESTAMPTZ,
  filing_method TEXT DEFAULT 'EMAIL',
  target_authority TEXT,
  
  -- Auto admisorio tracking
  auto_admisorio_date DATE,
  has_auto_admisorio BOOLEAN NOT NULL DEFAULT false,
  
  -- Monitoring fields (phase = PROCESS)
  monitoring_enabled BOOLEAN DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  last_change_at TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  last_action_date DATE,
  last_action_date_raw TEXT,
  sources_enabled JSONB DEFAULT '["CPNU"]'::jsonb,
  monitoring_schedule TEXT DEFAULT '0 7 * * *',
  cpnu_confirmed BOOLEAN DEFAULT false,
  cpnu_confirmed_at TIMESTAMPTZ,
  
  -- Scraping/API fields
  radicado_status TEXT DEFAULT 'NOT_PROVIDED',
  scrape_status TEXT DEFAULT 'NOT_ATTEMPTED',
  last_crawled_at TIMESTAMPTZ,
  source_links JSONB DEFAULT '[]'::jsonb,
  scraped_fields JSONB DEFAULT '{}'::jsonb,
  
  -- Document/reference links
  expediente_url TEXT,
  matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
  
  -- Notes and flags
  notes TEXT,
  description TEXT,
  is_flagged BOOLEAN DEFAULT false,
  email_linking_enabled BOOLEAN DEFAULT true,
  
  -- Stats
  total_actuaciones INTEGER DEFAULT 0,
  total_sujetos_procesales INTEGER DEFAULT 0,
  
  -- Legacy linking (for migration)
  legacy_filing_id UUID,
  legacy_process_id UUID,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX idx_cgp_items_owner_id ON public.cgp_items(owner_id);
CREATE INDEX idx_cgp_items_phase ON public.cgp_items(phase);
CREATE INDEX idx_cgp_items_status ON public.cgp_items(status);
CREATE INDEX idx_cgp_items_radicado ON public.cgp_items(radicado);
CREATE INDEX idx_cgp_items_client_id ON public.cgp_items(client_id);
CREATE INDEX idx_cgp_items_filing_status ON public.cgp_items(filing_status) WHERE phase = 'FILING';
CREATE INDEX idx_cgp_items_process_phase ON public.cgp_items(process_phase) WHERE phase = 'PROCESS';

-- Enable RLS
ALTER TABLE public.cgp_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own cgp_items" 
  ON public.cgp_items 
  FOR SELECT 
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own cgp_items" 
  ON public.cgp_items 
  FOR INSERT 
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own cgp_items" 
  ON public.cgp_items 
  FOR UPDATE 
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own cgp_items" 
  ON public.cgp_items 
  FOR DELETE 
  USING (auth.uid() = owner_id);

-- Trigger to update updated_at
CREATE TRIGGER update_cgp_items_updated_at
  BEFORE UPDATE ON public.cgp_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to auto-set phase based on has_auto_admisorio (unless manually overridden)
CREATE OR REPLACE FUNCTION public.auto_set_cgp_phase()
RETURNS TRIGGER AS $$
BEGIN
  -- Only auto-set if phase_source is AUTO
  IF NEW.phase_source = 'AUTO' THEN
    IF NEW.has_auto_admisorio = true OR NEW.auto_admisorio_date IS NOT NULL THEN
      NEW.phase := 'PROCESS';
    ELSE
      NEW.phase := 'FILING';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER auto_set_cgp_phase_trigger
  BEFORE INSERT OR UPDATE ON public.cgp_items
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_cgp_phase();

-- ======================================================
-- MIGRATE DATA: Copy existing filings and processes into cgp_items
-- ======================================================

-- Migrate filings (those not already linked to a process)
INSERT INTO public.cgp_items (
  owner_id, client_id, radicado, court_name, court_department, court_city, court_email,
  demandantes, demandados, phase, phase_source, status,
  filing_type, case_family, case_subtype, practice_area,
  filing_status, sla_acta_due_at, sla_court_reply_due_at, sla_receipt_due_at,
  sent_at, reparto_email_to, reparto_reference, acta_received_at, filing_method, target_authority,
  has_auto_admisorio, monitoring_enabled,
  radicado_status, scrape_status, last_crawled_at, source_links, scraped_fields,
  expediente_url, matter_id, notes, description, is_flagged, email_linking_enabled,
  legacy_filing_id, created_at, updated_at
)
SELECT 
  f.owner_id,
  f.client_id,
  f.radicado,
  f.court_name,
  f.court_department,
  f.court_city,
  f.court_email,
  f.demandantes,
  f.demandados,
  CASE WHEN f.has_auto_admisorio = true THEN 'PROCESS'::cgp_phase ELSE 'FILING'::cgp_phase END,
  'AUTO'::cgp_phase_source,
  CASE WHEN f.status = 'CLOSED' THEN 'CLOSED'::cgp_status ELSE 'ACTIVE'::cgp_status END,
  f.filing_type,
  COALESCE(f.case_family, 'CGP'),
  f.case_subtype,
  NULL, -- practice_area from matter
  f.status,
  f.sla_acta_due_at,
  f.sla_court_reply_due_at,
  f.sla_receipt_due_at,
  f.sent_at,
  f.reparto_email_to,
  f.reparto_reference,
  f.acta_received_at,
  f.filing_method,
  f.target_authority,
  COALESCE(f.has_auto_admisorio, false),
  false,
  f.radicado_status::text,
  f.scrape_status::text,
  f.last_crawled_at,
  COALESCE(f.source_links, '[]'::jsonb),
  COALESCE(f.scraped_fields, '{}'::jsonb),
  f.expediente_url,
  f.matter_id,
  NULL,
  f.description,
  COALESCE(f.is_flagged, false),
  COALESCE(f.email_linking_enabled, true),
  f.id,
  f.created_at,
  f.updated_at
FROM public.filings f
WHERE f.linked_process_id IS NULL
  AND f.case_family = 'CGP';

-- Migrate monitored_processes (judicial CGP only)
INSERT INTO public.cgp_items (
  owner_id, client_id, radicado, court_name, court_department, court_city, court_email,
  demandantes, demandados, juez_ponente, phase, phase_source, status,
  filing_type, case_family, case_subtype,
  process_phase, has_auto_admisorio, monitoring_enabled,
  last_checked_at, last_change_at, last_reviewed_at, last_action_date, last_action_date_raw,
  sources_enabled, monitoring_schedule, cpnu_confirmed, cpnu_confirmed_at,
  radicado_status, scrape_status, source_links, scraped_fields,
  expediente_url, notes, is_flagged, email_linking_enabled,
  total_actuaciones, total_sujetos_procesales,
  legacy_process_id, created_at, updated_at
)
SELECT 
  p.owner_id,
  p.client_id,
  p.radicado,
  p.despacho_name,
  p.department,
  p.municipality,
  p.correo_autoridad,
  p.demandantes,
  p.demandados,
  p.juez_ponente,
  'PROCESS'::cgp_phase,
  'AUTO'::cgp_phase_source,
  CASE WHEN p.monitoring_enabled = false THEN 'INACTIVE'::cgp_status ELSE 'ACTIVE'::cgp_status END,
  'Demanda',
  COALESCE(p.case_family, 'CGP'),
  p.case_subtype,
  p.phase,
  COALESCE(p.has_auto_admisorio, true),
  p.monitoring_enabled,
  p.last_checked_at,
  p.last_change_at,
  p.last_reviewed_at,
  p.last_action_date,
  p.last_action_date_raw,
  COALESCE(p.sources_enabled, '["CPNU"]'::jsonb),
  p.monitoring_schedule,
  COALESCE(p.cpnu_confirmed, false),
  p.cpnu_confirmed_at,
  p.radicado_status::text,
  p.scrape_status::text,
  COALESCE(p.source_links, '[]'::jsonb),
  COALESCE(p.scraped_fields, '{}'::jsonb),
  p.expediente_digital_url,
  p.notes,
  COALESCE(p.is_flagged, false),
  COALESCE(p.email_linking_enabled, true),
  COALESCE(p.total_actuaciones, 0),
  COALESCE(p.total_sujetos_procesales, 0),
  p.id,
  p.created_at,
  p.updated_at
FROM public.monitored_processes p
WHERE p.process_type = 'JUDICIAL'
  AND COALESCE(p.case_family, 'CGP') = 'CGP';

-- For filings that ARE linked to a process, merge them into the process's cgp_item
-- Update the cgp_item with filing info
UPDATE public.cgp_items cgp
SET 
  legacy_filing_id = f.id,
  filing_status = f.status,
  sla_acta_due_at = f.sla_acta_due_at,
  sla_court_reply_due_at = f.sla_court_reply_due_at,
  sla_receipt_due_at = f.sla_receipt_due_at,
  sent_at = f.sent_at,
  reparto_email_to = f.reparto_email_to,
  reparto_reference = f.reparto_reference,
  acta_received_at = f.acta_received_at,
  filing_method = f.filing_method,
  target_authority = f.target_authority,
  matter_id = f.matter_id,
  description = COALESCE(cgp.description, f.description),
  expediente_url = COALESCE(cgp.expediente_url, f.expediente_url)
FROM public.filings f
WHERE f.linked_process_id = cgp.legacy_process_id
  AND cgp.legacy_process_id IS NOT NULL;