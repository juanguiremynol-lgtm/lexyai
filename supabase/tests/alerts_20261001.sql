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

-- Trigger guarantee on new writes: forcing false on a manual-review row is corrected to true
UPDATE public.work_item_deadlines SET requires_manual_review = false
 WHERE id = (SELECT id FROM public.work_item_deadlines WHERE status='REQUIERE_REVISION_MANUAL' LIMIT 1);
INSERT INTO _t SELECT 'trigger keeps boolean true',
  (SELECT count(*) FROM public.work_item_deadlines WHERE status='REQUIERE_REVISION_MANUAL' AND requires_manual_review IS NOT TRUE)::text, '0';

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

SELECT name, got, want, CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END AS result FROM _t;
SELECT count(*) FILTER (WHERE got = want) AS passed, count(*) AS total FROM _t;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM _t WHERE got IS DISTINCT FROM want) THEN RAISE EXCEPTION 'alerts_20261001: failures'; END IF; END $$;
ROLLBACK;
