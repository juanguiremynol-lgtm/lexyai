
-- ============================================================
-- LAYER 1A: Guard last_synced_at — only advance on actual data presence
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_last_synced_at()
RETURNS TRIGGER AS $$
DECLARE
  has_acts BOOLEAN;
  has_pubs BOOLEAN;
  has_data BOOLEAN;
BEGIN
  -- Only enforce when last_synced_at is being updated to a newer value
  IF NEW.last_synced_at IS NOT NULL 
     AND (OLD.last_synced_at IS NULL OR NEW.last_synced_at > OLD.last_synced_at) THEN
    
    -- Check if there's at least one act or pub for this work item
    SELECT EXISTS(SELECT 1 FROM work_item_acts WHERE work_item_id = NEW.id LIMIT 1) INTO has_acts;
    SELECT EXISTS(SELECT 1 FROM work_item_publicaciones WHERE work_item_id = NEW.id LIMIT 1) INTO has_pubs;
    
    has_data := has_acts OR has_pubs;
    
    -- If monitoring is enabled, item is not brand new (>24h old), and zero data exists: block
    IF NEW.monitoring_enabled = true 
       AND NOT has_data 
       AND NEW.created_at < (NOW() - INTERVAL '24 hours') THEN
      RAISE WARNING '[GUARD_LAST_SYNCED_AT] Blocked last_synced_at advance on work_item % — zero acts/pubs present. Reverting.', NEW.id;
      NEW.last_synced_at := OLD.last_synced_at;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guard_work_item_last_synced
  BEFORE UPDATE ON work_items
  FOR EACH ROW
  WHEN (NEW.last_synced_at IS DISTINCT FROM OLD.last_synced_at)
  EXECUTE FUNCTION public.guard_last_synced_at();

-- ============================================================
-- LAYER 1B: Append-only guard for sync context
-- Already have protect_work_item_acts_delete and protect_work_item_publicaciones_delete.
-- Add sync-context-specific guard that raises EXCEPTION (not just prevents).
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_sync_append_only()
RETURNS TRIGGER AS $$
BEGIN
  -- Block deletes when app.context = 'sync' (set via SET LOCAL in sync functions)
  IF current_setting('app.context', true) = 'sync' THEN
    RAISE EXCEPTION '[APPEND_ONLY_GUARD] DELETE from % blocked during sync operation. work_item_id: %', 
      TG_TABLE_NAME, OLD.work_item_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guard_sync_acts_append_only
  BEFORE DELETE ON work_item_acts
  FOR EACH ROW EXECUTE FUNCTION public.guard_sync_append_only();

CREATE TRIGGER guard_sync_pubs_append_only
  BEFORE DELETE ON work_item_publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.guard_sync_append_only();

-- NOTE: 1C (hash_fingerprint uniqueness) already exists:
--   idx_work_item_acts_unique UNIQUE (work_item_id, hash_fingerprint)
--   idx_work_item_publicaciones_dedupe UNIQUE (work_item_id, hash_fingerprint)
