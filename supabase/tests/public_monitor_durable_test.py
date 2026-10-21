"""Real PostgreSQL test, disposable local DB on 127.0.0.1:55439, no production."""
import pathlib
import psycopg2
import uuid

root = pathlib.Path(__file__).resolve().parents[2]
conn = psycopg2.connect(host="127.0.0.1", port=55439, dbname="postgres")
cur = conn.cursor()
cur.execute("CREATE ROLE service_role")
cur.execute("CREATE TABLE work_items(id uuid PRIMARY KEY,radicado text,workflow_type text,monitoring_enabled boolean DEFAULT true,deleted_at timestamptz,lifecycle_state text DEFAULT 'ACTIVE')")
old = (root / "supabase/migrations/20260825193301_76dd0e16-892d-46e8-a16c-e26e3387082e.sql").read_text()
cur.execute(old[old.index("CREATE TABLE public.estados_monitor_runs"):old.index("CREATE TABLE public.source_coverage_weekly_baselines")])
cur.execute((root / "supabase/migrations/20261020010000_public_monitor_durable.sql").read_text())
ids = [str(uuid.uuid4()) for _ in range(503)]
cur.executemany("INSERT INTO work_items(id,radicado,workflow_type) VALUES(%s,%s,%s)", [(x,"05001400302320250063800","CGP") for x in ids])
cur.execute("INSERT INTO work_items VALUES(gen_random_uuid(),'05001233300020260142400','CPACA',true,null,'ACTIVE')")
cur.execute("INSERT INTO work_items VALUES(gen_random_uuid(),'invalid','CGP',true,null,'ACTIVE')")
cur.execute("SELECT * FROM start_public_monitor_run('publicaciones',DATE '2026-10-20',ARRAY['CGP'])")
run, acquired, count = cur.fetchone()
assert acquired and count == 503, (acquired,count)
cur.execute("SELECT * FROM start_public_monitor_run('publicaciones',DATE '2026-10-20',ARRAY['CGP'])")
assert cur.fetchall() == [], 'duplicate daily snapshot'

def claim():
    cur.execute("SELECT * FROM claim_public_monitor_items(%s,'publicaciones',1)",(run,))
    return cur.fetchone()

def finish(item, success, retry=True):
    cur.execute("SELECT finish_public_monitor_item(%s,%s,%s,%s,%s,%s,'{}')",(run,item[0],item[2],success,retry,None if success else 'NETWORK_ERROR'))
    return cur.fetchone()[0]

first = claim()
assert first and finish(first,True)
assert not finish(first,True), 'repeated completion must be a no-op'
second = claim()
cur.execute("UPDATE estados_monitor_run_items SET claimed_at=now()-interval '4 minutes' WHERE work_item_id=%s",(second[0],))
reclaimed = claim()
assert reclaimed[0] == second[0] and reclaimed[2] != second[2]
assert not finish(second,True), 'late completion overwrote a renewed lease'
assert finish(reclaimed,False)
cur.execute("UPDATE estados_monitor_run_items SET next_attempt_at=now() WHERE work_item_id=%s",(second[0],))
last_try = claim()
assert last_try[0] == second[0] and finish(last_try,False)
cur.execute("SELECT status,attempts FROM estados_monitor_run_items WHERE work_item_id=%s",(second[0],))
assert cur.fetchone() == ('FAILED',3), 'retry budget not enforced'
cur.execute("UPDATE estados_monitor_runs SET depth_remaining=0,lease_expires_at=now()-interval '1 second' WHERE id=%s",(run,))

