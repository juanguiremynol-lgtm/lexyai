-- Add normalized_error_code and body_preview to sync_traces
ALTER TABLE public.sync_traces ADD COLUMN IF NOT EXISTS normalized_error_code text;
ALTER TABLE public.sync_traces ADD COLUMN IF NOT EXISTS body_preview text;

-- Index for ghost items / autonomy queries
CREATE INDEX IF NOT EXISTS idx_sync_traces_normalized_error ON public.sync_traces (normalized_error_code) WHERE normalized_error_code IS NOT NULL;