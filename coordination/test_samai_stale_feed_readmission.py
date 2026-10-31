"""Four focused DB regressions; isolated PostgreSQL, no portal or production IO."""
import concurrent.futures
import pathlib
import unittest
import psycopg2

ROOT=pathlib.Path(__file__).resolve().parents[1]
ID='00000000-0000-4000-8000-000000000001'
def connect():
    db=psycopg2.connect(host='127.0.0.1',port=55439,dbname='postgres')
    db.set_client_encoding('UTF8')
    return db

class Recovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db=connect();cls.db.autocommit=True
        with cls.db.cursor() as c:
            for role in ('service_role','anon','authenticated'):
                c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,))
                if not c.fetchone(): c.execute('CREATE ROLE '+role)
            c.execute('''CREATE TABLE IF NOT EXISTS work_items(id uuid,owner_id uuid,organization_id uuid,
              workflow_type text, monitoring_enabled boolean, deleted_at timestamptz,
              lifecycle_state text, radicado text);
              CREATE TABLE IF NOT EXISTS work_item_provider_enrollment(work_item_id uuid,provider_key text,enabled boolean);
              CREATE TABLE IF NOT EXISTS daily_update_cycles(run_date date,work_item_id uuid,owner_id uuid,
                organization_id uuid,channels jsonb DEFAULT '{}',duplicate_requests int DEFAULT 0,
                continuations int DEFAULT 0,last_duplicate jsonb,created_at timestamptz DEFAULT now(),
                updated_at timestamptz DEFAULT now(),PRIMARY KEY(run_date,work_item_id));
              CREATE OR REPLACE FUNCTION bogota_next_midnight(d date) RETURNS timestamptz LANGUAGE sql
                AS $$ SELECT ((d+1)::timestamp AT TIME ZONE 'America/Bogota') $$;''')
            core=(ROOT/'drizzle/migrations/0096_daily_gate_job_bound_continuation.sql').read_text()
            c.execute(core[:core.index('-- Age-based continuations')])
            original=(ROOT/'drizzle/migrations/0093_daily_update_admission.sql').read_text()
            finish=original[original.index('CREATE FUNCTION public.finish_daily_update'):]
            c.execute(finish[:finish.index('REVOKE ALL')].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1))
            c.execute((ROOT/'coordination/20261031_samai_stale_feed_readmission.sql').read_text())

    def setUp(self):
        with self.db.cursor() as c:
            c.execute('TRUNCATE daily_update_cycles,work_items,work_item_provider_enrollment')
            c.execute("INSERT INTO work_items VALUES (%s,%s,%s,'CPACA',true,NULL,'ACTIVE','05001233300020240115300')",(ID,ID,ID))
            c.execute("INSERT INTO work_item_provider_enrollment VALUES(%s,'samai',true)",(ID,))
            c.execute("SELECT admit_daily_update(%s,'acts')",(ID,));self.old=c.fetchone()[0]['token']
            c.execute("UPDATE daily_update_cycles SET channels=jsonb_set(channels,'{acts}',channels->'acts'||jsonb_build_object('status','FAILED','error_code','SAMAI_SOURCE_OBSERVATION_STALE','started_at',now()-interval '4 hours'))")

    def admit(self):
        with connect() as db, db.cursor() as c:
            c.execute("SELECT admit_daily_update(%s,'acts')",(ID,));return c.fetchone()[0]

    def test_concurrent_recovery_once_and_old_finish_rejected(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            results=list(pool.map(lambda _:self.admit(),range(5)))
        accepted=[r for r in results if r['admitted']]
        self.assertEqual(len(accepted),1)
        with self.db.cursor() as c:
            c.execute("SELECT finish_daily_update((now() AT TIME ZONE 'America/Bogota')::date,%s,'acts',%s,'DONE')",(ID,self.old))
            self.assertFalse(c.fetchone()[0])
            c.execute("SELECT channels->'acts' FROM daily_update_cycles");a=c.fetchone()[0]
        self.assertEqual(a['previous_attempt']['error_code'],'SAMAI_SOURCE_OBSERVATION_STALE')
        self.assertNotIn('token',a['previous_attempt'])
        self.assertEqual(a['token'],accepted[0]['token'])

    def test_other_failure_and_disabled_source_are_not_reopened(self):
        with self.db.cursor() as c:c.execute("UPDATE daily_update_cycles SET channels=jsonb_set(channels,'{acts,error_code}','\"PERSISTENCE_FAILED\"')")
        self.assertFalse(self.admit()['admitted'])
        with self.db.cursor() as c:
            c.execute("UPDATE daily_update_cycles SET channels=jsonb_set(channels,'{acts,error_code}','\"SAMAI_SOURCE_OBSERVATION_STALE\"')")
            c.execute('UPDATE work_item_provider_enrollment SET enabled=false')
        self.assertFalse(self.admit()['admitted'])

    def test_repeated_stale_failure_remains_pending_without_another_recovery(self):
        self.assertTrue(self.admit()['admitted'])
        with self.db.cursor() as c:c.execute("UPDATE daily_update_cycles SET channels=jsonb_set(channels,'{acts,status}','\"FAILED\"')")
        self.assertFalse(self.admit()['admitted'])

    def test_backoff_and_privileges(self):
        with self.db.cursor() as c:
            c.execute("UPDATE daily_update_cycles SET channels=jsonb_set(channels,'{acts,started_at}',to_jsonb(now()::text))")
            c.execute("SELECT has_function_privilege('authenticated','admit_daily_update(uuid,text,text,text,text,boolean)','EXECUTE')")
            self.assertFalse(c.fetchone()[0])
        a=self.admit();self.assertFalse(a['admitted']);self.assertIn('next_eligible_at',a)

if __name__=='__main__': unittest.main()
