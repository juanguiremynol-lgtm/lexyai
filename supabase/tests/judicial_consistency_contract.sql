-- Actual-schema read-only checks: no users, grants or portfolio fixtures.
BEGIN READ ONLY;
DO $test$ DECLARE d text; n int; BEGIN
 SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint WHERE conrelid='public.work_item_hearings'::regclass AND conname='work_item_hearings_modality_check';
 IF strpos(d,'''presencial''')=0 OR strpos(d,'''virtual''')=0 OR strpos(d,'''mixta''')=0 THEN RAISE EXCEPTION 'hearing modality drift'; END IF;
 SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint WHERE conrelid='public.work_item_tasks'::regclass AND conname='work_item_tasks_priority_check';
 IF strpos(d,'''ALTA''')=0 OR strpos(d,'''MEDIA''')=0 OR strpos(d,'''BAJA''')=0 THEN RAISE EXCEPTION 'task priority drift'; END IF;
 SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint WHERE conrelid='public.work_item_tasks'::regclass AND conname='work_item_tasks_status_check';
 IF strpos(d,'''PENDIENTE''')=0 OR strpos(d,'''COMPLETADA''')=0 THEN RAISE EXCEPTION 'task status drift'; END IF;
 IF has_function_privilege('authenticated','public.mcp_correct_hearing(uuid,jsonb,timestamptz,text,text)','EXECUTE') OR has_function_privilege('authenticated','public.mcp_reclassify_work_item(uuid,text,text,timestamptz,text,text)','EXECUTE') THEN RAISE EXCEPTION 'new RPC gate opened'; END IF;
 IF NOT has_function_privilege('authenticated','public.mcp_update_work_item(uuid,jsonb,boolean,text,text)','EXECUTE') THEN RAISE EXCEPTION 'released update regated'; END IF;
 SELECT count(*) INTO n FROM public.work_item_hearings WHERE work_item_id='e4e761ac-9984-462d-ae6e-a25b244f79ea' AND status='scheduled' AND scheduled_at IN ('2026-11-30T13:30:00Z','2026-12-01T13:30:00Z');
 IF n<>2 THEN RAISE EXCEPTION 'Cardenas session readback'; END IF;
 SELECT count(*) INTO n FROM public.work_item_hearings WHERE work_item_id='e4e761ac-9984-462d-ae6e-a25b244f79ea' AND scheduled_at='2026-08-24T13:30:00Z' AND status='held' AND occurred_at IS NOT NULL;
 IF n<>1 THEN RAISE EXCEPTION 'Cardenas celebration readback'; END IF;
 IF EXISTS(SELECT 1 FROM public.work_item_hearings WHERE work_item_id='e4e761ac-9984-462d-ae6e-a25b244f79ea' GROUP BY scheduled_at HAVING count(*)>1) THEN RAISE EXCEPTION 'Cardenas duplicate'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.work_items WHERE id='f046908c-904e-40c4-9ef0-940d291a50e1' AND authority_email IS NULL AND radicado='05001400300120250154400') THEN RAISE EXCEPTION 'Esfinge readback'; END IF;
 SELECT count(*) INTO n FROM public.work_items WHERE id IN ('7a824800-7df0-4125-b883-43d04e9c92c2','1f90d2e7-2ebc-4d2e-8933-480cdef74ec0','0a208d16-8a98-4b3a-81a4-2f12a668a0ff') AND closure_reason IS NULL AND lifecycle_state='ACTIVE' AND monitoring_enabled;
 IF n<>3 THEN RAISE EXCEPTION 'remision active readback'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.work_items WHERE id='db1b4198-b0ac-453d-98b5-44525f58bf23' AND stage='ADMISION') THEN RAISE EXCEPTION 'manual Nicholls stage changed'; END IF;
END $test$;
SELECT '{"suite":"judicial_consistency_actual_schema_readonly","checks":11,"status":"PASS","mutation_fixtures":false}'::jsonb;
-- Negative role-switch execution requires a separate privileged rollback harness.
-- sandbox_exec cannot SET ROLE authenticated; no role/grant bypass is attempted.
ROLLBACK;