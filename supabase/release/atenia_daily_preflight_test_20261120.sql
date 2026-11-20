BEGIN;
CREATE TEMP TABLE pf_receipts(organization_id uuid,trigger text,finished_at timestamptz,started_at timestamptz);
CREATE TEMP TABLE pf_state(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
DO $test$ DECLARE def text := pg_get_functiondef('public.claim_atenia_daily_preflight()'::regprocedure); BEGIN
  def := replace(replace(replace(def, 'public.claim_atenia_daily_preflight()', 'pg_temp.pf_claim()'),'public.cron_state','pg_temp.pf_state'),'public.atenia_preflight_checks','pg_temp.pf_receipts'); EXECUTE def;
END $test$;
DO $$ BEGIN
IF pg_temp.pf_claim() <> 'RUN' THEN RAISE EXCEPTION 'first mismatch'; END IF;
IF pg_temp.pf_claim() <> 'DEFERRED' THEN RAISE EXCEPTION 'held mismatch'; END IF;
UPDATE pg_temp.pf_state SET value=jsonb_set(value,'{next_try_at}',to_jsonb(now()-interval '1 minute')) WHERE key='atenia:platform:daily_preflight';
IF pg_temp.pf_claim() <> 'RUN' THEN RAISE EXCEPTION 'recovery mismatch'; END IF;
UPDATE pg_temp.pf_state SET value=jsonb_set(value,'{next_try_at}',to_jsonb(now()-interval '1 minute')) WHERE key='atenia:platform:daily_preflight';
IF pg_temp.pf_claim() <> 'DEFERRED' THEN RAISE EXCEPTION 'attempt cap mismatch'; END IF;
INSERT INTO pg_temp.pf_receipts VALUES(NULL,'PRE_DAILY_SYNC',statement_timestamp(),statement_timestamp());
IF pg_temp.pf_claim() <> 'CACHED' THEN RAISE EXCEPTION 'cache mismatch'; END IF;
END $$;
ROLLBACK;
