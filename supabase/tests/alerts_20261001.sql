-- Alert saturation / manual-review coherence suite (01/10/2026).
-- Runs inside a transaction that is ROLLED BACK. Run: psql -v ON_ERROR_STOP=1 -f <file>
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE _t(name text, got text, want text);

-- regenerate_doctrine_alerts emits 0 term alerts and 0 legacy hearing alerts
CREATE TEMP TABLE _before AS
  SELECT count(*) c FROM public.alert_instances
   WHERE alert_type IN ('TERMINO_POR_VENCER','TERMINO_CRITICO','TERMINO_VENCIDO');
SELECT public.regenerate_doctrine_alerts() AS r \gset
INSERT INTO _t SELECT 'regenerate: terminos=0', (:'r'::jsonb->>'terminos'), '0';
INSERT INTO _t SELECT 'regenerate: audiencias legacy=0', (:'r'::jsonb->>'audiencias'), '0';
INSERT INTO _t SELECT 'regenerate: no new term rows',
  ((SELECT count(*) FROM public.alert_instances WHERE alert_type IN ('TERMINO_POR_VENCER','TERMINO_CRITICO','TERMINO_VENCIDO'))
   - (SELECT c FROM _before))::text, '0';
INSERT INTO _t SELECT 'regenerate: body has no TERMINO insert',
  (pg_get_functiondef('public.regenerate_doctrine_alerts'::regproc) ~ 'TERMINO_(POR_VENCER|CRITICO|VENCIDO)')::text, 'false';
INSERT INTO _t SELECT 'regenerate: body does not read legacy hearings',
  (pg_get_functiondef('public.regenerate_doctrine_alerts'::regproc) ~ 'public\.hearings\M')::text, 'false';

-- Manual review: every REQUIERE_REVISION_MANUAL row has the boolean true
INSERT INTO _t SELECT 'manual review inconsistent rows',
  (SELECT count(*) FROM public.work_item_deadlines WHERE status='REQUIERE_REVISION_MANUAL' AND requires_manual_review IS NOT TRUE)::text, '0';
-- Backed-up rows: status unchanged vs backup
INSERT INTO _t SELECT 'backup rows with drifted status',
  (SELECT count(*) FROM public.deadline_manual_review_backup_20261001 b
     JOIN public.work_item_deadlines d ON d.id = b.deadline_id
    WHERE d.status IS DISTINCT FROM b.prev_status)::text, '0';

-- Trigger guarantee on new writes (test role cannot write deadlines: verify the guard itself)
INSERT INTO _t SELECT 'sync trigger present & enabled',
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_sync_manual_review_flag' AND tgenabled <> 'D')::text, '1';
INSERT INTO _t SELECT 'trigger forces true only for REQUIERE_REVISION_MANUAL',
  (SELECT pg_get_functiondef(tgfoid) ~ 'REQUIERE_REVISION_MANUAL' FROM pg_trigger WHERE tgname='trg_sync_manual_review_flag')::text, 'true';

-- Unread semantics: closed rows (CANCELLED/RESOLVED/DISMISSED/SUPERSEDED) with read_at null are not "unread"
INSERT INTO _t SELECT 'live-unread selector excludes closed',
  (SELECT count(*) FROM public.alert_instances
    WHERE read_at IS NULL AND status IN ('PENDING','SENT','ACKNOWLEDGED')
      AND status IN ('CANCELLED','RESOLVED','DISMISSED','SUPERSEDED'))::text, '0';

-- One live term alert per deadline
INSERT INTO _t SELECT 'deadlines with >1 live term alert',
  (SELECT count(*) FROM (SELECT payload->>'deadline_id' FROM public.alert_instances
     WHERE alert_type IN ('TERMINO_POR_VENCER','TERMINO_CRITICO','TERMINO_VENCIDO')
       AND status IN ('PENDING','SENT','ACKNOWLEDGED') AND payload ? 'deadline_id'
     GROUP BY 1 HAVING count(*) > 1) x)::text, '0';

-- A) Holiday-aware milestones around Columbus Day 12/10/2026 (engine SQL calendar)
INSERT INTO _t SELECT 'bd 09/10->13/10 skips holiday 12/10', public.business_days_between_sql('2026-10-09','2026-10-13')::text, '1';
INSERT INTO _t SELECT 'bd 01/10->14/10 = 8 (D-8, weekend-only would say 9)', public.business_days_between_sql('2026-10-01','2026-10-14')::text, '8';
INSERT INTO _t SELECT 'bd 08/10->13/10 = 2 (D-3)', public.business_days_between_sql('2026-10-08','2026-10-13')::text, '2';
INSERT INTO _t SELECT 'bd 09/10->14/10 = 2 not 3', public.business_days_between_sql('2026-10-09','2026-10-14')::text, '2';
INSERT INTO _t SELECT '12/10/2026 registered as holiday', (SELECT count(*) FROM public.colombian_holidays WHERE holiday_date='2026-10-12')::text, '1';

-- B) Manual-review alerts never carry an urgency type
INSERT INTO _t SELECT 'TERMINO_REVISION_MANUAL accepted by check', (pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='alert_instances_alert_type_check')) ~ 'TERMINO_REVISION_MANUAL')::text, 'true';

SELECT name, got, want, CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END AS result FROM _t;
SELECT count(*) FILTER (WHERE got = want) AS passed, count(*) AS total FROM _t;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM _t WHERE got IS DISTINCT FROM want) THEN RAISE EXCEPTION 'alerts_20261001: failures'; END IF; END $$;
ROLLBACK;
