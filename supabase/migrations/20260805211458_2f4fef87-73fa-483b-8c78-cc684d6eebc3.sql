-- ══════════════════════════════════════════════════════════════
-- ITERATION 30 — Lifecycle is ONE fact, not three.
--   ACTIVE   → status ACTIVE,   deleted_at NULL,     monitoring allowed
--   PAUSED   → status INACTIVE, deleted_at NULL,     monitoring off
--   CLOSED   → status CLOSED,   deleted_at NULL,     monitoring off
--   ARCHIVED → status ARCHIVED, deleted_at NULL,     monitoring off
--   DELETED  → status INACTIVE, deleted_at NOT NULL, purge_after NOT NULL
--              (DELETED == papelera: recoverable until purge_after)
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.work_item_status_for_lifecycle(
  p_state public.work_item_lifecycle_state
) RETURNS public.item_status
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_state
    WHEN 'ACTIVE'   THEN 'ACTIVE'::public.item_status
    WHEN 'PAUSED'   THEN 'INACTIVE'::public.item_status
    WHEN 'CLOSED'   THEN 'CLOSED'::public.item_status
    WHEN 'ARCHIVED' THEN 'ARCHIVED'::public.item_status
    WHEN 'DELETED'  THEN 'INACTIVE'::public.item_status
  END
$$;

-- ── PAUSED was missing from the monitoring invariant's exclusion list, so a
--    paused matter silently re-enabled itself on the next write. Only ACTIVE
--    may carry monitoring.
CREATE OR REPLACE FUNCTION public.apply_monitoring_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_eligible boolean;
  v_suspended boolean;
BEGIN
  v_eligible := public.is_provider_monitored_workflow(NEW.workflow_type::text)
                AND NEW.radicado IS NOT NULL
                AND NEW.deleted_at IS NULL
                AND COALESCE(NEW.lifecycle_state::text,'ACTIVE') = 'ACTIVE';

  v_suspended := COALESCE(NEW.monitoring_disabled_by, '') = 'USER'
                 AND COALESCE(btrim(NEW.monitoring_disabled_reason), '') <> '';

  IF NOT v_eligible THEN
    NEW.monitoring_enabled := false;
  ELSIF NOT v_suspended THEN
    NEW.monitoring_enabled := true;
    NEW.monitoring_disabled_reason := NULL;
    NEW.monitoring_disabled_at := NULL;
    NEW.monitoring_disabled_by := NULL;
    NEW.demonitor_reason := NULL;
    NEW.demonitor_at := NULL;
  ELSE
    NEW.monitoring_enabled := false;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Backfill: derive missing lifecycle_state first, then normalise all. ──
UPDATE public.work_items
SET lifecycle_state = CASE
      WHEN deleted_at IS NOT NULL THEN 'DELETED'::public.work_item_lifecycle_state
      WHEN status = 'CLOSED'      THEN 'CLOSED'::public.work_item_lifecycle_state
      WHEN status = 'ARCHIVED'    THEN 'ARCHIVED'::public.work_item_lifecycle_state
      WHEN status = 'INACTIVE'    THEN 'PAUSED'::public.work_item_lifecycle_state
      ELSE 'ACTIVE'::public.work_item_lifecycle_state
    END
WHERE lifecycle_state IS NULL;

UPDATE public.work_items w
SET
  status = public.work_item_status_for_lifecycle(w.lifecycle_state),
  monitoring_enabled = CASE WHEN w.lifecycle_state = 'ACTIVE' THEN w.monitoring_enabled ELSE false END,
  scraping_enabled   = CASE WHEN w.lifecycle_state = 'ACTIVE' THEN w.scraping_enabled  ELSE false END,
  deleted_at  = CASE WHEN w.lifecycle_state = 'DELETED' THEN COALESCE(w.deleted_at, now()) ELSE NULL END,
  purge_after = CASE WHEN w.lifecycle_state = 'DELETED'
                     THEN COALESCE(w.purge_after, COALESCE(w.deleted_at, now()) + interval '10 days')
                     ELSE NULL END
WHERE TRUE;