cur.execute("SAVEPOINT daily_regression")
cur.execute("SELECT * FROM start_public_monitor_run('publicaciones',DATE '2026-10-21',ARRAY['CGP'])")
assert cur.fetchone()[0] == run
cur.execute("SELECT id FROM estados_monitor_runs WHERE channel='publicaciones' AND run_date=DATE '2026-10-21'")
today=cur.fetchone()[0]
late=str(uuid.uuid4())
cur.execute("INSERT INTO work_items(id,radicado,workflow_type) VALUES(%s,'05001400302320250063800','CGP')",(late,))
cur.execute("UPDATE estados_monitor_runs SET lease_expires_at=now()-interval '1 second' WHERE id=%s",(run,))
cur.execute("SELECT * FROM start_public_monitor_run('publicaciones',DATE '2026-10-22',ARRAY['CGP'])")
assert cur.fetchone()[0] == run
cur.execute("SELECT count(*) FROM estados_monitor_run_items i JOIN estados_monitor_runs r ON r.id=i.run_id WHERE r.run_date=DATE '2026-10-22' AND i.work_item_id=%s",(late,))
assert cur.fetchone()[0] == 1, 'post-snapshot matter lost on next day'
cur.execute("SELECT count(*) FROM estados_monitor_run_items WHERE run_id=%s",(today,))
assert cur.fetchone()[0] == 503
# Drain yesterday, then prove today actually acquires work and completes.
cur.execute("UPDATE estados_monitor_run_items SET status='SUCCESS' WHERE run_id=%s AND status IN ('PENDING','CLAIMED')",(run,))
cur.execute("SELECT * FROM finish_public_monitor_hop(%s,'publicaciones')",(run,)); assert cur.fetchone()[3] == 0
cur.execute("SELECT * FROM start_public_monitor_run('publicaciones',DATE '2026-10-22',ARRAY['CGP'])")
assert cur.fetchone()[0] == today, 'today starved after yesterday finished'
cur.execute("SELECT * FROM claim_public_monitor_items(%s,'publicaciones',1)",(today,));assert cur.fetchone() is not None
cur.execute("UPDATE estados_monitor_run_items SET status='SUCCESS' WHERE run_id=%s",(today,))
cur.execute("SELECT * FROM finish_public_monitor_hop(%s,'publicaciones')",(today,)); assert cur.fetchone()[0] == 'OK'
cur.execute("SELECT * FROM start_public_monitor_run('publicaciones',DATE '2026-10-22',ARRAY['CGP'])")
nextday=cur.fetchone()[0];assert nextday != today and nextday != run
cur.execute("SELECT * FROM claim_public_monitor_items(%s,'publicaciones',1)",(nextday,));assert cur.fetchone() is not None
cur.execute("ROLLBACK TO SAVEPOINT daily_regression")
print('PASS: today seeded during yesterday recovery; yesterday terminates; today starts/completes; post-snapshot matter included next day')
cur.execute("SELECT * FROM start_public_monitor_run('publicaciones',DATE '2026-10-20',ARRAY['CGP'])")
assert cur.fetchone()[0] == run, 'interrupted run was not resumed'
completed = 1
while True:
    item = claim()
    if item is None: break
    assert finish(item,True)
    completed += 1
cur.execute("SELECT * FROM finish_public_monitor_hop(%s,'publicaciones')",(run,))
status, selected, attempted, remaining, depth = cur.fetchone()
assert (status, selected, attempted, remaining) == ('PARTIAL',503,503,0)
assert completed == 502
cur.execute("SELECT count(*) FROM estados_monitor_run_items WHERE run_id=%s",(run,))
assert cur.fetchone()[0] == 503
try:
    cur.execute("SAVEPOINT mismatch")
    cur.execute("SELECT * FROM claim_public_monitor_items(%s,'samai_estados',1)",(run,))
    raise AssertionError('cross-channel claim accepted')
except psycopg2.Error:
    cur.execute("ROLLBACK TO SAVEPOINT mismatch")
# Validate scheduler SQL with local Vault/net/cron stubs: no external HTTP.
cur.execute("CREATE SCHEMA vault; CREATE SCHEMA net; CREATE SCHEMA cron")
cur.execute("CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text)")
cur.execute("INSERT INTO vault.decrypted_secrets VALUES('CRON_SERVICE_KEY','isolated-cron-key'),('SUPABASE_URL','https://example.invalid')")
cur.execute("CREATE TABLE net.requests(id bigserial,url text,headers jsonb,body jsonb)")
cur.execute("CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb) RETURNS bigint LANGUAGE sql AS 'INSERT INTO net.requests(url,headers,body) VALUES($1,$2,$3) RETURNING id'")
cur.execute("CREATE TABLE cron.jobs(id bigserial,name text,schedule text,command text)")
cur.execute("CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS 'INSERT INTO cron.jobs(name,schedule,command) VALUES($1,$2,$3) RETURNING id'")
cur.execute((root / "supabase/migrations/20261020011000_public_monitor_dispatch.sql").read_text())
cur.execute("SELECT dispatch_public_monitors(true)");assert cur.fetchone()[0]==2
cur.execute("SELECT count(*) FROM net.requests WHERE headers->>'x-cron-key'='isolated-cron-key'");assert cur.fetchone()[0]==2
cur.execute("SELECT dispatch_public_monitors(false)");assert cur.fetchone()[0]==0
cur.execute("UPDATE estados_monitor_run_items SET status='PENDING',attempts=0 WHERE work_item_id=%s",(first[0],))
cur.execute("UPDATE estados_monitor_runs SET lease_expires_at=now()-interval '1 second' WHERE id=%s",(run,))
cur.execute("SELECT dispatch_public_monitors(false)");assert cur.fetchone()[0]==1
cur.execute("SAVEPOINT missing_secret")
cur.execute("DELETE FROM vault.decrypted_secrets")
try:
    cur.execute("SELECT dispatch_public_monitors(true)")
    raise AssertionError('missing cron credential was silently accepted')
except psycopg2.Error:
    cur.execute("ROLLBACK TO SAVEPOINT missing_secret")
cur.execute("CREATE ROLE public_monitor_unprivileged")
cur.execute("SELECT has_function_privilege('public_monitor_unprivileged','start_public_monitor_run(text,date,text[])','execute')")
assert not cur.fetchone()[0], 'queue RPC exposed to unauthenticated callers'
conn.rollback()
print('PASS: 503 eligible processes; atomic snapshot; continuation after interruption; fenced leases; 3-attempt cap; repeated completion; no duplicate queue rows; channel isolation; durable cron redispatch; missing-secret failure; private RPC grants')
