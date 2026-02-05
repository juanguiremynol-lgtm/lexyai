
-- =============================================================
-- 2.1: Add updated_at to work_item_acts and work_item_publicaciones
-- =============================================================

-- work_item_acts
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- work_item_publicaciones
ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Trigger function for updated_at (shared)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_work_item_acts_updated_at
  BEFORE UPDATE ON public.work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_work_item_publicaciones_updated_at
  BEFORE UPDATE ON public.work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =============================================================
-- 2.3: Add raw_schema_version to both tables
-- =============================================================

ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS raw_schema_version TEXT;

ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS raw_schema_version TEXT;

-- =============================================================
-- 2.4: Add soft-delete audit trail columns
-- =============================================================

-- work_item_acts
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID;

-- work_item_publicaciones
ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID;

-- Trigger function to auto-populate archived_at/archived_by
CREATE OR REPLACE FUNCTION public.set_archive_audit()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when is_archived flips from false/null to true
  IF NEW.is_archived = true AND (OLD.is_archived IS DISTINCT FROM true) THEN
    NEW.archived_at = now();
    -- Try to capture the current auth user; NULL for service_role/system
    BEGIN
      NEW.archived_by = auth.uid();
    EXCEPTION WHEN OTHERS THEN
      NEW.archived_by = NULL;
    END;
  END IF;
  -- If un-archiving, clear the audit fields
  IF NEW.is_archived = false AND OLD.is_archived = true THEN
    NEW.archived_at = NULL;
    NEW.archived_by = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_work_item_acts_archive_audit
  BEFORE UPDATE ON public.work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_archive_audit();

CREATE TRIGGER trg_work_item_publicaciones_archive_audit
  BEFORE UPDATE ON public.work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_archive_audit();
