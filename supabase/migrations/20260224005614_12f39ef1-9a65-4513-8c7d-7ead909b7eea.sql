
-- Add missing first-class columns to work_item_acts for proper dedup and display
-- These fields were previously only stored in raw_data jsonb, making them unsortable/unqueryable

ALTER TABLE public.work_item_acts ADD COLUMN IF NOT EXISTS instancia text;
ALTER TABLE public.work_item_acts ADD COLUMN IF NOT EXISTS fecha_registro_source date;
ALTER TABLE public.work_item_acts ADD COLUMN IF NOT EXISTS inicia_termino date;

-- Add index for sorting: act_date DESC, fecha_registro_source DESC, hash_fingerprint (deterministic tie-breaker)
CREATE INDEX IF NOT EXISTS idx_work_item_acts_sort_order 
  ON public.work_item_acts(work_item_id, act_date DESC NULLS LAST, fecha_registro_source DESC NULLS LAST, hash_fingerprint);

COMMENT ON COLUMN public.work_item_acts.instancia IS 'Judicial instance number from CPNU (e.g., 00, 01, 02)';
COMMENT ON COLUMN public.work_item_acts.fecha_registro_source IS 'Registration date from source API (distinct from act_date)';
COMMENT ON COLUMN public.work_item_acts.inicia_termino IS 'Date when legal terms begin (nullable)';
