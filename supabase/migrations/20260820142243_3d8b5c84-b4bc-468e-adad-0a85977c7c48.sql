-- ═══ P0-B.4 DATABASE-LEVEL ENFORCEMENT ═══
CREATE OR REPLACE FUNCTION public.reject_sync_run_for_deleted_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.work_item_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.work_items
     WHERE id = NEW.work_item_id AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'sync run rejected: work_item % is soft-deleted', NEW.work_item_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reject_sync_run_deleted ON public.external_sync_runs;
CREATE TRIGGER trg_reject_sync_run_deleted
  BEFORE INSERT ON public.external_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.reject_sync_run_for_deleted_item();

DROP TRIGGER IF EXISTS trg_reject_sync_run_deleted ON public.provider_sync_traces;
CREATE TRIGGER trg_reject_sync_run_deleted
  BEFORE INSERT ON public.provider_sync_traces
  FOR EACH ROW EXECUTE FUNCTION public.reject_sync_run_for_deleted_item();

DROP TRIGGER IF EXISTS trg_reject_sync_run_deleted ON public.sync_traces;
CREATE TRIGGER trg_reject_sync_run_deleted
  BEFORE INSERT ON public.sync_traces
  FOR EACH ROW EXECUTE FUNCTION public.reject_sync_run_for_deleted_item();

-- ═══ P0-B.6 TOMBSTONES ═══
CREATE TABLE IF NOT EXISTS public.work_item_tombstones (
  id            uuid PRIMARY KEY,
  radicado      text,
  titulo        text,
  workflow_type text,
  despacho      text,
  deleted_at    timestamptz,
  delete_reason text,
  purged_at     timestamptz NOT NULL DEFAULT now(),
  counts        jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT ON public.work_item_tombstones TO authenticated;
GRANT ALL    ON public.work_item_tombstones TO service_role;

ALTER TABLE public.work_item_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins read tombstones" ON public.work_item_tombstones;
CREATE POLICY "Platform admins read tombstones"
  ON public.work_item_tombstones FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ═══ P0-B.6 PURGE (DRY RUN BY DEFAULT) ═══
CREATE OR REPLACE FUNCTION public.purge_soft_deleted_work_items(
  p_retention_days int  DEFAULT 10,
  p_dry_run        bool DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => p_retention_days);
  r record;
  v_counts jsonb;
  v_items jsonb := '[]'::jsonb;
  v_purged int := 0;
BEGIN
  FOR r IN
    SELECT w.id, w.radicado, w.title, w.workflow_type, w.authority_name,
           w.deleted_at, w.delete_reason
      FROM public.work_items w
     WHERE w.deleted_at IS NOT NULL
       AND w.deleted_at < v_cutoff
     ORDER BY w.deleted_at
  LOOP
    SELECT jsonb_build_object(
      'acts',          (SELECT count(*) FROM public.work_item_acts           t WHERE t.work_item_id = r.id),
      'publicaciones', (SELECT count(*) FROM public.work_item_publicaciones  t WHERE t.work_item_id = r.id),
      'deadlines',     (SELECT count(*) FROM public.work_item_deadlines      t WHERE t.work_item_id = r.id),
      'hearings',      (SELECT count(*) FROM public.hearings                 t WHERE t.work_item_id = r.id),
      'tasks',         (SELECT count(*) FROM public.work_item_tasks          t WHERE t.work_item_id = r.id),
      'email_links',   (SELECT count(*) FROM public.work_item_email_links    t WHERE t.work_item_id = r.id),
      'alerts',        (SELECT count(*) FROM public.alert_instances          t WHERE t.entity_id    = r.id),
      'sync_runs',     (SELECT count(*) FROM public.external_sync_runs       t WHERE t.work_item_id = r.id),
      'sync_traces',   (SELECT count(*) FROM public.sync_traces              t WHERE t.work_item_id = r.id),
      'sync_timeline', (SELECT count(*) FROM public.work_item_sync_timeline  t WHERE t.work_item_id = r.id)
    ) INTO v_counts;

    v_items := v_items || jsonb_build_object(
      'id', r.id,
      'radicado', r.radicado,
      'titulo', r.title,
      'workflow_type', r.workflow_type,
      'despacho', r.authority_name,
      'deleted_at', r.deleted_at,
      'delete_reason', r.delete_reason,
      'would_cascade', v_counts
    );

    IF NOT p_dry_run THEN
      -- Tombstone FIRST. audit_logs is never touched, never cascaded into.
      INSERT INTO public.work_item_tombstones
        (id, radicado, titulo, workflow_type, despacho, deleted_at, delete_reason, purged_at, counts)
      VALUES (r.id, r.radicado, r.title, r.workflow_type, r.authority_name,
              r.deleted_at, r.delete_reason, now(), v_counts)
      ON CONFLICT (id) DO NOTHING;

      DELETE FROM public.work_item_sync_timeline  WHERE work_item_id = r.id;
      DELETE FROM public.sync_traces              WHERE work_item_id = r.id;
      DELETE FROM public.external_sync_runs       WHERE work_item_id = r.id;
      DELETE FROM public.alert_instances          WHERE entity_id    = r.id;
      DELETE FROM public.work_item_email_links    WHERE work_item_id = r.id;
      DELETE FROM public.work_item_tasks          WHERE work_item_id = r.id;
      DELETE FROM public.hearings                 WHERE work_item_id = r.id;
      DELETE FROM public.work_item_deadlines      WHERE work_item_id = r.id;
      DELETE FROM public.work_item_publicaciones  WHERE work_item_id = r.id;
      DELETE FROM public.work_item_acts           WHERE work_item_id = r.id;
      DELETE FROM public.work_items               WHERE id = r.id AND deleted_at IS NOT NULL AND deleted_at < v_cutoff;
      v_purged := v_purged + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'retention_days', p_retention_days,
    'cutoff', v_cutoff,
    'candidates', jsonb_array_length(v_items),
    'purged', v_purged,
    'items', v_items
  );
END $$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted_work_items(int, bool) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted_work_items(int, bool) TO service_role;