-- ONLY an empty isolated PostgreSQL cluster; never run against a deployed database.
\set ON_ERROR_STOP on
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE TABLE public.sync_retry_queue (id uuid PRIMARY KEY, work_item_id uuid,kind text,attempt int,max_attempts int,lease_token uuid,claimed_at timestamptz,next_run_at timestamptz,last_error_code text,last_error_message text);
CREATE TABLE public.sync_retry_outcomes (task_id uuid PRIMARY KEY,work_item_id uuid,kind text,attempt int,outcome text,error_code text,result jsonb);
\i supabase/migrations/20261028040000_retry_pp_durable_deferral.sql
INSERT INTO sync_retry_queue VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','PUB_RETRY',1,4,'00000000-0000-4000-8000-000000000003',now(),now(),NULL,NULL);
DO $$ DECLARE v jsonb; ok boolean; q sync_retry_queue%ROWTYPE;
BEGIN
 v:=jsonb_build_object('response',jsonb_build_object('pending_upstream',true,'backend_trace',jsonb_build_object('backend_run_id','21e9c43b-f2fd-4bb3-9247-01169937cad8','estado','EN_CURSO','backend_admitted_at',(now()-interval '1 hour')::text)));
 ok:=finish_sync_retry('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','DEFERRED','PP_RUN_PENDING',v,1800);
 SELECT * INTO q FROM sync_retry_queue WHERE id='00000000-0000-4000-8000-000000000001';
 IF NOT ok OR q.attempt<>1 OR q.lease_token IS NOT NULL OR q.last_error_code<>'PP_RUN_PENDING' OR q.next_run_at<now()+interval '29 minutes' THEN RAISE EXCEPTION 'deferral failed'; END IF;
 ok:=finish_sync_retry(q.id,'00000000-0000-4000-8000-000000000003','SUCCESS',NULL,'{}',0);
 IF ok THEN RAISE EXCEPTION 'late worker accepted'; END IF;
 UPDATE sync_retry_queue SET lease_token='00000000-0000-4000-8000-000000000003' WHERE id=q.id;
 v:=jsonb_set(v,'{response,backend_trace,backend_admitted_at}',to_jsonb((now()-interval '25 hours')::text));
 BEGIN
  PERFORM finish_sync_retry(q.id,'00000000-0000-4000-8000-000000000003','DEFERRED','PP_RUN_PENDING',v,1800);
  RAISE EXCEPTION 'expired deferral accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='expired deferral accepted' THEN RAISE; END IF; END;
 IF has_function_privilege('anon','public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer)','EXECUTE') OR has_function_privilege('authenticated','public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer)','EXECUTE') OR NOT has_function_privilege('service_role','public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer)','EXECUTE') THEN RAISE EXCEPTION 'bad function privileges'; END IF;
END $$;
