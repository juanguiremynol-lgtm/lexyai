
-- Add is_notifiable column to both tables
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS is_notifiable BOOLEAN DEFAULT false;

ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS is_notifiable BOOLEAN DEFAULT false;

-- Trigger function for work_item_acts
CREATE OR REPLACE FUNCTION public.set_actuacion_notifiable()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_notifiable := (
    NEW.act_date IS NOT NULL
    AND NEW.work_item_id IS NOT NULL
    AND NEW.act_date > (
      SELECT created_at::date FROM public.work_items WHERE id = NEW.work_item_id
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_set_actuacion_notifiable
  BEFORE INSERT ON public.work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_actuacion_notifiable();

-- Trigger function for work_item_publicaciones
CREATE OR REPLACE FUNCTION public.set_publicacion_notifiable()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_notifiable := (
    NEW.fecha_fijacion IS NOT NULL
    AND NEW.work_item_id IS NOT NULL
    AND NEW.fecha_fijacion > (
      SELECT created_at::date FROM public.work_items WHERE id = NEW.work_item_id
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_set_publicacion_notifiable
  BEFORE INSERT ON public.work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_publicacion_notifiable();

-- Backfill existing records
UPDATE public.work_item_acts a
SET is_notifiable = (
  a.act_date IS NOT NULL
  AND a.work_item_id IS NOT NULL
  AND a.act_date > (SELECT w.created_at::date FROM public.work_items w WHERE w.id = a.work_item_id)
);

UPDATE public.work_item_publicaciones p
SET is_notifiable = (
  p.fecha_fijacion IS NOT NULL
  AND p.work_item_id IS NOT NULL
  AND p.fecha_fijacion > (SELECT w.created_at::date FROM public.work_items w WHERE w.id = p.work_item_id)
);

-- Partial indexes for notification queries
CREATE INDEX IF NOT EXISTS idx_work_item_acts_notifiable
  ON public.work_item_acts (organization_id, act_date DESC)
  WHERE is_notifiable = true AND is_archived = false;

CREATE INDEX IF NOT EXISTS idx_work_item_publicaciones_notifiable
  ON public.work_item_publicaciones (organization_id, fecha_fijacion DESC)
  WHERE is_notifiable = true AND is_archived = false;
