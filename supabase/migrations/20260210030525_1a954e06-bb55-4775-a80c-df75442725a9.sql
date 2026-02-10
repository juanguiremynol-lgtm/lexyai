
-- Add radicado-derived code columns to courthouse_directory for deterministic matching
ALTER TABLE public.courthouse_directory
  ADD COLUMN IF NOT EXISTS dane_code text,
  ADD COLUMN IF NOT EXISTS corp_code text,
  ADD COLUMN IF NOT EXISTS esp_code text,
  ADD COLUMN IF NOT EXISTS desp_code text;

-- Indexes for radicado-based matching
CREATE INDEX IF NOT EXISTS idx_courthouse_dir_dane ON public.courthouse_directory (dane_code) WHERE dane_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_courthouse_dir_dane_corp_esp_desp ON public.courthouse_directory (dane_code, corp_code, esp_code, desp_code) WHERE dane_code IS NOT NULL;

-- Add radicado verification columns to work_items
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS resolution_candidates jsonb,
  ADD COLUMN IF NOT EXISTS radicado_blocks jsonb,
  ADD COLUMN IF NOT EXISTS radicado_valid boolean;

-- Backfill dane_code from codigo_despacho_norm where possible (first 5 digits)
UPDATE public.courthouse_directory
SET dane_code = LEFT(codigo_despacho_norm, 5)
WHERE codigo_despacho_norm IS NOT NULL
  AND LENGTH(codigo_despacho_norm) >= 5
  AND dane_code IS NULL;

-- Backfill corp_code (digits 6-7)
UPDATE public.courthouse_directory
SET corp_code = SUBSTRING(codigo_despacho_norm FROM 6 FOR 2)
WHERE codigo_despacho_norm IS NOT NULL
  AND LENGTH(codigo_despacho_norm) >= 7
  AND corp_code IS NULL;

-- Backfill esp_code (digits 8-9)
UPDATE public.courthouse_directory
SET esp_code = SUBSTRING(codigo_despacho_norm FROM 8 FOR 2)
WHERE codigo_despacho_norm IS NOT NULL
  AND LENGTH(codigo_despacho_norm) >= 9
  AND esp_code IS NULL;

-- Backfill desp_code (digits 10-12)
UPDATE public.courthouse_directory
SET desp_code = SUBSTRING(codigo_despacho_norm FROM 10 FOR 3)
WHERE codigo_despacho_norm IS NOT NULL
  AND LENGTH(codigo_despacho_norm) >= 12
  AND desp_code IS NULL;