-- ── Coherence guard: normalise on every write ───────────────
CREATE OR REPLACE FUNCTION public.enforce_work_item_lifecycle_coherence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.lifecycle_state IS NULL THEN
    NEW.lifecycle_state := COALESCE(OLD.lifecycle_state, 'ACTIVE'::public.work_item_lifecycle_state);
  END IF;

  -- status is DERIVED. It is never an independent fact.
  NEW.status := public.work_item_status_for_lifecycle(NEW.lifecycle_state);

  IF NEW.lifecycle_state = 'DELETED' THEN
    NEW.deleted_at  := COALESCE(NEW.deleted_at, OLD.deleted_at, now());
    NEW.purge_after := COALESCE(NEW.purge_after, OLD.purge_after, NEW.deleted_at + interval '10 days');
  ELSE
    -- Not in the trash ⇒ no trash timestamps.
    NEW.deleted_at  := NULL;
    NEW.purge_after := NULL;
  END IF;

  IF NEW.lifecycle_state <> 'ACTIVE' THEN
    NEW.monitoring_enabled := false;
    NEW.scraping_enabled   := false;
  END IF;

  RETURN NEW;
END;
$$;

-- Must run AFTER apply_monitoring_invariant (alphabetical order on same event):
-- 'trg_zz_...' sorts last so it has the final word.
DROP TRIGGER IF EXISTS trg_work_item_lifecycle_coherence ON public.work_items;
DROP TRIGGER IF EXISTS trg_zz_work_item_lifecycle_coherence ON public.work_items;
CREATE TRIGGER trg_zz_work_item_lifecycle_coherence
BEFORE INSERT OR UPDATE ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_work_item_lifecycle_coherence();

ALTER TABLE public.work_items
  DROP CONSTRAINT IF EXISTS work_items_lifecycle_coherent_chk;
ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_lifecycle_coherent_chk CHECK (
    lifecycle_state IS NULL
    OR (
      status = public.work_item_status_for_lifecycle(lifecycle_state)
      AND (lifecycle_state = 'DELETED') = (deleted_at IS NOT NULL)
      AND (lifecycle_state = 'ACTIVE' OR monitoring_enabled IS NOT TRUE)
    )
  ) NOT VALID;
ALTER TABLE public.work_items VALIDATE CONSTRAINT work_items_lifecycle_coherent_chk;

-- ── Disagreement sweep (diagnostics) ────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_work_item_lifecycle_disagreements()
RETURNS TABLE (
  work_item_id uuid,
  radicado text,
  lifecycle_state text,
  status text,
  has_deleted_at boolean,
  has_purge_after boolean,
  monitoring_enabled boolean,
  has_soft_delete_row boolean,
  disagreement text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id, w.radicado, w.lifecycle_state::text, w.status::text,
    w.deleted_at IS NOT NULL, w.purge_after IS NOT NULL, w.monitoring_enabled,
    EXISTS (SELECT 1 FROM public.work_item_soft_deletes s WHERE s.work_item_id = w.id),
    concat_ws('; ',
      CASE WHEN w.status IS DISTINCT FROM public.work_item_status_for_lifecycle(w.lifecycle_state)
           THEN 'status ' || w.status || ' no corresponde a ' || w.lifecycle_state END,
      CASE WHEN (w.lifecycle_state = 'DELETED') <> (w.deleted_at IS NOT NULL)
           THEN 'deleted_at incoherente con lifecycle_state' END,
      CASE WHEN w.lifecycle_state <> 'ACTIVE' AND w.monitoring_enabled
           THEN 'monitoreo activo en estado no ACTIVE' END,
      CASE WHEN w.lifecycle_state = 'DELETED'
                AND NOT EXISTS (SELECT 1 FROM public.work_item_soft_deletes s WHERE s.work_item_id = w.id)
           THEN 'en papelera sin registro de eliminacion' END
    )
  FROM public.work_items w
  WHERE w.lifecycle_state IS NOT NULL
    AND (
      w.status IS DISTINCT FROM public.work_item_status_for_lifecycle(w.lifecycle_state)
      OR (w.lifecycle_state = 'DELETED') <> (w.deleted_at IS NOT NULL)
      OR (w.lifecycle_state <> 'ACTIVE' AND w.monitoring_enabled)
      OR (w.lifecycle_state = 'DELETED'
          AND NOT EXISTS (SELECT 1 FROM public.work_item_soft_deletes s WHERE s.work_item_id = w.id))
    )
$$;

REVOKE ALL ON FUNCTION public.rpc_work_item_lifecycle_disagreements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_work_item_lifecycle_disagreements() TO authenticated, service_role;

-- ── Trash expiry: the promised permanent deletion, as a real query ──
CREATE OR REPLACE FUNCTION public.list_expired_trashed_work_items()
RETURNS TABLE (work_item_id uuid, radicado text, purge_after timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.radicado, w.purge_after
  FROM public.work_items w
  WHERE w.lifecycle_state = 'DELETED'
    AND w.purge_after IS NOT NULL
    AND w.purge_after < now()
  ORDER BY w.purge_after
$$;

REVOKE ALL ON FUNCTION public.list_expired_trashed_work_items() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_expired_trashed_work_items() TO service_role;