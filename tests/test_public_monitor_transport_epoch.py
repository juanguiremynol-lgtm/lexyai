"""One isolated PostgreSQL regression; no provider requests or production data."""
import pathlib
import unittest
import uuid
import psycopg2

SQL = (pathlib.Path(__file__).resolve().parents[1] /
       'coordination/20261031_public_monitor_transport_epoch.sql').read_text()


class TransportEpoch(unittest.TestCase):
    def test_resume_budget_and_oldest_due_prevent_starvation(self):
        admin = psycopg2.connect(host='127.0.0.1',port=55439,dbname='postgres',user='ejcs1499');admin.autocommit=True
        name='test_resume_'+uuid.uuid4().hex[:10]
        with admin.cursor() as c:c.execute('CREATE DATABASE '+name)
        conn=None
        try:
            conn=psycopg2.connect(host='127.0.0.1',port=55439,dbname=name,user='ejcs1499');conn.autocommit=True
            with conn.cursor() as c:
                c.execute('''DO $r$ BEGIN
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
                  END $r$;
                  CREATE TABLE estados_monitor_runs(id uuid PRIMARY KEY,channel text,run_date date,status text,
                    lease_expires_at timestamptz,depth_remaining int,finished_at timestamptz);
                  CREATE TABLE estados_monitor_run_items(run_id uuid,work_item_id uuid,ordinal int,status text,
                    attempts int,claimed_at timestamptz,lease_token uuid,next_attempt_at timestamptz,finished_at timestamptz,error_code text);
                  CREATE TABLE public_monitor_dispatch_requests(request_id bigint PRIMARY KEY,channel text,start_new boolean);
                  CREATE SCHEMA vault;
                  CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
                  INSERT INTO vault.decrypted_secrets VALUES('CRON_SERVICE_KEY','isolated-test-only'),('SUPABASE_URL','https://example.invalid');
                  CREATE SCHEMA net;CREATE SEQUENCE net.test_request;
                  CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) RETURNS bigint
                    LANGUAGE sql AS $net$ SELECT nextval('net.test_request') $net$;''')
                root=pathlib.Path(__file__).resolve().parents[1]
                base=(root/'drizzle/migrations/0046_public_monitor_durable.sql').read_text()
                start=base.index('CREATE FUNCTION public.claim_public_monitor_items(')
                c.execute(base[start:base.index('$$;',start)+3])
                c.execute((root/'coordination/public-monitor-dispatch-current-first.sql').read_text())
                c.execute((root/'coordination/20261031_monitor_resume_fairness.sql').read_text())
                run,a,b=str(uuid.uuid4()),str(uuid.uuid4()),str(uuid.uuid4())
                c.execute("INSERT INTO estados_monitor_runs VALUES(%s,'publicaciones',(now() AT TIME ZONE 'America/Bogota')::date,'PARTIAL',now()-interval '1 second',0,NULL)",(run,))
                c.execute("INSERT INTO estados_monitor_run_items(run_id,work_item_id,ordinal,status,attempts,next_attempt_at) VALUES(%s,%s,1,'PENDING',0,now()-interval '1 minute'),(%s,%s,2,'PENDING',0,now()-interval '2 hours')",(run,a,run,b))
                c.execute("SELECT work_item_id FROM claim_public_monitor_items(%s,'publicaciones',1)",(run,));self.assertEqual(str(c.fetchone()[0]),b)
                c.execute("SELECT work_item_id FROM claim_public_monitor_items(%s,'publicaciones',1)",(run,));self.assertEqual(str(c.fetchone()[0]),a)
                c.execute("UPDATE estados_monitor_run_items SET status='PENDING',lease_token=NULL,next_attempt_at=now()+interval '10 minutes'")
                c.execute('SELECT dispatch_public_monitors(false)');self.assertEqual(c.fetchone()[0],0)
                c.execute('SELECT count(*) FROM public_monitor_dispatch_requests');self.assertEqual(c.fetchone()[0],0)
                c.execute("UPDATE estados_monitor_run_items SET next_attempt_at=now()-interval '1 second' WHERE work_item_id=%s",(b,))
                c.execute('SELECT dispatch_public_monitors(false)');self.assertEqual(c.fetchone()[0],1)
                c.execute('SELECT depth_remaining,lease_expires_at>now() FROM estados_monitor_runs');self.assertEqual(c.fetchone(),(60,True))
                c.execute('SELECT dispatch_public_monitors(false)');self.assertEqual(c.fetchone()[0],0)
                c.execute('SELECT count(*) FROM public_monitor_dispatch_requests');self.assertEqual(c.fetchone()[0],1)
        finally:
            if conn:conn.close()
            with admin.cursor() as c:c.execute('DROP DATABASE '+name)
            admin.close()

    def test_deferred_read_is_neutral_and_fenced(self):
        admin = psycopg2.connect(host='127.0.0.1', port=55439, dbname='postgres', user='ejcs1499')
        admin.autocommit = True
        name = 'test_monitor_defer_' + uuid.uuid4().hex[:10]
        with admin.cursor() as c:
            c.execute('CREATE DATABASE ' + name)
        conn = None
        try:
            conn = psycopg2.connect(host='127.0.0.1', port=55439, dbname=name, user='ejcs1499')
            conn.autocommit = True
            with conn.cursor() as c:
                c.execute('''CREATE SCHEMA auth;
                    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS
                    $role$ SELECT current_setting('request.jwt.claim.role',true) $role$;
                    DO $roles$ BEGIN
                      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
                      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
                      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
                    END $roles$;
                    CREATE TABLE estados_monitor_runs(id uuid PRIMARY KEY,status text,lease_expires_at timestamptz);
                    CREATE TABLE estados_monitor_run_items(run_id uuid,work_item_id uuid,status text,attempts int,
                      claimed_at timestamptz,lease_token uuid,finished_at timestamptz,next_attempt_at timestamptz,error_code text,result jsonb);
                    -- A resumed run starts with an expired parent lease; its
                    -- freshly minted item token still authorizes this item.
                    INSERT INTO estados_monitor_runs VALUES('00000000-0000-0000-0000-000000000001','PARTIAL',now()-interval '1 minute');
                    INSERT INTO estados_monitor_run_items VALUES('00000000-0000-0000-0000-000000000001',
                      '00000000-0000-0000-0000-000000000002','CLAIMED',3,now(),
                      '00000000-0000-0000-0000-000000000003',NULL,NULL,NULL,NULL);''')
                c.execute((pathlib.Path(__file__).resolve().parents[1] /
                    'coordination/20261031_public_monitor_deferred_reads.sql').read_text())
                call = '''SELECT defer_public_monitor_read('00000000-0000-0000-0000-000000000001',
                  '00000000-0000-0000-0000-000000000002',%s,now()+interval '10 minutes',
                  '{"result_code":"DAILY_UPDATE_ALREADY_STARTED","deduplicated":true,"daily_update":{"admitted":false}}')'''
                token = '00000000-0000-0000-0000-000000000003'
                with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                    c.execute(call,(token,))
                c.execute("SET request.jwt.claim.role='service_role'")
                c.execute(call,('00000000-0000-0000-0000-000000000004',))
                self.assertFalse(c.fetchone()[0])
                c.execute(call,(token,))
                self.assertTrue(c.fetchone()[0])
                c.execute("SELECT status,attempts,lease_token,claimed_at,result->>'monitor_deferred_without_read',next_attempt_at>now()+interval '9 minutes' FROM estados_monitor_run_items")
                self.assertEqual(c.fetchone(),('PENDING',2,None,None,'true',True))
                c.execute(call,(token,))
                self.assertFalse(c.fetchone()[0])
                c.execute('SELECT attempts FROM estados_monitor_run_items')
                self.assertEqual(c.fetchone()[0],2)
                c.execute('''ALTER TABLE estados_monitor_runs
                    ADD COLUMN run_date date DEFAULT '2026-10-31',
                    ADD COLUMN depth_remaining int DEFAULT 0,
                    ADD COLUMN finished_at timestamptz,
                    ADD COLUMN attempted_count int DEFAULT 0,
                    ADD COLUMN failed_count int DEFAULT 0;
                    INSERT INTO estados_monitor_runs(id,status,lease_expires_at,attempted_count,failed_count)
                    VALUES('0b335105-c300-4c18-83e2-47c1721e6ff2','PARTIAL',now(),2,2),
                          ('68f2c917-02ca-4bcd-931c-b912f88f4891','PARTIAL',now(),1,1);
                    INSERT INTO estados_monitor_run_items(run_id,work_item_id,status,attempts,error_code,result)
                    SELECT r,gen_random_uuid(),'FAILED',a,'DAILY_UPDATE_ALREADY_STARTED',
                      jsonb_build_object('deduplicated',true,'daily_update',jsonb_build_object('admitted',false,'next_eligible_at',now()+interval '10 minutes'))
                    FROM (VALUES('0b335105-c300-4c18-83e2-47c1721e6ff2'::uuid,3),
                                ('68f2c917-02ca-4bcd-931c-b912f88f4891'::uuid,1)) g(r,a);
                    INSERT INTO estados_monitor_run_items(run_id,work_item_id,status,attempts,error_code,result)
                    VALUES('0b335105-c300-4c18-83e2-47c1721e6ff2',gen_random_uuid(),'FAILED',2,'PROVIDER_UNAVAILABLE','{}');''')
                recovery = (pathlib.Path(__file__).resolve().parents[1] /
                    'coordination/20261031_recover_monitor_gate_failures.sql').read_text()
                c.execute(recovery)
                c.execute('SELECT count(*) FROM monitor_gate_item_backup_20261031')
                self.assertEqual(c.fetchone()[0],2)
                c.execute("SELECT attempts FROM estados_monitor_run_items WHERE error_code='DAILY_UPDATE_ALREADY_STARTED' ORDER BY attempts")
                self.assertEqual(c.fetchall(),[(1,),(2,),(2,)]) # fixture already deferred above plus two recovered
                c.execute("SELECT status,attempts FROM estados_monitor_run_items WHERE error_code='PROVIDER_UNAVAILABLE'")
                self.assertEqual(c.fetchone(),('FAILED',2))
                c.execute('SELECT to_jsonb(i) FROM estados_monitor_run_items i ORDER BY run_id,work_item_id')
                rows_before_repeat = c.fetchall()
                c.execute('SELECT to_jsonb(r) FROM estados_monitor_runs r ORDER BY id')
                runs_before_repeat = c.fetchall()
                c.execute(recovery)
                c.execute('SELECT to_jsonb(i) FROM estados_monitor_run_items i ORDER BY run_id,work_item_id')
                self.assertEqual(c.fetchall(),rows_before_repeat)
                c.execute('''CREATE FUNCTION start_public_monitor_run(text,date,text[]) RETURNS void LANGUAGE plpgsql AS $p$ BEGIN RETURN; END $p$;
                  CREATE FUNCTION claim_public_monitor_items(uuid,text,integer) RETURNS void LANGUAGE plpgsql AS $p$ BEGIN RETURN; END $p$;
                  CREATE FUNCTION finish_public_monitor_hop(uuid,text) RETURNS void LANGUAGE plpgsql AS $p$ BEGIN RETURN; END $p$;
                  CREATE FUNCTION dispatch_public_monitors(boolean) RETURNS void LANGUAGE plpgsql AS $p$ BEGIN RETURN; END $p$;
                  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon,authenticated;''')
                permission_sql = (pathlib.Path(__file__).resolve().parents[1] /
                    'coordination/20261031_monitor_rpc_service_permissions.sql').read_text()
                c.execute(permission_sql)
                c.execute(permission_sql)
                c.execute("""SELECT count(*) FROM pg_proc p WHERE p.proname IN
                    ('start_public_monitor_run','claim_public_monitor_items','finish_public_monitor_hop','dispatch_public_monitors')
                    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
                    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
                    AND has_function_privilege('service_role',p.oid,'EXECUTE')
                    AND has_function_privilege(current_user,p.oid,'EXECUTE')""")
                self.assertEqual(c.fetchone()[0],4)
                c.execute('SELECT to_jsonb(r) FROM estados_monitor_runs r ORDER BY id')
                self.assertEqual(c.fetchall(),runs_before_repeat)
                base = (pathlib.Path(__file__).resolve().parents[1] /
                    'drizzle/migrations/0046_public_monitor_durable.sql').read_text()
                start = base.index('CREATE FUNCTION public.finish_public_monitor_item(')
                c.execute(base[start:base.index('$$;',start)+3])
                c.execute((pathlib.Path(__file__).resolve().parents[1] /
                    'coordination/20261031_public_monitor_accepted_wait.sql').read_text())
                case, lease = str(uuid.uuid4()),str(uuid.uuid4())
                c.execute("INSERT INTO estados_monitor_run_items(run_id,work_item_id,status,attempts,claimed_at,lease_token) VALUES('0b335105-c300-4c18-83e2-47c1721e6ff2',%s,'CLAIMED',3,now(),%s)",(case,lease))
                finish = '''SELECT finish_public_monitor_item('0b335105-c300-4c18-83e2-47c1721e6ff2',%s,%s,false,true,'PENDING_UPSTREAM',%s::jsonb)'''
                payload = '{"result_code":"PENDING_UPSTREAM","pending_upstream":true,"backend_trace":{"backend_run_id":"61dc6b8c-be89-4410-9d6a-171e033fe286","estado":"ADMITIDA","run_status_http":200,"followup_expired_needs_intervention":false}}'
                c.execute("SET request.jwt.claim.role='anon'")
                with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                    c.execute(finish,(case,lease,payload))
                c.execute("SET request.jwt.claim.role='service_role'")
                c.execute(finish,(case,lease,payload));self.assertTrue(c.fetchone()[0])
                c.execute("SELECT status,attempts,next_attempt_at>now()+interval '9 minutes',result->>'monitor_deferred_without_read' FROM estados_monitor_run_items WHERE work_item_id=%s",(case,))
                self.assertEqual(c.fetchone(),('PENDING',2,True,'true'))
                c.execute(finish,(case,lease,payload));self.assertFalse(c.fetchone()[0])
                # An unproven pending response retains the bounded error policy.
                other = str(uuid.uuid4())
                c.execute("INSERT INTO estados_monitor_run_items(run_id,work_item_id,status,attempts,claimed_at,lease_token) VALUES('0b335105-c300-4c18-83e2-47c1721e6ff2',%s,'CLAIMED',3,now(),%s)",(other,lease))
                c.execute(finish,(other,lease,'{"result_code":"PENDING_UPSTREAM"}'))
                self.assertTrue(c.fetchone()[0])
                c.execute('SELECT status,attempts FROM estados_monitor_run_items WHERE work_item_id=%s',(other,))
                self.assertEqual(c.fetchone(),('FAILED',3))
                positive = str(uuid.uuid4())
                c.execute("INSERT INTO estados_monitor_run_items(run_id,work_item_id,status,attempts,claimed_at,lease_token) VALUES('0b335105-c300-4c18-83e2-47c1721e6ff2',%s,'CLAIMED',1,now(),%s)",(positive,lease))
                c.execute("SELECT finish_public_monitor_item('0b335105-c300-4c18-83e2-47c1721e6ff2',%s,%s,true,false,NULL,'{\"result_code\":\"SUCCESS_EMPTY\",\"ok\":true}')",(positive,lease))
                self.assertTrue(c.fetchone()[0])
                c.execute('SELECT status FROM estados_monitor_run_items WHERE work_item_id=%s',(positive,))
                self.assertEqual(c.fetchone()[0],'SUCCESS')
                stale = str(uuid.uuid4())
                c.execute("INSERT INTO estados_monitor_run_items(run_id,work_item_id,status,attempts,claimed_at,lease_token) VALUES('0b335105-c300-4c18-83e2-47c1721e6ff2',%s,'CLAIMED',3,now()-interval '4 minutes',%s)",(stale,lease))
                c.execute(finish,(stale,lease,payload));self.assertFalse(c.fetchone()[0])
                c.execute("UPDATE estados_monitor_run_items SET status='FAILED',error_code='EXPIRED_TEST' WHERE work_item_id=%s",(stale,))
                waiting = str(uuid.uuid4())
                c.execute("INSERT INTO estados_monitor_run_items(run_id,work_item_id,status,attempts,error_code,result) VALUES('0b335105-c300-4c18-83e2-47c1721e6ff2',%s,'FAILED',3,'PENDING_UPSTREAM',%s::jsonb)",(waiting,payload))
                recovery_wait = (pathlib.Path(__file__).resolve().parents[1] /
                    'coordination/20261031_recover_accepted_monitor_waits.sql').read_text()
                c.execute(recovery_wait)
                c.execute('SELECT count(*) FROM monitor_wait_item_backup_20261031')
                self.assertEqual(c.fetchone()[0],1)
                c.execute('SELECT status,attempts FROM estados_monitor_run_items WHERE work_item_id=%s',(waiting,))
                self.assertEqual(c.fetchone(),('PENDING',2))
                c.execute('SELECT status,attempts FROM estados_monitor_run_items WHERE work_item_id=%s',(other,))
                self.assertEqual(c.fetchone(),('FAILED',3))
                c.execute('SELECT to_jsonb(i) FROM estados_monitor_run_items i ORDER BY run_id,work_item_id')
                rows_before_repeat = c.fetchall()
                c.execute(recovery_wait)
                c.execute('SELECT to_jsonb(i) FROM estados_monitor_run_items i ORDER BY run_id,work_item_id')
                self.assertEqual(c.fetchall(),rows_before_repeat)
        finally:
            if conn:
                conn.close()
            with admin.cursor() as c:
                c.execute('DROP DATABASE ' + name)
            admin.close()

    def test_restart_collision_preserves_receipts_and_security(self):
        admin = psycopg2.connect(host='127.0.0.1', port=55439,
                                dbname='postgres', user='ejcs1499')
        admin.autocommit = True
        name = 'test_dispatch_epoch_' + uuid.uuid4().hex[:10]
        with admin.cursor() as cur:
            cur.execute('CREATE DATABASE ' + name)
        conn = None
        try:
            conn = psycopg2.connect(host='127.0.0.1', port=55439,
                                    dbname=name, user='ejcs1499')
            conn.autocommit = True
            with conn.cursor() as c:
                c.execute('''CREATE TABLE public_monitor_dispatch_requests(
                    request_id bigint PRIMARY KEY,channel text NOT NULL,
                    start_new boolean NOT NULL,requested_at timestamptz DEFAULT now());
                    ALTER TABLE public_monitor_dispatch_requests ENABLE ROW LEVEL SECURITY;
                    REVOKE ALL ON public_monitor_dispatch_requests FROM PUBLIC;
                    INSERT INTO public_monitor_dispatch_requests(request_id,channel,start_new)
                    VALUES(359,'publicaciones',true),(853,'samai_estados',false)''')
                c.execute('SELECT * FROM public_monitor_dispatch_requests ORDER BY request_id')
                old = c.fetchall()
                c.execute("SELECT relacl,relrowsecurity FROM pg_class WHERE oid='public_monitor_dispatch_requests'::regclass")
                security = c.fetchone()
                c.execute(SQL)
                c.execute('SELECT request_id,channel,start_new,requested_at FROM public_monitor_dispatch_requests ORDER BY request_id')
                self.assertEqual(c.fetchall(), old)
                c.execute('SELECT count(*) FROM public_monitor_dispatch_requests WHERE transport_epoch IS NULL')
                self.assertEqual(c.fetchone()[0], 2)
                c.execute("INSERT INTO public_monitor_dispatch_requests(request_id,channel,start_new) VALUES(853,'publicaciones',true)")
                with self.assertRaises(psycopg2.errors.UniqueViolation):
                    c.execute("INSERT INTO public_monitor_dispatch_requests(request_id,channel,start_new) VALUES(853,'publicaciones',true)")
                c.execute("INSERT INTO public_monitor_dispatch_requests(request_id,channel,start_new,transport_epoch) VALUES(853,'samai_estados',true,pg_postmaster_start_time()+interval '1 second')")
                c.execute('SELECT dispatch_id,transport_epoch FROM public_monitor_dispatch_requests ORDER BY dispatch_id')
                before_repeat = c.fetchall()
                c.execute(SQL)
                c.execute('SELECT dispatch_id,transport_epoch FROM public_monitor_dispatch_requests ORDER BY dispatch_id')
                self.assertEqual(c.fetchall(), before_repeat)
                c.execute("SELECT relacl,relrowsecurity FROM pg_class WHERE oid='public_monitor_dispatch_requests'::regclass")
                self.assertEqual(c.fetchone(), security)
                c.execute('SELECT count(*) FROM public_monitor_dispatch_requests WHERE request_id=853 AND transport_epoch=pg_postmaster_start_time()')
                self.assertEqual(c.fetchone()[0], 1)
        finally:
            if conn:
                conn.close()
            with admin.cursor() as c:
                c.execute('DROP DATABASE ' + name)
            admin.close()


if __name__ == '__main__':
    unittest.main()
