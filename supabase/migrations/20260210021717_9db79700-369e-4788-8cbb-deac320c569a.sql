
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

-- =============================================
-- courthouse_directory: Source of truth for courthouse emails
-- =============================================
CREATE TABLE public.courthouse_directory (
  id bigserial PRIMARY KEY,
  
  -- Raw fields from JSON
  email citext NOT NULL,
  nombre_raw text NOT NULL,
  departamento_raw text,
  ciudad_raw text,
  corporacion_area_raw text,
  especialidad_area_raw text,
  tipo_cuenta_raw text,
  codigo_despacho_raw text,
  
  -- Normalized fields
  dept_norm text NOT NULL DEFAULT '',
  city_norm text NOT NULL DEFAULT '',
  corp_area_norm text NOT NULL DEFAULT '',
  specialty_norm text NOT NULL DEFAULT '',
  account_type_norm text NOT NULL DEFAULT '',
  codigo_despacho_norm text,
  
  -- Classification
  court_class text NOT NULL DEFAULT 'otro',
  level_norm text,
  chamber_norm text,
  court_number smallint,
  court_number_padded text,
  
  -- Name normalization
  name_norm_hard text NOT NULL DEFAULT '',
  name_norm_soft text NOT NULL DEFAULT '',
  canonical_key text NOT NULL DEFAULT '',
  
  -- Import audit
  source_name text NOT NULL DEFAULT 'directorio_juzgados_completo',
  source_row_hash text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  
  -- Uniqueness: prevent duplicates on reimport
  UNIQUE (source_name, source_row_hash)
);

-- Indexes for matching
CREATE INDEX idx_courthouse_dir_codigo ON public.courthouse_directory (codigo_despacho_norm);
CREATE INDEX idx_courthouse_dir_dept_city ON public.courthouse_directory (dept_norm, city_norm);
CREATE INDEX idx_courthouse_dir_class_dept_city ON public.courthouse_directory (court_class, dept_norm, city_norm);
CREATE INDEX idx_courthouse_dir_name_trgm ON public.courthouse_directory USING gin (name_norm_soft gin_trgm_ops);

-- Enable RLS
ALTER TABLE public.courthouse_directory ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users
CREATE POLICY "Authenticated users can read courthouse directory"
  ON public.courthouse_directory
  FOR SELECT
  TO authenticated
  USING (true);

-- =============================================
-- Add resolution columns to work_items
-- =============================================
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS raw_courthouse_input jsonb,
  ADD COLUMN IF NOT EXISTS courthouse_directory_id bigint REFERENCES public.courthouse_directory(id),
  ADD COLUMN IF NOT EXISTS resolved_email citext,
  ADD COLUMN IF NOT EXISTS resolution_method text,
  ADD COLUMN IF NOT EXISTS resolution_confidence numeric,
  ADD COLUMN IF NOT EXISTS courthouse_needs_review boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX idx_work_items_courthouse_dir ON public.work_items (courthouse_directory_id) WHERE courthouse_directory_id IS NOT NULL;
