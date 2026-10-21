"""Isolated PostgreSQL only. Never uses production PG environment bindings."""
import concurrent.futures
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CMD = ['psql', '-h', '127.0.0.1', '-p', '54329', '-U', 'lovable', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt']

def sql(text):
    return subprocess.run(CMD, input=text, text=True, capture_output=True, check=True, env={**os.environ, 'PGSSLMODE': 'disable'}).stdout.strip()

sql("""
CREATE ROLE service_role; CREATE ROLE authenticated; CREATE ROLE anon;
CREATE TABLE public.work_items(id uuid primary key, organization_id uuid, deleted_at timestamptz, monitoring_enabled boolean, workflow_type text,stage text,last_stage_change_source text,last_stage_change_by_user_id uuid,stage_inference_enabled boolean);
CREATE TABLE public.auto_sync_daily_ledger(id uuid primary key default gen_random_uuid(),organization_id uuid,run_date date,scheduled_for timestamptz,status text,run_id text,is_continuation boolean,items_failed int default 0,items_skipped int default 0,items_succeeded int default 0,items_targeted int default 0,metadata jsonb default '{}',last_heartbeat_at timestamptz,started_at timestamptz,completed_at timestamptz,finished_at timestamptz,retry_count int default 0,updated_at timestamptz,unique(organization_id,run_date));
CREATE TABLE public.work_item_acts(id uuid primary key,work_item_id uuid,act_date date,description text,is_archived boolean);
CREATE TABLE public.work_item_publicaciones(id uuid primary key,work_item_id uuid,fecha_providencia timestamptz,fecha_fijacion timestamptz,raw_data jsonb,annotation text,title text,is_archived boolean);
""")
for prefix in ['0055_', '0056_', '0057_', '0058_']:
    sql(next((ROOT / 'drizzle/migrations').glob(prefix + '*.sql')).read_text())

WI = '11111111-1111-1111-1111-111111111111'
ORG = '22222222-2222-2222-2222-222222222222'
sql(f"INSERT INTO work_items VALUES('{WI}','{ORG}',null,true,'CGP','RADICADO',null,null,true)")
claim_sql = f"SELECT claim_daily_source_attempt('{WI}','cpnu');"
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    claims = list(executor.map(lambda _: json.loads(sql(claim_sql)), range(2)))
assert sum(c['acquired'] for c in claims) == 1, claims
claim = next(c for c in claims if c['acquired'])
finish = f"SELECT finish_daily_source_attempt('{claim['run_date']}','{WI}','cpnu','{claim['lease_token']}',true,false,null,'{{\"ok\":true,\"inserted_count\":0,\"skipped_count\":15}}');"
assert sql(finish) == 't'
assert json.loads(sql(claim_sql))['status'] == 'SUCCESS'
assert sql("SELECT attempts FROM daily_source_attempts") == '1'

# A different source retries only itself, max three times; an old token cannot finish.
claim_samai = f"SELECT claim_daily_source_attempt('{WI}','samai');"
first = json.loads(sql(claim_samai))
sql("UPDATE daily_source_attempts SET lease_expires_at=now()-interval '1 second' WHERE source='samai'")
second = json.loads(sql(claim_samai))
assert second['attempts'] == 2
assert sql(f"SELECT finish_daily_source_attempt('{first['run_date']}','{WI}','samai','{first['lease_token']}',true,false,null,'{{}}')") == 'f'
assert sql(f"SELECT finish_daily_source_attempt('{second['run_date']}','{WI}','samai','{second['lease_token']}',false,true,'PARTIAL','{{}}')") == 't'
sql("UPDATE daily_source_attempts SET next_attempt_at=now() WHERE source='samai'")
third = json.loads(sql(claim_samai))
assert third['attempts'] == 3
assert sql(f"SELECT finish_daily_source_attempt('{third['run_date']}','{WI}','samai','{third['lease_token']}',false,true,'TIMEOUT','{{}}')") == 't'
assert json.loads(sql(claim_samai))['status'] == 'FAILED'
assert sql("SELECT attempts FROM daily_source_attempts WHERE source='cpnu'") == '1'

# An old failed organization counter must not exhaust an unattempted item.
WI2 = '33333333-3333-3333-3333-333333333333'
sql(f"INSERT INTO work_items VALUES('{WI2}','{ORG}',null,true,'CGP','RADICADO',null,null,true)")
lock = json.loads(sql(f"SELECT acquire_daily_sync_lock_for_origin('{ORG}','run-a','RECOVERY')"))
assert lock['acquired']
sql("UPDATE auto_sync_daily_ledger SET status='PARTIAL',retry_count=3,last_heartbeat_at=now()-interval '4 minutes'")
lock2 = json.loads(sql(f"SELECT acquire_daily_sync_lock_for_origin('{ORG}','run-b','RECOVERY')"))
assert lock2['acquired']
assert sql("UPDATE auto_sync_daily_ledger SET status='SUCCESS' WHERE run_id='run-a' RETURNING id") == ''

# Source-backed projection distinguishes inadmission warning/rejection/finality, retains manual stage.
sql(f"INSERT INTO work_item_acts VALUES(gen_random_uuid(),'{WI}',CURRENT_DATE,'Auto Inadmite - subsanar so pena de rechazo',false)")
sql(f"SELECT project_stage_decision_review('{WI}')")
assert sql("SELECT decision_kind FROM stage_projection_reviews") == 'INADMISION_REGISTRADA'
assert sql("SELECT suggested_stage FROM stage_projection_reviews") == 'PENDING_AUTO_ADMISORIO'
sql("UPDATE work_item_acts SET description='Auto Rechaza - por competencia'")
sql(f"SELECT project_stage_decision_review('{WI}')")
assert sql("SELECT decision_kind FROM stage_projection_reviews") == 'RECHAZO_REGISTRADO'
assert sql("SELECT coalesce(suggested_stage,'NULL') FROM stage_projection_reviews") == 'NULL'
sql("UPDATE work_item_acts SET description='AUTO TERMINA PROCESO - Acepta Desistimiento'; UPDATE work_items SET stage_inference_enabled=false")
sql(f"SELECT project_stage_decision_review('{WI}')")
assert sql("SELECT decision_kind FROM stage_projection_reviews") == 'DECISION_TERMINACION_REGISTRADA'
assert sql("SELECT stage FROM work_items WHERE id='" + WI + "'") == 'RADICADO'
assert sql("SELECT count(*) FROM stage_projection_reviews") == '1'
print('PASS: concurrent claim, cached success, three attempts, token fencing, partial recovery, stale ledger write, decision projection and manual preservation')