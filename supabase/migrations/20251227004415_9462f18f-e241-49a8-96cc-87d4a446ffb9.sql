-- ============= RADICADO VERIFICATION & SCRAPING ENHANCEMENTS =============
-- Add status enums for tracking radicado verification and scraping

-- Radicado Status Enum
CREATE TYPE radicado_verification_status AS ENUM (
  'NOT_PROVIDED',
  'PROVIDED_NOT_VERIFIED',
  'VERIFIED_FOUND',
  'NOT_FOUND',
  'LOOKUP_UNAVAILABLE',
  'AMBIGUOUS_MATCH_NEEDS_USER_CONFIRMATION'
);

-- Scrape Status Enum
CREATE TYPE scrape_status AS ENUM (
  'NOT_ATTEMPTED',
  'IN_PROGRESS',
  'SUCCESS',
  'FAILED',
  'PARTIAL_SUCCESS'
);

-- Milestone Source Enum (for tracking where milestone came from)
CREATE TYPE milestone_source AS ENUM (
  'USER',
  'RAMA_SCRAPE',
  'SYSTEM',
  'ICARUS_IMPORT'
);

-- Notificacion Subtype Enum
CREATE TYPE notificacion_subtype AS ENUM (
  'NOTIFICACION_AUTO_ADMISORIO',
  'NOTIFICACION_MANDAMIENTO_PAGO',
  'NOTIFICACION_PERSONAL',
  'NOTIFICACION_POR_AVISO',
  'NOTIFICACION_ESTADO',
  'NOTIFICACION_ELECTRONICA',
  'NOTIFICACION_GENERAL'
);

-- ============= UPDATE FILINGS TABLE =============
ALTER TABLE public.filings
  ADD COLUMN IF NOT EXISTS radicado_status radicado_verification_status DEFAULT 'NOT_PROVIDED',
  ADD COLUMN IF NOT EXISTS scrape_status scrape_status DEFAULT 'NOT_ATTEMPTED',
  ADD COLUMN IF NOT EXISTS case_family text DEFAULT 'CGP',
  ADD COLUMN IF NOT EXISTS case_subtype text,
  ADD COLUMN IF NOT EXISTS source_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scraped_fields jsonb DEFAULT '{}'::jsonb;

-- ============= UPDATE MONITORED_PROCESSES TABLE =============
ALTER TABLE public.monitored_processes
  ADD COLUMN IF NOT EXISTS radicado_status radicado_verification_status DEFAULT 'NOT_PROVIDED',
  ADD COLUMN IF NOT EXISTS scrape_status scrape_status DEFAULT 'NOT_ATTEMPTED',
  ADD COLUMN IF NOT EXISTS case_family text DEFAULT 'CGP',
  ADD COLUMN IF NOT EXISTS case_subtype text,
  ADD COLUMN IF NOT EXISTS source_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scraped_fields jsonb DEFAULT '{}'::jsonb;

-- ============= ACTUACIONES TABLE (normalized scraped data) =============
CREATE TABLE IF NOT EXISTS public.actuaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filing_id uuid REFERENCES public.filings(id) ON DELETE CASCADE,
  monitored_process_id uuid REFERENCES public.monitored_processes(id) ON DELETE CASCADE,
  
  -- Source identification
  source text NOT NULL DEFAULT 'RAMA_JUDICIAL',
  source_url text,
  adapter_name text DEFAULT 'default',
  
  -- Actuacion content
  raw_text text NOT NULL,
  normalized_text text NOT NULL,
  act_date date,
  act_time time without time zone,
  act_date_raw text,
  
  -- ML/Classification fields
  act_type_guess text,
  confidence numeric(3,2) DEFAULT 0.5,
  
  -- Deduplication
  hash_fingerprint text NOT NULL,
  
  -- Metadata
  attachments jsonb DEFAULT '[]'::jsonb,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  
  -- Ensure either filing_id or monitored_process_id is set
  CONSTRAINT actuaciones_case_reference CHECK (
    (filing_id IS NOT NULL AND monitored_process_id IS NULL) OR
    (filing_id IS NULL AND monitored_process_id IS NOT NULL)
  )
);

-- Unique constraint for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS actuaciones_unique_hash 
  ON public.actuaciones(filing_id, monitored_process_id, hash_fingerprint);

