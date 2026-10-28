\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
CREATE TABLE public.atenia_ai_remediation_queue (
 id integer primary key, action_type text, status text, run_after timestamptz,
 attempts integer, max_attempts integer, priority integer, created_at timestamptz, updated_at timestamptz
);
\ir ../supabase/migrations/20261028020000_atenia_supported_queue_claim.sql
INSERT INTO public.atenia_ai_remediation_queue VALUES
 (1,'INCIDENT_AUTO_REMEDIATION','PENDING',now(),0,3,100,now(),now()),
 (2,'RETRY_ACTS','PENDING',now(),0,3,50,now(),now()),
 (3,'RETRY_PUBS','PENDING',now(),1,3,40,now(),now()),
 (4,'RETRY_ACTS','SKIPPED',now(),1,3,100,now(),now()),
 (5,'RETRY_ACTS','PENDING',now(),3,3,100,now(),now());
SET test.role='service_role';
CREATE TEMP TABLE claimed AS SELECT id FROM public.atenia_ai_claim_supported_queue(5);
DO $$ BEGIN
 IF (SELECT array_agg(id ORDER BY id) FROM claimed) <> ARRAY[2,3] THEN RAISE EXCEPTION 'wrong candidates'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.atenia_ai_remediation_queue WHERE id=1 AND status='PENDING' AND attempts=0) THEN RAISE EXCEPTION 'unsupported task modified'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.atenia_ai_remediation_queue WHERE id=4 AND status='SKIPPED' AND attempts=1) THEN RAISE EXCEPTION 'skipped task modified'; END IF;
 IF (SELECT count(*) FROM public.atenia_ai_claim_supported_queue(5)) <> 0 THEN RAISE EXCEPTION 'duplicate claim'; END IF;
END $$;
INSERT INTO public.atenia_ai_remediation_queue VALUES
 (6,'RETRY_ACTS','PENDING',now(),0,3,50,now()-interval '1 minute',now()),
 (7,'RETRY_PUBS','PENDING',now(),0,3,40,now()-interval '1 minute',now()),
 (8,'RETRY_PUBS','PENDING',now(),0,3,40,now()-interval '11 hours',now());
DO $$ DECLARE selected integer; BEGIN
 SELECT id INTO selected FROM public.atenia_ai_preview_supported_queue(1);
 IF selected <> 8 OR NOT EXISTS(SELECT 1 FROM public.atenia_ai_remediation_queue WHERE id=8 AND status='PENDING' AND attempts=0)
 THEN RAISE EXCEPTION 'preview order mismatch or preview mutated task: %',selected; END IF;
 SELECT id INTO selected FROM public.atenia_ai_claim_supported_queue(1);
 IF selected <> 8 THEN RAISE EXCEPTION 'aged publication did not outrank new acts: %', selected; END IF;
 SELECT id INTO selected FROM public.atenia_ai_claim_supported_queue(1);
 IF selected <> 6 THEN RAISE EXCEPTION 'recent initial priorities were not respected: %', selected; END IF;
 SELECT id INTO selected FROM public.atenia_ai_claim_supported_queue(1);
 IF selected <> 7 THEN RAISE EXCEPTION 'remaining publication not selected: %', selected; END IF;
END $$;
SET test.role='authenticated';
DO $$ BEGIN
 BEGIN PERFORM public.atenia_ai_claim_supported_queue(5); RAISE EXCEPTION 'expected authorization failure';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.atenia_ai_preview_supported_queue(5); RAISE EXCEPTION 'expected preview authorization failure';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
