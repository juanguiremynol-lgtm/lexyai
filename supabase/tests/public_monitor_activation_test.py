"""Disposable local PostgreSQL; all changes rolled back, HTTP and cron stubbed."""
import pathlib,psycopg2,uuid
root=pathlib.Path(__file__).resolve().parents[2];c=psycopg2.connect(host='127.0.0.1',port=55439,user='ejcs1499',dbname='postgres');q=c.cursor()
for role in ['service_role','anon','authenticated']:q.execute('CREATE ROLE '+role)
q.execute("CREATE TABLE work_items(id uuid PRIMARY KEY,radicado text,workflow_type text,monitoring_enabled boolean DEFAULT true,deleted_at timestamptz,lifecycle_state text DEFAULT 'ACTIVE')")
s=(root/'supabase/migrations/20260825193301_76dd0e16-892d-46e8-a16c-e26e3387082e.sql').read_text();q.execute(s[s.index('CREATE TABLE public.estados_monitor_runs'):s.index('CREATE TABLE public.source_coverage_weekly_baselines')]);q.execute((root/'drizzle/migrations/0046_public_monitor_durable.sql').read_text())
q.execute("CREATE SCHEMA vault; CREATE SCHEMA net; CREATE SCHEMA cron; CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text); INSERT INTO vault.decrypted_secrets VALUES('CRON_SERVICE_KEY','test-key'),('SUPABASE_URL','https://example.invalid'); CREATE TABLE net.requests(id bigserial,url text,headers jsonb,body jsonb,timeout_ms integer); CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS 'INSERT INTO net.requests(url,headers,body,timeout_ms) VALUES($1,$2,$3,$4) RETURNING id'; CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true); INSERT INTO cron.job VALUES(64,'andromeda-daily-estados','old','old',false),(91,'publicaciones-monitor','old','old',true),(92,'samai-estados-monitor','old','old',true); CREATE FUNCTION cron.alter_job(job_id bigint,active boolean) RETURNS void LANGUAGE sql AS 'UPDATE cron.job SET active=$2 WHERE jobid=$1'; CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS 'INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) ON CONFLICT(jobname) DO UPDATE SET schedule=$2,command=$3 RETURNING jobid'")
def execute_file(p):q.execute((root/p).read_text().replace('BEGIN;','').replace('COMMIT;',''))
execute_file('coordination/20261020011000_public_monitor_dispatch.sql');q.execute('SELECT dispatch_public_monitors(true)');assert q.fetchone()[0]==2;q.execute('SELECT count(*) FROM public_monitor_dispatch_requests');assert q.fetchone()[0]==2;q.execute('SELECT min(timeout_ms) FROM net.requests');assert q.fetchone()[0]==140000;q.execute('SELECT jobid,active FROM cron.job WHERE jobid IN (64,91,92) ORDER BY jobid');assert q.fetchall()==[(64,True),(91,False),(92,False)]
for wf in ['CGP','CGP','CPACA']:q.execute("INSERT INTO work_items VALUES(gen_random_uuid(),'05001400302320250063800',%s)",(wf,))
for channel,wfs in [('publicaciones',['CGP']),('samai_estados',['CPACA'])]:
 q.execute('SELECT * FROM start_public_monitor_run(%s,current_date,%s)',(channel,wfs));rid=q.fetchone()[0];q.execute("UPDATE estados_monitor_run_items SET status='SUCCESS' WHERE run_id=%s",(rid,));q.execute("UPDATE estados_monitor_runs SET status='OK' WHERE id=%s",(rid,))
# Fixtures use real Bogotá day, not a fabricated run date.
q.execute("UPDATE estados_monitor_runs SET run_date=(now() AT TIME ZONE 'America/Bogota')::date")
q.execute("INSERT INTO work_items VALUES(gen_random_uuid(),'05001400302320250063800','CGP')")
execute_file('coordination/public-monitor-controlled-revalidation.sql');q.execute("SELECT count(*) FROM estados_monitor_run_items WHERE status='PENDING'");assert q.fetchone()[0]==4;q.execute('SELECT count(*) FROM public_monitor_activation_backups');assert q.fetchone()[0]==1
q.execute('SAVEPOINT twice')
try:execute_file('coordination/public-monitor-controlled-revalidation.sql');raise AssertionError('unsafe repeat reset')
except psycopg2.Error:q.execute('ROLLBACK TO SAVEPOINT twice')
q.execute("SELECT has_table_privilege('authenticated','public_monitor_activation_backups','SELECT')");assert not q.fetchone()[0]
q.execute("SELECT dispatch_public_monitors(false)");assert q.fetchone()[0]==2
q.execute("SELECT count(*) FROM net.requests n JOIN estados_monitor_runs r ON r.id::text=n.body->>'run_id' WHERE r.run_date=(now() AT TIME ZONE 'America/Bogota')::date");assert q.fetchone()[0]==2
c.rollback();print('PASS: final activation SQL, 140s HTTP timeout, request receipts,64 replaces91/92, private backup, same-day recovery plus late additions, repeated reset refused; no real HTTP')
