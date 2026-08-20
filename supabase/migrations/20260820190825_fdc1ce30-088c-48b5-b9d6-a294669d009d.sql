DROP FUNCTION IF EXISTS public.purge_soft_deleted_work_items(integer, boolean);

ALTER TABLE public.work_item_tombstones
  ADD COLUMN IF NOT EXISTS archived_record jsonb;

CREATE OR REPLACE FUNCTION public.purge_soft_deleted_work_items(
  p_retention_days integer DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_simulate_verify_failure boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => p_retention_days);
  r record;
  v_counts jsonb;
  v_archive jsonb;
  v_items jsonb := '[]'::jsonb;
  v_purged int := 0;
  v_rolled_back int := 0;
  v_deleted jsonb;
  v_ok boolean;
  v_tomb_acts int;
  v_n int;
BEGIN
  FOR r IN
    SELECT w.*
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
      'work_item_hearings', (SELECT count(*) FROM public.work_item_hearings  t WHERE t.work_item_id = r.id),
      'tasks',         (SELECT count(*) FROM public.work_item_tasks          t WHERE t.work_item_id = r.id),
      'email_links',   (SELECT count(*) FROM public.work_item_email_links    t WHERE t.work_item_id = r.id),
      'alerts',        (SELECT count(*) FROM public.alert_instances          t WHERE t.entity_id    = r.id),
      'sync_runs',     (SELECT count(*) FROM public.external_sync_runs       t WHERE t.work_item_id = r.id),
      'sync_traces',   (SELECT count(*) FROM public.sync_traces              t WHERE t.work_item_id = r.id),
      'sync_timeline', (SELECT count(*) FROM public.work_item_sync_timeline  t WHERE t.work_item_id = r.id),
      'soft_deletes',  (SELECT count(*) FROM public.work_item_soft_deletes   t WHERE t.work_item_id = r.id),
      'user_data_alerts', (SELECT count(*) FROM public.user_data_alerts      t WHERE t.work_item_id = r.id),
      'deep_dives',    (SELECT count(*) FROM public.atenia_deep_dives        t WHERE t.work_item_id = r.id),
      'e2e_registry',  (SELECT count(*) FROM public.atenia_e2e_test_registry t WHERE t.work_item_id = r.id),
      'e2e_results',   (SELECT count(*) FROM public.atenia_e2e_test_results  t WHERE t.work_item_id = r.id)
    ) INTO v_counts;

    v_archive := jsonb_build_object(
      'schema_version', 1,
      'archived_at', now(),
      'work_item', to_jsonb(r),
      'acts',          COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.act_date, t.id) FROM public.work_item_acts t WHERE t.work_item_id = r.id), '[]'::jsonb),
      'publicaciones', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.work_item_publicaciones t WHERE t.work_item_id = r.id), '[]'::jsonb),
      'deadlines',     COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.work_item_deadlines t WHERE t.work_item_id = r.id), '[]'::jsonb),
      'hearings',      COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.hearings t WHERE t.work_item_id = r.id), '[]'::jsonb),
      'work_item_hearings', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.work_item_hearings t WHERE t.work_item_id = r.id), '[]'::jsonb),
      'tasks',         COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.work_item_tasks t WHERE t.work_item_id = r.id), '[]'::jsonb),
      'email_links',   COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.work_item_email_links t WHERE t.work_item_id = r.id), '[]'::jsonb),
      'alert_instances', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.alert_instances t WHERE t.entity_id = r.id), '[]'::jsonb),
      'counts', v_counts
    );

    IF p_dry_run THEN
      v_items := v_items || jsonb_build_object(
        'id', r.id, 'radicado', r.radicado, 'titulo', r.title,
        'workflow_type', r.workflow_type, 'despacho', r.authority_name,
        'deleted_at', r.deleted_at, 'delete_reason', r.delete_reason,
        'acts_archived', (v_counts->>'acts')::int,
        'archive_bytes', pg_column_size(v_archive),
        'would_cascade', v_counts,
        'result', 'DRY_RUN'
      );
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.work_item_tombstones
        (id, radicado, titulo, workflow_type, despacho, deleted_at, delete_reason, purged_at, counts, archived_record)
      VALUES (r.id, r.radicado, r.title, r.workflow_type, r.authority_name,
              r.deleted_at, r.delete_reason, now(), v_counts, v_archive)
      ON CONFLICT (id) DO UPDATE SET
        purged_at = now(), counts = EXCLUDED.counts, archived_record = EXCLUDED.archived_record;

      SELECT true, jsonb_array_length(t.archived_record->'acts')
        INTO v_ok, v_tomb_acts
        FROM public.work_item_tombstones t
       WHERE t.id = r.id AND t.archived_record IS NOT NULL;

      IF p_simulate_verify_failure THEN
        v_ok := false;
      END IF;

      IF NOT COALESCE(v_ok, false) OR v_tomb_acts IS DISTINCT FROM (v_counts->>'acts')::int THEN
        RAISE EXCEPTION 'TOMBSTONE_VERIFY_FAILED for %', r.id;
      END IF;

      v_deleted := '{}'::jsonb;
      DELETE FROM public.work_item_sync_timeline  WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('sync_timeline', v_n);
      DELETE FROM public.sync_traces              WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('sync_traces', v_n);
      DELETE FROM public.external_sync_runs       WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('sync_runs', v_n);
      DELETE FROM public.alert_instances          WHERE entity_id    = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('alerts', v_n);
      DELETE FROM public.work_item_email_links    WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('email_links', v_n);
      DELETE FROM public.work_item_tasks          WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('tasks', v_n);
      DELETE FROM public.work_item_hearings       WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('work_item_hearings', v_n);
      DELETE FROM public.hearings                 WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('hearings', v_n);
      DELETE FROM public.work_item_deadlines      WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('deadlines', v_n);
      DELETE FROM public.work_item_publicaciones  WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('publicaciones', v_n);
      DELETE FROM public.work_item_acts           WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('acts', v_n);
      DELETE FROM public.atenia_e2e_test_results  WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('e2e_results', v_n);
      DELETE FROM public.atenia_e2e_test_registry WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('e2e_registry', v_n);
      DELETE FROM public.atenia_deep_dives        WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('deep_dives', v_n);
      DELETE FROM public.user_data_alerts         WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('user_data_alerts', v_n);
      DELETE FROM public.atenia_ai_user_reports   WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ai_user_reports', v_n);
      DELETE FROM public.ghost_verification_runs  WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('ghost_runs', v_n);
      DELETE FROM public.generated_documents      WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('generated_documents', v_n);
      DELETE FROM public.desacato_incidents       WHERE linked_work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('desacato_incidents', v_n);
      DELETE FROM public.work_item_soft_deletes   WHERE work_item_id = r.id; GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('soft_deletes', v_n);
      DELETE FROM public.work_items
        WHERE id = r.id AND deleted_at IS NOT NULL AND deleted_at < v_cutoff;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('work_items', v_n);

      v_purged := v_purged + 1;
      v_items := v_items || jsonb_build_object(
        'id', r.id, 'radicado', r.radicado, 'titulo', r.title,
        'workflow_type', r.workflow_type, 'despacho', r.authority_name,
        'deleted_at', r.deleted_at, 'delete_reason', r.delete_reason,
        'acts_archived', (v_counts->>'acts')::int,
        'archive_bytes', pg_column_size(v_archive),
        'deleted', v_deleted, 'result', 'PURGED'
      );
    EXCEPTION WHEN OTHERS THEN
      v_rolled_back := v_rolled_back + 1;
      v_items := v_items || jsonb_build_object(
        'id', r.id, 'radicado', r.radicado, 'titulo', r.title,
        'acts_archived', 0, 'result', 'ROLLED_BACK', 'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'retention_days', p_retention_days,
    'cutoff', v_cutoff,
    'candidates', jsonb_array_length(v_items),
    'purged', v_purged,
    'rolled_back', v_rolled_back,
    'items', v_items
  );
END $function$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted_work_items(integer, boolean, boolean) FROM public;
REVOKE ALL ON FUNCTION public.purge_soft_deleted_work_items(integer, boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.purge_soft_deleted_work_items(integer, boolean, boolean) FROM authenticated;