-- Incident 30/09/2026 regression suite. Runs inside a transaction that is
-- ROLLED BACK: no data is persisted. Run: psql -v ON_ERROR_STOP=1 -f <file>
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE _t(name text, got text, want text);
CREATE FUNCTION pg_temp.cls(t text, w text DEFAULT 'CPACA') RETURNS text LANGUAGE sql AS
$$ SELECT coalesce((SELECT providencia_type||'/'||coalesce(deadline_type,'-') FROM public.classify_providencia(t,w)),'NONE') $$;
CREATE FUNCTION pg_temp.chk(n text, g text, w text) RETURNS void LANGUAGE sql AS $$ INSERT INTO _t VALUES (n,g,w) $$;

-- Classification: positives
SELECT pg_temp.chk('inadmision', pg_temp.cls('Auto inadmitiendo demanda - término para corregir tres días'), 'AUTO_INADMITE/SUBSANACION');
SELECT pg_temp.chk('sentencia proferida', pg_temp.cls('Sentencia anticipada - Niega pretensiones'), 'SENTENCIA/RECURSO_APELACION_SENTENCIA');
SELECT pg_temp.chk('traslado efectivo corrase', pg_temp.cls('Auto córrase traslado a las partes para alegatos por diez días'), 'TRASLADO/TRASLADO_DEMANDA');
SELECT pg_temp.chk('requerimiento', pg_temp.cls('Auto requiere a la parte so pena de desistimiento tácito','CGP'), 'AUTO_REQUERIMIENTO/RESPUESTA_REQUERIMIENTO');
-- Negatives / informative
SELECT pg_temp.chk('comunicacion pura', pg_temp.cls('Comunicacion al correo electronico - JRS-SE COMUNICO EL AUTO QUE NOTIFICA POR ESTADOS EL 23 DE SEPTEMBRE 2026. POR CORREO ELECTRÓNICO.'), 'COMUNICACION_SECRETARIAL/-');
SELECT pg_temp.chk('traslado futuro puro (00133 p4 n4)', pg_temp.cls('Auto DISPONER que en firme esta providencia, mediante auto escrito se correrá traslado a las partes para que presenten sus alegatos de conclusión.'), 'TRASLADO_FUTURO_CONDICIONADO/-');
SELECT pg_temp.chk('anulada', pg_temp.cls('Notificación por conducta concluyente - ERROR DE INGRESO (Actuación anulada)'), 'ACTUACION_ANULADA/-');
SELECT pg_temp.chk('traslado desistimiento', pg_temp.cls('Auto Ordena - Corre traslado escrito desistimiento de pretensiones','CGP'), 'TRASLADO_DESISTIMIENTO/REVISION_MANUAL');
SELECT pg_temp.chk('dispone sentencia', pg_temp.cls('Auto que resuelve - Resolver el asunto mediante sentencia anticipada y por escrito'), 'AUTO_DISPONE_SENTENCIA/REVISION_MANUAL');
SELECT pg_temp.chk('notificacion sola -> revision', pg_temp.cls('Notificación personal Ley 2213','CGP'), 'NOTIFICACION/REVISION_MANUAL');
-- Mixed mandates: never silenced, never auto term
SELECT pg_temp.chk('mixto a: subsanar + traslado futuro', split_part(pg_temp.cls('Auto inadmite la demanda y concede tres días para subsanar. En firme, se correrá traslado de la subsanación.'),'/',2), 'REVISION_MANUAL');
SELECT pg_temp.chk('mixto b: comunicacion con orden concreta', split_part(pg_temp.cls('Comunicacion al correo electronico - SE COMUNICO EL AUTO que inadmite la demanda y concede 10 días para corregir'),'/',2), 'REVISION_MANUAL');
SELECT pg_temp.chk('mixto c: tiene notificado + corre traslado 3 dias', split_part(pg_temp.cls('Auto tiene notificado por conducta concluyente y corre traslado por tres días'),'/',2), 'REVISION_MANUAL');
SELECT pg_temp.chk('mixto d: sentencia + traslado futuro', split_part(pg_temp.cls('Sentencia de primera instancia. Ejecutoriada, se correrá traslado de la liquidación'),'/',2), 'REVISION_MANUAL');

-- Calendar (pure)
SELECT pg_temp.chk('23/09+3', public.add_business_days_sql('2026-09-23',3)::text, '2026-09-28');
SELECT pg_temp.chk('29/09+3', public.add_business_days_sql('2026-09-29',3)::text, '2026-10-02');
SELECT pg_temp.chk('25/09+10', public.add_business_days_sql('2026-09-25',10)::text, '2026-10-09');
-- Anchor: estado vs lista vs contradiction
SELECT pg_temp.chk('estado sin desfij', (SELECT anchor||'/'||vehicle FROM public.resolve_publicacion_anchor('2026-09-23',NULL,'RESPUESTA_REQUERIMIENTO','auto requiere')), '2026-09-23/ESTADO_ART118');
SELECT pg_temp.chk('estado desfij mismo dia no desplaza', (SELECT anchor||'/'||vehicle FROM public.resolve_publicacion_anchor('2026-09-23','2026-09-23','TRASLADO_DEMANDA','corre traslado')), '2026-09-23/ESTADO_ART118');
SELECT pg_temp.chk('estado desfij dia siguiente no desplaza', (SELECT anchor||'/'||vehicle FROM public.resolve_publicacion_anchor('2026-09-23','2026-09-24','SUBSANACION','inadmite')), '2026-09-23/ESTADO_ART118');
SELECT pg_temp.chk('estado desfij lejana -> revision', (SELECT coalesce(anchor::text,'NULL')||'/'||manual_reason FROM public.resolve_publicacion_anchor('2026-09-23','2026-09-30','SUBSANACION','inadmite')), 'NULL/DESFIJACION_INCOMPATIBLE_CON_ESTADO');
SELECT pg_temp.chk('desfij anterior -> revision', (SELECT coalesce(anchor::text,'NULL')||'/'||manual_reason FROM public.resolve_publicacion_anchor('2026-09-23','2026-09-22','SUBSANACION','x')), 'NULL/DESFIJACION_ANTERIOR_A_FIJACION');
SELECT pg_temp.chk('lista art110 explicita', (SELECT anchor||'/'||vehicle FROM public.resolve_publicacion_anchor('2026-09-23',NULL,'TRASLADO_DEMANDA','traslado en lista art. 110')), '2026-09-24/LISTA_ART110');

