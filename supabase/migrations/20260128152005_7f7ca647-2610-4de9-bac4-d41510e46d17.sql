-- Add additional SAMAI metadata fields to work_items
ALTER TABLE public.work_items
ADD COLUMN IF NOT EXISTS samai_guid TEXT,
ADD COLUMN IF NOT EXISTS samai_consultado_en TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS samai_veces_en_corporacion INTEGER,
ADD COLUMN IF NOT EXISTS samai_sala_conoce TEXT,
ADD COLUMN IF NOT EXISTS samai_sala_decide TEXT,
ADD COLUMN IF NOT EXISTS samai_fuente TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.work_items.samai_guid IS 'SAMAI unique identifier for the process';
COMMENT ON COLUMN public.work_items.samai_consultado_en IS 'Timestamp when SAMAI data was last fetched';
COMMENT ON COLUMN public.work_items.samai_veces_en_corporacion IS 'Number of times the case has been in this court';
COMMENT ON COLUMN public.work_items.samai_sala_conoce IS 'Court/room that knows the case';
COMMENT ON COLUMN public.work_items.samai_sala_decide IS 'Court/room that decides (e.g. VIGENTE)';
COMMENT ON COLUMN public.work_items.samai_fuente IS 'Data source identifier (e.g. SAMAI)';