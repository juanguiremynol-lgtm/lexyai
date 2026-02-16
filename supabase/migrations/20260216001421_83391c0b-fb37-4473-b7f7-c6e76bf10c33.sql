
-- Enable pg_trgm extension for trigram-based search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes on key searchable fields in work_items
CREATE INDEX IF NOT EXISTS idx_work_items_radicado_trgm
  ON public.work_items USING gin (radicado gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_work_items_title_trgm
  ON public.work_items USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_work_items_demandantes_trgm
  ON public.work_items USING gin (demandantes gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_work_items_demandados_trgm
  ON public.work_items USING gin (demandados gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_work_items_authority_name_trgm
  ON public.work_items USING gin (authority_name gin_trgm_ops);

-- Composite index for permission scoping queries
CREATE INDEX IF NOT EXISTS idx_work_items_org_owner
  ON public.work_items (organization_id, owner_id)
  WHERE deleted_at IS NULL;
