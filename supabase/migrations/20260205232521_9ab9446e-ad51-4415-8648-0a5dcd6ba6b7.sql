
-- Add tutela-specific columns to work_items
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS corte_status TEXT,          -- SELECCIONADA / NO_SELECCIONADA / PENDIENTE / null
  ADD COLUMN IF NOT EXISTS sentencia_ref TEXT,         -- T-123/2026, SU-045/2026
  ADD COLUMN IF NOT EXISTS provider_sources JSONB;     -- Track which providers have data for this item

-- tutela_code and ponente already exist on work_items, no need to add them
