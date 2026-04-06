ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS pp_ultima_sync timestamptz;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS pp_estado text DEFAULT 'pending';
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS pp_novedades_pendientes integer DEFAULT 0;