-- "Con datos": 3 novedades in 2 SAMAI cases, last run empty after an inserting run,
-- several runs per case, separate sources, out-of-window evidence.
SELECT pg_temp.chk('con datos por asunto', (SELECT ok||'/'||empty||'/'||attempted FROM public.grade_source_matters('samai','2031-01-01','2031-01-02',
  ARRAY['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c']::uuid[],
  '[{"work_item_id":"00000000-0000-0000-0000-00000000000a","started_at":"2031-01-01T08:00Z","provider":"SAMAI","status":"success","outcome":"RUN_SUCCESS_EMPTY"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000a","started_at":"2031-01-01T12:00Z","provider":"SAMAI","status":"success","outcome":"RUN_SUCCESS_EMPTY"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000b","started_at":"2031-01-01T08:00Z","provider":"samai","status":"success","outcome":"RUN_SUCCESS_WITH_DATA"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000b","started_at":"2031-01-01T12:00Z","provider":"samai","status":"success","outcome":"RUN_SUCCESS_EMPTY"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000c","started_at":"2031-01-01T12:00Z","provider":"samai","status":"success","outcome":"RUN_SUCCESS_EMPTY"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000c","started_at":"2031-01-01T13:00Z","provider":"cpnu","status":"success","outcome":"RUN_SUCCESS_WITH_DATA"}]'::jsonb,
  '[{"work_item_id":"00000000-0000-0000-0000-00000000000a","source":"samai","created_at":"2031-01-01T08:00Z"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000a","source":"samai","created_at":"2031-01-01T08:00Z"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000b","source":"samai","created_at":"2031-01-01T08:00Z"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000c","source":"cpnu","created_at":"2031-01-01T13:00Z"},
    {"work_item_id":"00000000-0000-0000-0000-00000000000c","source":"samai","created_at":"2030-12-30T08:00Z"}]'::jsonb)),
  '2/1/3');

-- Annulled act with valid despacho dates: no deadline (real act, rolled back)
UPDATE public.work_item_acts SET raw_data = coalesce(raw_data,'{}'::jsonb) || '{"fechaInicial":"2026-09-29","fechaFinal":"2026-10-05"}'
 WHERE id = '15b647a9-9ad2-45ca-9899-05b4097608ab';
SELECT pg_temp.chk('anulada con fechas despacho', coalesce(public.compute_deadline_for_actuacion('15b647a9-9ad2-45ca-9899-05b4097608ab')::text,'NULL'), 'NULL');

-- Idempotency: re-reading the four incident acts/estado creates no PENDING and keeps holds
SELECT public.compute_deadline_for_actuacion(x) FROM unnest(ARRAY['70899e74-1da7-4db8-a018-b93d601c3352','0ea70add-4f34-4c1a-b55d-c286365fb684','b5a57c90-23e4-48da-9e62-9094a909138a','a8220138-5205-44e1-af10-79a44c1ebd76']::uuid[]) x;
SELECT public.compute_deadline_for_publicacion(x) FROM unnest(ARRAY['41fbceb8-01f0-4ffa-b86a-ef8f0ea6361b','cb986cb7-ba2e-4bce-859e-c13aad667cde','ff1655a4-9e21-4294-9de9-bad9e24df576']::uuid[]) x;
SELECT public.recompute_manual_review_deadlines();
SELECT pg_temp.chk('sin PENDING nuevos', (SELECT count(*)::text FROM public.work_item_deadlines WHERE status='PENDING' AND created_at >= now()), '0');
SELECT pg_temp.chk('4 holds intactos', (SELECT count(*)::text FROM public.work_item_deadlines WHERE id IN ('58ed4dd1-50ef-4528-9167-2cda2b294886','0834a576-fd82-48f6-8785-9b0738bef5a7','d36aecee-c530-4216-9603-b3788c803843','658ba77a-cd0b-4cab-aa1c-28eaa0de5270') AND status='REQUIERE_REVISION_MANUAL' AND deadline_date IS NULL AND calculation_meta ? 'audit_hold'), '4');

SELECT (CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS ' ELSE 'FAIL ' END) || name || ' => ' || coalesce(got,'NULL') || (CASE WHEN got IS DISTINCT FROM want THEN ' (want '||want||')' ELSE '' END) FROM _t;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM _t WHERE got IS DISTINCT FROM want) THEN RAISE EXCEPTION 'incident suite: failures'; END IF; END $$;
ROLLBACK;
