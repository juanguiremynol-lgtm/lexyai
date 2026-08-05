-- Iteration 28: single source of truth for workflow_type
-- (a) live mirrors: work_item_acts, gcp_lifecycle_outbox (undelivered), work_item_sync_timeline, sync_retry_queue
-- (b) historical audit (NOT touched): sync_audit_log, sync_traces, monitoring_reconciliation_log,
--     platform_job_heartbeats, work_item_soft_deletes, atenia_ai_actions, delivered outbox rows
-- (c) suggestions (NOT touched): detected_processes.workflow_inferido, icarus_import_rows.*

-- 1. Backfill live mirrors -------------------------------------------------
UPDATE public.work_item_acts a
SET workflow_type = w.workflow_type::text
FROM public.work_items w
WHERE w.id = a.work_item_id
  AND a.workflow_type IS DISTINCT FROM w.workflow_type::text;

UPDATE public.gcp_lifecycle_outbox o
SET workflow_type = w.workflow_type::text
FROM public.work_items w
WHERE w.id = o.work_item_id
  AND o.delivered_at IS NULL
  AND o.workflow_type IS DISTINCT FROM w.workflow_type::text;

-- 2. Option (a): drop the redundant copies that nothing authoritative reads
ALTER TABLE public.work_item_sync_timeline DROP COLUMN IF EXISTS workflow_type;
ALTER TABLE public.sync_retry_queue DROP COLUMN IF EXISTS workflow_type;

-- 3. Option (b) guards for the copies that must stay (read by deadline
--    functions / emitted in outbox message payloads)
CREATE OR REPLACE FUNCTION public.stamp_act_workflow_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT w.workflow_type::text INTO NEW.workflow_type
  FROM public.work_items w
  WHERE w.id = NEW.work_item_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_act_workflow_type ON public.work_item_acts;
CREATE TRIGGER trg_stamp_act_workflow_type
BEFORE INSERT ON public.work_item_acts
FOR EACH ROW EXECUTE FUNCTION public.stamp_act_workflow_type();

CREATE OR REPLACE FUNCTION public.propagate_workflow_type_to_mirrors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workflow_type IS DISTINCT FROM OLD.workflow_type THEN
    UPDATE public.work_item_acts
    SET workflow_type = NEW.workflow_type::text
    WHERE work_item_id = NEW.id
      AND workflow_type IS DISTINCT FROM NEW.workflow_type::text;

    UPDATE public.gcp_lifecycle_outbox
    SET workflow_type = NEW.workflow_type::text
    WHERE work_item_id = NEW.id
      AND delivered_at IS NULL
      AND workflow_type IS DISTINCT FROM NEW.workflow_type::text;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_workflow_type ON public.work_items;
CREATE TRIGGER trg_propagate_workflow_type
AFTER UPDATE OF workflow_type ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.propagate_workflow_type_to_mirrors();

-- 4. Drift detection -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_workflow_type_drift_summary()
RETURNS TABLE(mirror_table text, drift_rows bigint, sample_work_item_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'work_item_acts'::text,
         count(*)::bigint,
         min(a.work_item_id::text)
  FROM public.work_item_acts a
  JOIN public.work_items w ON w.id = a.work_item_id
  WHERE a.workflow_type IS DISTINCT FROM w.workflow_type::text
  UNION ALL
  SELECT 'gcp_lifecycle_outbox'::text,
         count(*)::bigint,
         min(o.work_item_id::text)
  FROM public.gcp_lifecycle_outbox o
  JOIN public.work_items w ON w.id = o.work_item_id
  WHERE o.delivered_at IS NULL
    AND o.workflow_type IS DISTINCT FROM w.workflow_type::text;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_workflow_type_drift_summary() TO authenticated, service_role;