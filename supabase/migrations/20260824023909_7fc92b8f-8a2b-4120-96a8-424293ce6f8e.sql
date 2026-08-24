
ALTER TABLE public.work_items
  ADD COLUMN authority_id uuid REFERENCES public.authorities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_authority_id ON public.work_items(authority_id) WHERE authority_id IS NOT NULL;
