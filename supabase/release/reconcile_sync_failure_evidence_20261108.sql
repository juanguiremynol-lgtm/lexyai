-- Re-enable a daily-sync tracker only after a later, attributable, fully
-- persisted source observation. This routine does not call any provider,
-- enqueue work, touch user data or advance freshness timestamps.
BEGIN;
DO $precondition$
BEGIN
  IF to_regclass('public.sync_failure_evidence_recovery_audit_20261108') IS NOT NULL OR
     to_regprocedure('public.reconcile_sync_failure_evidence_20261108(boolean,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'reconciliation release name already exists';
  END IF;
END
$precondition$;
CREATE TABLE public.sync_failure_evidence_recovery_audit_20261108 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  timeline_id uuid NOT NULL,
  sync_run_id uuid NOT NULL,
  source_observed_at timestamptz NOT NULL,
  prior_tracker jsonb NOT NULL,
  recovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, timeline_id)
);
ALTER TABLE public.sync_failure_evidence_recovery_audit_20261108 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_failure_evidence_recovery_audit_20261108 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.sync_failure_evidence_recovery_audit_20261108 TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_sync_failure_evidence_20261108(
  _dry_run boolean DEFAULT true,
  _limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c record;
  v_examined integer := 0;
  v_recovered integer := 0;
  v_changed uuid;
  v_cutoff timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota';
BEGIN
  IF _dry_run IS NULL OR _limit IS NULL OR _limit < 1 OR _limit > 20 THEN
    RAISE EXCEPTION 'invalid reconciliation options';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sync-failure-evidence-20261108', 0));
  FOR c IN
    SELECT t.work_item_id, t.organization_id, to_jsonb(t) AS prior_tracker,
      s.id AS timeline_id, s.started_at AS timeline_started_at, s.created_at AS timeline_created_at,
      r.id AS sync_run_id, obs.source_observed_at
    FROM public.sync_item_failure_tracker t
    JOIN public.work_items w ON w.id=t.work_item_id AND w.organization_id=t.organization_id
    JOIN LATERAL (
      SELECT x.id,x.organization_id,x.sync_run_id,x.provider,x.status,x.error_code,x.started_at,x.finished_at,x.created_at,x.metadata
      FROM public.work_item_sync_timeline x
      WHERE x.work_item_id=t.work_item_id AND x.operation='acts'
      ORDER BY x.started_at DESC NULLS LAST,x.id DESC LIMIT 1
    ) s ON true
    JOIN public.external_sync_runs r ON r.id=s.sync_run_id AND r.work_item_id=t.work_item_id
      AND r.organization_id=t.organization_id AND r.status='SUCCESS' AND r.finished_at IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT CASE WHEN coalesce(s.metadata->>'source_observed_at','') ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        AND pg_input_is_valid(s.metadata->>'source_observed_at','timestamp with time zone')
        THEN (s.metadata->>'source_observed_at')::timestamptz ELSE NULL END AS source_observed_at
    ) obs
    WHERE t.dead_lettered=true AND t.dead_lettered_at IS NOT NULL AND t.last_failure_at IS NOT NULL
      AND w.deleted_at IS NULL AND w.lifecycle_state::text='ACTIVE' AND w.monitoring_enabled=true
      AND w.radicado IS NOT NULL AND length(regexp_replace(w.radicado,'[^0-9]','','g'))=23
      AND w.workflow_type::text IN ('CGP','LABORAL','CPACA','TUTELA','PENAL_906','EJECUTIVO')
      AND (w.stage IS NULL OR w.stage NOT IN ('ARCHIVADO','FINALIZADO','EJECUTORIADO',
        'PRECLUIDO_ARCHIVADO','FINALIZADO_ABSUELTO','FINALIZADO_CONDENADO'))
      AND (s.organization_id IS NULL OR s.organization_id=t.organization_id)
      AND s.status='success' AND s.error_code IS NULL AND s.metadata->'source_complete'='true'::jsonb
      AND s.started_at > greatest(t.dead_lettered_at,t.last_failure_at)
      AND s.finished_at IS NOT NULL AND s.finished_at <= now()
      AND obs.source_observed_at >= v_cutoff AND obs.source_observed_at <= s.finished_at
      AND obs.source_observed_at > greatest(t.dead_lettered_at,t.last_failure_at)
      AND (
        (w.workflow_type::text='CPACA' AND lower(btrim(s.provider))='samai') OR
        (w.workflow_type::text IN ('CGP','LABORAL','PENAL_906','EJECUTIVO') AND lower(btrim(s.provider))='cpnu') OR
        (w.workflow_type::text='TUTELA' AND
          (SELECT array_agg(btrim(v) ORDER BY btrim(v))
           FROM regexp_split_to_table(lower(coalesce(s.provider,'')),'[+,/|]') v)
             = ARRAY['cpnu','samai']::text[])
      )
      -- The most recent recorded attempt for every required provider must
      -- itself be successful; a combined or missing source cannot pass.
      AND NOT EXISTS (
        SELECT 1 FROM unnest(CASE WHEN w.workflow_type::text='CPACA' THEN ARRAY['SAMAI']
          WHEN w.workflow_type::text='TUTELA' THEN ARRAY['CPNU','SAMAI']
          ELSE ARRAY['CPNU'] END) AS required(provider)
        LEFT JOIN LATERAL (
          SELECT a.status,a.error_code,a.http_code FROM public.external_sync_run_attempts a
          WHERE a.sync_run_id=r.id AND a.data_kind='ACTUACIONES' AND upper(a.provider)=required.provider
          ORDER BY a.recorded_at DESC NULLS LAST,a.id DESC LIMIT 1
        ) a ON true
        WHERE a.status IS DISTINCT FROM 'success' OR a.error_code IS NOT NULL
          OR a.http_code IS NULL OR a.http_code NOT BETWEEN 200 AND 299
      )
    ORDER BY t.dead_lettered_at,t.work_item_id
    LIMIT _limit FOR UPDATE OF t SKIP LOCKED
  LOOP
    v_examined := v_examined+1;
    IF NOT _dry_run THEN
      UPDATE public.sync_item_failure_tracker t SET consecutive_failures=0,dead_lettered=false,
        dead_lettered_at=NULL,dead_lettered_run_id=NULL,reset_at=now()
      WHERE t.work_item_id=c.work_item_id AND t.dead_lettered=true
        AND t.last_failure_at IS NOT DISTINCT FROM (c.prior_tracker->>'last_failure_at')::timestamptz
        AND t.dead_lettered_at IS NOT DISTINCT FROM (c.prior_tracker->>'dead_lettered_at')::timestamptz
        AND EXISTS (SELECT 1 FROM public.external_sync_runs live_run WHERE live_run.id=c.sync_run_id
          AND live_run.work_item_id=c.work_item_id AND live_run.organization_id=c.organization_id
          AND live_run.status='SUCCESS' AND live_run.finished_at IS NOT NULL)
        AND EXISTS (SELECT 1 FROM public.work_item_sync_timeline live_event WHERE live_event.id=c.timeline_id
          AND live_event.work_item_id=c.work_item_id AND live_event.sync_run_id=c.sync_run_id
          AND (live_event.organization_id IS NULL OR live_event.organization_id=c.organization_id)
          AND live_event.status='success' AND live_event.error_code IS NULL
          AND live_event.metadata->'source_complete'='true'::jsonb)
        AND NOT EXISTS (SELECT 1 FROM public.work_item_sync_timeline newer
          WHERE newer.work_item_id=c.work_item_id AND newer.operation='acts' AND newer.id<>c.timeline_id AND (
              newer.started_at > c.timeline_started_at OR
              (newer.started_at=c.timeline_started_at AND newer.id>c.timeline_id) OR
              (newer.started_at IS NULL AND newer.created_at >= c.timeline_created_at)))
      RETURNING t.work_item_id INTO v_changed;
      IF v_changed IS NOT NULL THEN
        INSERT INTO public.sync_failure_evidence_recovery_audit_20261108
          (work_item_id,organization_id,timeline_id,sync_run_id,source_observed_at,prior_tracker)
        VALUES(c.work_item_id,c.organization_id,c.timeline_id,c.sync_run_id,c.source_observed_at,c.prior_tracker);
        v_recovered := v_recovered+1;
      END IF;
      v_changed := NULL;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run',_dry_run,'candidates',v_examined,'recovered',v_recovered,
    'cutoff_bogota_day',v_cutoff,'provider_requests',0);
END
$fn$;

REVOKE ALL ON FUNCTION public.reconcile_sync_failure_evidence_20261108(boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_sync_failure_evidence_20261108(boolean,integer) TO service_role;
COMMIT;
