-- Repair the database KPI reader in place without changing ledger history or
-- its existing EXECUTE grants. Preserve the exact live definition for rollback.
BEGIN;
DO $precondition$
BEGIN
  IF to_regclass('public.daily_sync_health_definition_backup_20261108') IS NOT NULL OR
     to_regprocedure('public.daily_sync_chain_evidence_20261108(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'health evidence release name already exists';
  END IF;
END
$precondition$;
CREATE TABLE public.daily_sync_health_definition_backup_20261108 (
  signature text PRIMARY KEY,definition text NOT NULL,installed_definition text,saved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.daily_sync_health_definition_backup_20261108 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_sync_health_definition_backup_20261108 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.daily_sync_health_definition_backup_20261108 TO service_role;
INSERT INTO public.daily_sync_health_definition_backup_20261108(signature,definition)
SELECT 'public.daily_sync_health_snapshot(integer,date)',
  pg_get_functiondef('public.daily_sync_health_snapshot(integer,date)'::regprocedure);

CREATE OR REPLACE FUNCTION public.daily_sync_chain_evidence_20261108(_organization uuid,_chain_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $fn$
WITH base AS MATERIALIZED (
  SELECT * FROM public.auto_sync_daily_ledger
  WHERE organization_id=_organization AND chain_id=_chain_id
), stats AS (
  SELECT count(*) AS n,count(DISTINCT run_date) AS days,
    count(*) FILTER (WHERE is_continuation IS FALSE) AS initial_count,
    max(expected_total_items) FILTER (WHERE is_continuation IS FALSE) AS initial_target,
    sum(items_succeeded) AS succeeded,sum(items_failed) AS failed,sum(items_skipped) AS skipped,
    sum(dead_letter_count) AS dead_letters,sum(timeout_count) AS timeouts,
    sum(CASE WHEN jsonb_typeof(metadata->'items_dispatched')='number'
      THEN (metadata->>'items_dispatched')::numeric END) AS dispatched,
    max(CASE WHEN jsonb_typeof(metadata->'dead_lettered_excluded')='number'
      THEN (metadata->>'dead_lettered_excluded')::numeric END) AS excluded,
    bool_and(coalesce(status::text IN ('SUCCESS','PARTIAL') AND items_succeeded>=0
      AND items_failed=0 AND items_skipped=0 AND dead_letter_count=0 AND timeout_count=0
      AND metadata->'items_dispatched'='0'::jsonb AND metadata->'dead_lettered_excluded'='0'::jsonb,false)) AS clean
  FROM base
), first_stage AS (
  SELECT is_continuation FROM base ORDER BY created_at,id LIMIT 1
), last_stage AS (
  SELECT status,finished_at FROM base ORDER BY created_at DESC,id DESC LIMIT 1
), verdict AS (
  SELECT stats.*,l.status AS last_status,
    coalesce(_chain_id IS NOT NULL AND n>0 AND days=1 AND initial_count=1
      AND f.is_continuation IS FALSE AND l.status::text='SUCCESS' AND l.finished_at IS NOT NULL
      AND initial_target>0 AND succeeded=initial_target AND clean,false) AS complete
  FROM stats LEFT JOIN first_stage f ON true LEFT JOIN last_stage l ON true
)
SELECT jsonb_build_object('fully_synced',complete,'evidence_scope','SELECTED_ACTUACIONES_ONLY',
  'explanation',CASE WHEN complete THEN 'El lote seleccionado de actuaciones terminó con la evidencia disponible.'
    WHEN n=0 THEN 'No hay una cadena identificable.'
    WHEN failed>0 THEN 'La cadena conserva fallos de asuntos.'
    WHEN dispatched>0 THEN 'Hay despachos cuyo resultado no se concilia en este indicador.'
    WHEN excluded>0 THEN 'El programador excluyó registros de fallos; pueden incluir asuntos inactivos.'
    ELSE 'Falta evidencia para acreditar el lote seleccionado.' END,
  'last_stage_status',last_status,'selected',initial_target,'succeeded',succeeded,
  'failed',failed,'skipped',skipped,'timeouts',timeouts,'new_dead_letters',dead_letters,
  'dispatched_attempts',dispatched,'excluded_tracker_entries',excluded)
FROM verdict
$fn$;
REVOKE ALL ON FUNCTION public.daily_sync_chain_evidence_20261108(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.daily_sync_chain_evidence_20261108(uuid,text) TO service_role;

DO $repair$
DECLARE d text; n text; replacement text; old_count integer;
BEGIN
  SELECT definition INTO STRICT d FROM public.daily_sync_health_definition_backup_20261108
  WHERE signature='public.daily_sync_health_snapshot(integer,date)';
  -- Every expected shape must match exactly; no best-effort production patch.
  FOR n,replacement,old_count IN VALUES
    ('(l.last_status = ''SUCCESS'' AND a.total_skipped = 0) AS fully_synced',
     'coalesce((public.daily_sync_chain_evidence_20261108(a.organization_id,a.chain_id)->>''fully_synced'')::boolean,false) AS fully_synced, public.daily_sync_chain_evidence_20261108(a.organization_id,a.chain_id) AS chain_evidence',2),
    ('AND a.chain_id = b.chain_id','AND a.chain_id IS NOT DISTINCT FROM b.chain_id',2),
    ('JOIN chain_last l USING (organization_id, run_date, chain_id)',
     'JOIN chain_last l ON l.organization_id=a.organization_id AND l.run_date=a.run_date AND l.chain_id IS NOT DISTINCT FROM a.chain_id',1),
    ('JOIN chain_last l USING (organization_id, chain_id)',
     'JOIN chain_last l ON l.organization_id=a.organization_id AND l.chain_id IS NOT DISTINCT FROM a.chain_id',1),
    ('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p.convergence_minutes)',
     'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p.convergence_minutes) FILTER (WHERE p.fully_synced AND NOT EXISTS (SELECT 1 FROM per_org_day peer WHERE peer.organization_id=p.organization_id AND peer.run_date=p.run_date AND peer.fully_synced IS DISTINCT FROM true))',1),
    ('EXTRACT(EPOCH FROM first_sync_at::time)',
     'EXTRACT(EPOCH FROM ((first_sync_at AT TIME ZONE ''America/Bogota'')::time))',1),
    ('''run_date'', pd.run_date,','''evidence_scope'', ''SELECTED_ACTUACIONES_ONLY'', ''run_date'', pd.run_date,',1),
    ('''chain_id'', chain_id,','''chain_id'', chain_id, ''chain_evidence'', chain_evidence,',1),
    ('ROUND(convergence_minutes::numeric, 1)',
     'CASE WHEN fully_synced THEN ROUND(convergence_minutes::numeric, 1) ELSE NULL END',1),
    ('COUNT(*) FILTER (WHERE p.fully_synced)',
     'COUNT(DISTINCT p.organization_id) FILTER (WHERE p.fully_synced AND NOT EXISTS (SELECT 1 FROM per_org_day peer WHERE peer.organization_id=p.organization_id AND peer.run_date=p.run_date AND peer.fully_synced IS DISTINCT FROM true))',2),
    ('NULLIF(COUNT(*), 0)','NULLIF(COUNT(DISTINCT p.organization_id), 0)',1)
  LOOP
    IF (length(d)-length(replace(d,n,'')))/length(n) <> old_count THEN
      RAISE EXCEPTION 'unexpected health snapshot definition for %',left(n,80);
    END IF;
    d := replace(d,n,replacement);
  END LOOP;
  EXECUTE d;
  UPDATE public.daily_sync_health_definition_backup_20261108
  SET installed_definition=pg_get_functiondef('public.daily_sync_health_snapshot(integer,date)'::regprocedure)
  WHERE signature='public.daily_sync_health_snapshot(integer,date)';
END
$repair$;
COMMIT;
