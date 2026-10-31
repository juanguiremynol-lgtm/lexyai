"""One isolated PostgreSQL regression; no provider requests or production data."""
import pathlib
import unittest
import uuid
import psycopg2

SQL = (pathlib.Path(__file__).resolve().parents[1] /
       'coordination/20261031_public_monitor_transport_epoch.sql').read_text()


class TransportEpoch(unittest.TestCase):
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
