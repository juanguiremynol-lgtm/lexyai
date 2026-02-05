
-- 6.1: Composite index for sync priority queries
CREATE INDEX IF NOT EXISTS idx_work_items_sync_priority
ON work_items (organization_id, last_synced_at ASC NULLS FIRST)
WHERE monitoring_enabled = true
  AND stage NOT IN ('ARCHIVADO', 'FINALIZADO', 'EJECUTORIADO', 'PRECLUIDO_ARCHIVADO', 'FINALIZADO_ABSUELTO', 'FINALIZADO_CONDENADO');

-- 6.2: Index on sync_traces.created_at for retention cleanup
CREATE INDEX IF NOT EXISTS idx_sync_traces_created_at
ON sync_traces (created_at);

-- 6.4: Atomic trigger to update work_items.total_actuaciones on INSERT/UPDATE to work_item_acts
CREATE OR REPLACE FUNCTION public.update_actuaciones_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE work_items
  SET total_actuaciones = (
    SELECT COUNT(*)
    FROM work_item_acts
    WHERE work_item_id = NEW.work_item_id
      AND is_archived = false
  )
  WHERE id = NEW.work_item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Fire on INSERT and on UPDATE of is_archived (for soft-delete count correction)
DROP TRIGGER IF EXISTS trg_update_actuaciones_count ON work_item_acts;
CREATE TRIGGER trg_update_actuaciones_count
  AFTER INSERT OR UPDATE OF is_archived ON work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_actuaciones_count();
