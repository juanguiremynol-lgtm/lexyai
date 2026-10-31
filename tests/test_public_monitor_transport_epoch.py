"""One isolated PostgreSQL regression; no provider requests or production data."""
import pathlib
import unittest
import uuid
import psycopg2

SQL = (pathlib.Path(__file__).resolve().parents[1] /
       'coordination/20261031_public_monitor_transport_epoch.sql').read_text()


class TransportEpoch(unittest.TestCase):
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
