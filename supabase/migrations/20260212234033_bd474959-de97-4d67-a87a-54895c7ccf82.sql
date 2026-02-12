
-- ============================================
-- Soft Delete System for Work Items
-- ============================================

-- 1. Add purge_after column to work_items (deleted_at, deleted_by, delete_reason already exist)
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS purge_after timestamptz NULL;

-- 2. Index for finding items due for purge
CREATE INDEX IF NOT EXISTS idx_work_items_purge_due
  ON work_items (purge_after)
  WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

-- 3. Index for soft-deleted items by org
CREATE INDEX IF NOT EXISTS idx_work_items_soft_deleted
  ON work_items (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 4. Create soft delete log table for Atenia AI recovery
CREATE TABLE IF NOT EXISTS work_item_soft_deletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  deleted_by_user_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL,
  delete_reason text NULL,
  radicado text NOT NULL,
  workflow_type text NOT NULL,
  despacho text NULL,
  item_snapshot jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DELETED',
  restored_at timestamptz NULL,
  restored_by_action_id uuid NULL,
  purged_at timestamptz NULL,
  purged_by_action_id uuid NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT chk_soft_delete_status CHECK (status IN ('DELETED', 'RESTORED', 'PURGED'))
);

ALTER TABLE work_item_soft_deletes ENABLE ROW LEVEL SECURITY;

-- RLS: org members can view their org's soft deletes
CREATE POLICY "Org members can view soft deletes"
  ON work_item_soft_deletes FOR SELECT
  USING (public.is_org_member(organization_id));

-- RLS: service role can insert/update (via edge functions)
CREATE POLICY "Service role manages soft deletes"
  ON work_item_soft_deletes FOR ALL
  USING (auth.role() = 'service_role');

-- RLS: authenticated users can insert soft deletes for their org
CREATE POLICY "Authenticated users can insert soft deletes"
  ON work_item_soft_deletes FOR INSERT
  WITH CHECK (
    public.is_org_member(organization_id)
  );

-- Indexes on soft_deletes
CREATE INDEX IF NOT EXISTS idx_soft_deletes_org_status
  ON work_item_soft_deletes (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_soft_deletes_purge_due
  ON work_item_soft_deletes (purge_after)
  WHERE status = 'DELETED';
CREATE INDEX IF NOT EXISTS idx_soft_deletes_radicado
  ON work_item_soft_deletes (organization_id, radicado)
  WHERE status = 'DELETED';

-- 5. RPC function to purge acts and pubs (bypasses any DELETE triggers via session flag)
CREATE OR REPLACE FUNCTION public.purge_work_item_acts_and_pubs(p_work_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('atenia.purge_mode', 'true', true);
  DELETE FROM work_item_publicaciones WHERE work_item_id = p_work_item_id;
  DELETE FROM work_item_acts WHERE work_item_id = p_work_item_id;
  PERFORM set_config('atenia.purge_mode', 'false', true);
END;
$$;

-- 6. RPC function to purge all related data for a work item
CREATE OR REPLACE FUNCTION public.purge_work_item_related_data(p_work_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Provider-related
  DELETE FROM provider_sync_traces WHERE work_item_id = p_work_item_id;
  DELETE FROM provider_raw_snapshots WHERE work_item_id = p_work_item_id;
  DELETE FROM work_item_act_extras WHERE work_item_id = p_work_item_id;
  DELETE FROM work_item_pub_extras WHERE work_item_id = p_work_item_id;
  DELETE FROM act_provenance WHERE work_item_act_id IN (
    SELECT id FROM work_item_acts WHERE work_item_id = p_work_item_id
  );
  
  -- Scraping jobs
  DELETE FROM work_item_scrape_jobs WHERE work_item_id = p_work_item_id;
  
  -- Alerts
  DELETE FROM alert_instances WHERE entity_id = p_work_item_id::text AND entity_type = 'work_item';
  DELETE FROM alert_rules WHERE entity_id = p_work_item_id::text AND entity_type = 'work_item';
  
  -- CGP related
  DELETE FROM cgp_deadlines WHERE work_item_id = p_work_item_id;
  DELETE FROM cgp_term_instances WHERE work_item_id = p_work_item_id;
  DELETE FROM cgp_milestones WHERE work_item_id = p_work_item_id;
  DELETE FROM cgp_inactivity_tracker WHERE work_item_id = p_work_item_id;
  
  -- Hearings
  DELETE FROM hearings WHERE work_item_id = p_work_item_id;
  
  -- Tasks
  DELETE FROM tasks WHERE work_item_id = p_work_item_id;
  
  -- Work item deadlines
  DELETE FROM work_item_deadlines WHERE work_item_id = p_work_item_id;
  
  -- Work item reminders
  DELETE FROM work_item_reminders WHERE work_item_id = p_work_item_id;
  
  -- Process events
  DELETE FROM process_events WHERE work_item_id = p_work_item_id;
  
  -- Actuaciones (legacy)
  DELETE FROM actuaciones WHERE work_item_id = p_work_item_id;
  
  -- Documents
  DELETE FROM documents WHERE work_item_id = p_work_item_id;
  
  -- Message links
  DELETE FROM message_links WHERE work_item_id = p_work_item_id;
  
  -- Work item mappings
  DELETE FROM work_item_mappings WHERE work_item_id = p_work_item_id;
  
  -- Desacato incidents
  DELETE FROM desacato_incidents WHERE linked_work_item_id = p_work_item_id;
  
  -- Atenia AI state
  DELETE FROM atenia_ai_work_item_state WHERE work_item_id = p_work_item_id;
  
  -- Evidence snapshots
  DELETE FROM evidence_snapshots WHERE work_item_id = p_work_item_id;
END;
$$;
