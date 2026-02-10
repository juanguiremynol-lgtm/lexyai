-- Add resolution_candidates column to work_items for storing top N candidates when ambiguous
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS resolution_candidates jsonb;

-- Add comment for clarity
COMMENT ON COLUMN public.work_items.resolution_candidates IS 'Top N courthouse directory candidates when resolution is ambiguous. Array of {id, nombre_despacho, email, ciudad, tipo_cuenta, similarity_score}.';