-- Index for querying by case
CREATE INDEX IF NOT EXISTS actuaciones_filing_idx ON public.actuaciones(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS actuaciones_process_idx ON public.actuaciones(monitored_process_id) WHERE monitored_process_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.actuaciones ENABLE ROW LEVEL SECURITY;

-- RLS Policies for actuaciones
CREATE POLICY "Users can view own actuaciones" 
  ON public.actuaciones FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own actuaciones" 
  ON public.actuaciones FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Service role can insert actuaciones"
  ON public.actuaciones FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can delete own actuaciones" 
  ON public.actuaciones FOR DELETE USING (auth.uid() = owner_id);

-- ============= UPDATE CGP_MILESTONES TABLE =============
-- Add source tracking for auto-detected milestones

-- First, add the new columns
ALTER TABLE public.cgp_milestones
  ADD COLUMN IF NOT EXISTS source milestone_source DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS source_actuacion_id uuid REFERENCES public.actuaciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS needs_user_confirmation boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_confirmed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS user_rejected_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS notificacion_subtype notificacion_subtype;

-- Index for finding milestones by source actuacion
CREATE INDEX IF NOT EXISTS cgp_milestones_source_actuacion_idx 
  ON public.cgp_milestones(source_actuacion_id) WHERE source_actuacion_id IS NOT NULL;

-- ============= MILESTONE MAPPING PATTERNS TABLE =============
-- Configurable patterns for detecting milestones from actuaciones text

CREATE TABLE IF NOT EXISTS public.milestone_mapping_patterns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Pattern definition
  milestone_type text NOT NULL,
  notificacion_subtype notificacion_subtype,
  pattern_regex text NOT NULL,
  pattern_keywords text[] NOT NULL DEFAULT '{}',
  
  -- Confidence scoring
  base_confidence numeric(3,2) DEFAULT 0.8,
  priority integer DEFAULT 100,
  
  -- Metadata
  is_system boolean DEFAULT false,
  active boolean DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.milestone_mapping_patterns ENABLE ROW LEVEL SECURITY;

-- RLS Policies - users can see system patterns and their own
CREATE POLICY "Users can view system and own patterns" 
  ON public.milestone_mapping_patterns FOR SELECT 
  USING (is_system = true OR owner_id IS NULL OR auth.uid() = owner_id);

CREATE POLICY "Users can create own patterns" 
  ON public.milestone_mapping_patterns FOR INSERT 
  WITH CHECK (auth.uid() = owner_id AND is_system = false);

CREATE POLICY "Users can update own patterns" 
  ON public.milestone_mapping_patterns FOR UPDATE 
  USING (auth.uid() = owner_id AND is_system = false);

CREATE POLICY "Users can delete own patterns" 
  ON public.milestone_mapping_patterns FOR DELETE 
  USING (auth.uid() = owner_id AND is_system = false);

-- ============= INSERT SYSTEM PATTERNS FOR MVP =============
-- These patterns detect milestones from scraped actuaciones text

INSERT INTO public.milestone_mapping_patterns (is_system, milestone_type, pattern_keywords, pattern_regex, base_confidence, priority, notes)
VALUES
  -- (A) Auto admisorio / admisión de demanda
  (true, 'AUTO_ADMISORIO_NOTIFICADO', 
   ARRAY['auto admisorio', 'admite demanda', 'auto que admite', 'admisión de la demanda', 'admite la demanda'],
   '(?i)(auto\s+admisorio|admite\s+(la\s+)?demanda|admisión\s+de\s+la\s+demanda|auto\s+que\s+admite)',
   0.85, 100, 'Detects auto admisorio patterns'),
   
  -- (B) Mandamiento de pago (ejecutivo)
  (true, 'MANDAMIENTO_EJECUTIVO_NOTIFICADO',
   ARRAY['mandamiento de pago', 'libra mandamiento', 'líbrese mandamiento', 'auto que libra mandamiento'],
   '(?i)(mandamiento\s+de\s+pago|l[ií]br(a|ese|ó)\s+mandamiento)',
   0.90, 100, 'Detects mandamiento de pago for ejecutivo processes'),

  -- (C) Notificación patterns
  (true, 'NOTIFICACION_EVENT',
   ARRAY['notificación', 'notificado', 'se notifica', 'notificación personal', 'notificación por aviso', 'notificación electrónica'],
   '(?i)(notificaci[oó]n|notificad[oa]|se\s+notifica)',
   0.70, 50, 'Generic notification detection - subtype determined by context'),

  -- (D) Expediente al despacho
  (true, 'EXPEDIENTE_AL_DESPACHO',
   ARRAY['al despacho', 'pasa al despacho', 'ingresó al despacho', 'entra al despacho', 'despacho para decidir'],
   '(?i)(al\s+despacho|pasa\s+al\s+despacho|ingres[oó]\s+al\s+despacho|entra\s+al\s+despacho)',
   0.85, 100, 'Detects when file enters judge chamber'),

  -- (E) Auto seguir adelante ejecución
  (true, 'SENTENCIA_EJECUTORIA',
   ARRAY['seguir adelante', 'ordena seguir adelante', 'seguir adelante la ejecución'],
   '(?i)(seguir\s+adelante\s+(la\s+)?ejecuci[oó]n|ord[eé]n(a|ese)\s+seguir\s+adelante)',
   0.88, 100, 'Detects order to continue execution'),

  -- (F) Embargo y secuestro
  (true, 'EMBARGO_SECUESTRO_PRACTICADO',
   ARRAY['embargo', 'secuestro', 'embargo y secuestro', 'medida cautelar'],
   '(?i)(embargo|secuestro|medida\s+cautelar)',
   0.75, 80, 'Detects embargo/secuestro - may need confirmation for decretado vs practicado'),

  -- (G) Traslados
  (true, 'TRASLADO_DEMANDA_NOTIFICADO',
   ARRAY['córrese traslado', 'traslado de', 'se concede traslado', 'traslado de la demanda', 'traslado excepciones'],
   '(?i)(c[oó]rr(a|e)se\s+traslado|traslado\s+de|se\s+concede\s+traslado)',
   0.80, 90, 'Detects traslado events'),

  -- (H) Recursos
  (true, 'RECURSO_REPOSICION_INTERPUESTO',
   ARRAY['recurso de reposición', 'recurso de apelación', 'se interpone recurso'],
   '(?i)(recurso\s+de\s+reposici[oó]n|recurso\s+de\s+apelaci[oó]n|se\s+interpone\s+recurso)',
   0.82, 85, 'Detects filed appeals'),

  -- Recurso decidido
  (true, 'RECURSO_REPOSICION_RESUELTO',
   ARRAY['se concede', 'se niega', 'resuelve recurso', 'desierto'],
   '(?i)((se\s+)?(concede|niega|rechaza)|resuelve\s+recurso|desierto)',
   0.78, 85, 'Detects appeal decisions'),

  -- Contestación
  (true, 'CONTESTACION_PRESENTADA',
   ARRAY['contestación', 'contesta demanda', 'contestación de la demanda'],
   '(?i)(contestaci[oó]n|contesta\s+(la\s+)?demanda)',
   0.85, 100, 'Detects answer to complaint'),

  -- Sentencia
  (true, 'SENTENCIA_PRIMERA_INSTANCIA',
   ARRAY['sentencia', 'fallo', 'se profiere sentencia', 'sentencia de primera instancia'],
   '(?i)(sentencia|fallo|se\s+profiere\s+sentencia)',
   0.80, 70, 'Detects sentence - lower priority to avoid false positives'),

  -- Audiencia
  (true, 'AUDIENCIA_PROGRAMADA',
   ARRAY['audiencia', 'fija audiencia', 'se programa audiencia', 'cita a audiencia'],
   '(?i)(fija\s+audiencia|programa\s+audiencia|cita\s+a\s+audiencia|se\s+fija\s+fecha)',
   0.82, 90, 'Detects scheduled hearings'),

  -- Oposición monitorio
  (true, 'OPOSICION_MONITORIO',
   ARRAY['oposición', 'se opone', 'formula oposición'],
   '(?i)(oposici[oó]n|se\s+opone|formula\s+oposici[oó]n)',
   0.85, 100, 'Detects opposition in monitorio process')
  
ON CONFLICT DO NOTHING;

-- ============= SCRAPING JOBS TABLE =============
-- Track async scraping jobs

CREATE TABLE IF NOT EXISTS public.scraping_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filing_id uuid REFERENCES public.filings(id) ON DELETE CASCADE,
  monitored_process_id uuid REFERENCES public.monitored_processes(id) ON DELETE CASCADE,
  
  -- Job details
  radicado text NOT NULL,
  adapter_name text DEFAULT 'default',
  status text NOT NULL DEFAULT 'PENDING',
  
  -- Progress tracking
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error_message text,
  error_code text,
  
  -- Results
  actuaciones_found integer DEFAULT 0,
  milestones_suggested integer DEFAULT 0,
  
  -- Metadata
  request_payload jsonb DEFAULT '{}'::jsonb,
  response_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scraping_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scraping jobs" 
  ON public.scraping_jobs FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own scraping jobs" 
  ON public.scraping_jobs FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Service role can manage scraping jobs"
  ON public.scraping_jobs FOR ALL USING (true);

-- Index for finding jobs by case
CREATE INDEX IF NOT EXISTS scraping_jobs_filing_idx ON public.scraping_jobs(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scraping_jobs_process_idx ON public.scraping_jobs(monitored_process_id) WHERE monitored_process_id IS NOT NULL;

-- ============= ADD MORE MILESTONE TYPES TO ENUM =============
-- Add new milestone types for scraped events
ALTER TYPE cgp_milestone_type ADD VALUE IF NOT EXISTS 'AUTO_ADMISORIO' AFTER 'DEMANDA_RADICADA';
ALTER TYPE cgp_milestone_type ADD VALUE IF NOT EXISTS 'MANDAMIENTO_DE_PAGO' AFTER 'AUTO_ADMISORIO';
ALTER TYPE cgp_milestone_type ADD VALUE IF NOT EXISTS 'NOTIFICACION_EVENT' AFTER 'MANDAMIENTO_DE_PAGO';
ALTER TYPE cgp_milestone_type ADD VALUE IF NOT EXISTS 'AUTO_SEGUIR_ADELANTE_EJECUCION' AFTER 'NOTIFICACION_EVENT';
ALTER TYPE cgp_milestone_type ADD VALUE IF NOT EXISTS 'TRASLADO_EVENT' AFTER 'AUTO_SEGUIR_ADELANTE_EJECUCION';
ALTER TYPE cgp_milestone_type ADD VALUE IF NOT EXISTS 'RECURSO_INTERPUESTO' AFTER 'TRASLADO_EVENT';
ALTER TYPE cgp_milestone_type ADD VALUE IF NOT EXISTS 'RECURSO_DECIDIDO' AFTER 'RECURSO_INTERPUESTO';