-- Fijacion-Estado coverage signal suite. Rolled back. psql -v ON_ERROR_STOP=1 -f <file>
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE _t(name text, got text, want text);
-- Real case: Fijacion 29/09 now has PP rows -> no OPEN signal
SELECT public.refresh_estados_fijacion_coverage_signals('2026-10-01');
INSERT INTO _t SELECT 'recovered matter has no open signal',
  (SELECT count(*) FROM public.estados_fijacion_coverage_signals WHERE act_id='798675da-c2ac-4b50-9e72-b3ba5fa36c8b' AND status='OPEN')::text,'0';
-- Simulate absence: hide its 29/09 publications inside the transaction
UPDATE public.work_item_publicaciones SET fecha_fijacion = fecha_fijacion - interval '30 days'
 WHERE work_item_id='b4037a4d-0dab-422d-a65f-b7172b040fa4' AND detected_at >= '2026-09-28';
SELECT public.refresh_estados_fijacion_coverage_signals('2026-10-01');
SELECT public.refresh_estados_fijacion_coverage_signals('2026-10-01');
INSERT INTO _t SELECT 'absence opens exactly one signal (idempotent)',
  (SELECT count(*) FROM public.estados_fijacion_coverage_signals WHERE act_id='798675da-c2ac-4b50-9e72-b3ba5fa36c8b' AND status='OPEN')::text,'1';
INSERT INTO _t SELECT 'no publication fabricated',
  (SELECT count(*) FROM public.work_item_publicaciones WHERE work_item_id='b4037a4d-0dab-422d-a65f-b7172b040fa4')::text,'23';
INSERT INTO _t SELECT 'monitoring untouched',
  (SELECT monitoring_enabled::text FROM public.work_items WHERE id='b4037a4d-0dab-422d-a65f-b7172b040fa4'),'true';
-- Publication arrives -> signal resolves
UPDATE public.work_item_publicaciones SET fecha_fijacion = fecha_fijacion + interval '30 days'
 WHERE work_item_id='b4037a4d-0dab-422d-a65f-b7172b040fa4' AND detected_at >= '2026-09-28';
SELECT public.refresh_estados_fijacion_coverage_signals('2026-10-01');
INSERT INTO _t SELECT 'arrival resolves signal',
  (SELECT status FROM public.estados_fijacion_coverage_signals WHERE act_id='798675da-c2ac-4b50-9e72-b3ba5fa36c8b'),'RESOLVED';
-- Other matters of same court untouched by this recovery
INSERT INTO _t SELECT 'other Juzgado 023 matters got no rows today',
  (SELECT count(*) FROM public.work_item_publicaciones p JOIN public.work_items w ON w.id=p.work_item_id
    WHERE w.authority_name ILIKE '%023 CIVIL MUNICIPAL DE MEDELL%' AND w.id<>'b4037a4d-0dab-422d-a65f-b7172b040fa4'
      AND p.detected_at >= '2026-10-01 13:30')::text,'0';
INSERT INTO _t SELECT 'no duplicate publications on recovered matter',
  (SELECT count(*) FROM (SELECT title, fecha_fijacion FROM public.work_item_publicaciones
     WHERE work_item_id='b4037a4d-0dab-422d-a65f-b7172b040fa4' GROUP BY 1,2 HAVING count(*)>1) x)::text,'0';
SELECT name, got, want, CASE WHEN got=want THEN 'PASS' ELSE 'FAIL' END FROM _t;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM _t WHERE got IS DISTINCT FROM want) THEN RAISE EXCEPTION 'failures'; END IF; END $$;
ROLLBACK;
