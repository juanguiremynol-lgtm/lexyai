#!/usr/bin/env python3
"""Native SQL safeguards in a disposable clone of the synthetic template."""
import json
import os
from pathlib import Path
import subprocess

repo=Path(__file__).resolve().parents[3]
env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k!='SUPABASE_DB_URL'}
def sql(query=None,db='sync_rollback_itest',file=None):
    args=['/tmp/itest/lpsql','-d',db,'-v','ON_ERROR_STOP=1','-At']
    if file:args+=['-f',str(file)]
    return subprocess.run(args,input=query,text=True,capture_output=True,env=env)
def must(query,db='sync_rollback_itest'):
    result=sql(query,db)
    if result.returncode:raise RuntimeError(result.stderr)
    return result.stdout.strip()
must('DROP DATABASE IF EXISTS sync_rollback_itest WITH (FORCE);','postgres')
must('CREATE DATABASE sync_rollback_itest TEMPLATE sync_itest;','postgres')
results=[]
def check(name,ok):
    results.append({'name':name,'passed':bool(ok)})
    print(('PASS ' if ok else 'FAIL ')+name)
before_index=must("SELECT indexdef FROM pg_indexes WHERE indexname='idx_acts_dedupe_structural'")
records=[]
for sol in ['9200001','9200002']:
    text=f'RECIBE MEMORIALES ONLINE - radicó la solicitud No. {sol} de fecha: 16/10/2026 16:12:08'
    records.append({'work_item_id':'33333333-3333-3333-3333-333333333333','owner_id':'11111111-1111-1111-1111-111111111111','organization_id':'22222222-2222-2222-2222-222222222222','workflow_type':'CPACA','source':'samai','act_date':'2026-10-16','description':text,'hash_fingerprint':'rollback_'+sol,'raw_data':{'origen_solicitud':sol},'documentos':[]})
payload=json.dumps(records).replace("'","''")
inserted=json.loads(must(f"SELECT public.rpc_upsert_work_item_acts('{payload}'::jsonb);"))
check('native SQL two same-date/title solicitudes persist',inserted['inserted_count']==2)
before_rows=must("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM work_item_acts a")
result=sql(file=repo/'supabase/rollbacks/20261019000100_samai_origin_identity.sql')
check('rollback refuses legitimate distinct origins',result.returncode!=0 and 'ROLLBACK_REFUSED' in result.stderr)
check('refused rollback preserves exact rows',must("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM work_item_acts a")==before_rows)
check('refused rollback preserves origin-aware index',must("SELECT indexdef FROM pg_indexes WHERE indexname='idx_acts_dedupe_structural'")==before_index)
must("CREATE FUNCTION itest_suppress_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER itest_suppress_update BEFORE UPDATE ON work_item_acts FOR EACH ROW EXECUTE FUNCTION itest_suppress_update();")
record=records[0];record['documentos']=[{'id':'late-document','url':'https://example.invalid/late.pdf'}]
payload=json.dumps([record]).replace("'","''")
suppressed=json.loads(must(f"SELECT public.rpc_upsert_work_item_acts('{payload}'::jsonb);"))
check('RPC zero-row UPDATE never reports success',suppressed['inserted_count']==0 and suppressed['updated_count']==0 and suppressed['skipped_count']==0 and bool(suppressed['errors']))
check('RPC suppressed UPDATE preserves both records',must("SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM work_item_acts a")==before_rows)
must('DROP TRIGGER itest_suppress_update ON work_item_acts;')
record=records[0]
record['documentos']=[{'id':'doc-a','url':'https://example.invalid/a.pdf'}]
payload=json.dumps([record]).replace("'","''")
must(f"SELECT public.rpc_upsert_work_item_acts('{payload}'::jsonb);")
record['documentos']=None
record['raw_data']['documentos']=[{'id':'doc-b','url':'https://example.invalid/b.pdf'}]
payload=json.dumps([record]).replace("'","''")
must(f"SELECT public.rpc_upsert_work_item_acts('{payload}'::jsonb);")
merged=json.loads(must("SELECT jsonb_build_object('top',documentos,'raw',raw_data->'documentos') FROM work_item_acts WHERE hash_fingerprint='rollback_9200001'"))
check('RPC preserves incoming raw-only document alongside top-level document',len(merged['top'])==2 and len(merged['raw'])==2)
must("UPDATE work_item_acts SET raw_data=raw_data||jsonb_build_object('indice',NULL,'origen_indice',NULL) WHERE hash_fingerprint='rollback_9200001';")
record['raw_data']['indice']=25
record['raw_data']['origen_indice']='25'
payload=json.dumps([record]).replace("'","''")
must(f"SELECT public.rpc_upsert_work_item_acts('{payload}'::jsonb);")
check('RPC fills later indice over explicit null without rekey',must("SELECT (raw_data->>'indice')||'|'||(raw_data->>'origen_indice')||'|'||hash_fingerprint FROM work_item_acts WHERE hash_fingerprint='rollback_9200001'")=='25|25|rollback_9200001')
must("CREATE FUNCTION itest_suppress_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER itest_suppress_insert BEFORE INSERT ON work_item_acts FOR EACH ROW EXECUTE FUNCTION itest_suppress_insert();")
record=dict(records[1]);record['hash_fingerprint']='suppressed_insert';record['description']=record['description'].replace('9200002','9200003');record['raw_data']={'origen_solicitud':'9200003'}
payload=json.dumps([record]).replace("'","''")
suppressed=json.loads(must(f"SELECT public.rpc_upsert_work_item_acts('{payload}'::jsonb);"))
check('RPC zero-row INSERT never reports success',suppressed['inserted_count']==0 and suppressed['updated_count']==0 and suppressed['skipped_count']==0 and bool(suppressed['errors']))
check('suppressed INSERT creates no row',must("SELECT count(*) FROM work_item_acts WHERE hash_fingerprint='suppressed_insert'")=='0')
# A distinct empty clone proves the rollback is usable before new origins exist.
must('DROP DATABASE IF EXISTS sync_rollback_empty_itest WITH (FORCE);','postgres')
must('CREATE DATABASE sync_rollback_empty_itest TEMPLATE sync_itest;','postgres')
result=sql(db='sync_rollback_empty_itest',file=repo/'supabase/rollbacks/20261019000100_samai_origin_identity.sql')
check('rollback works before separate origins exist',result.returncode==0)
check('empty rollback restores legacy structural rule','act_structural_origin' not in must("SELECT indexdef FROM pg_indexes WHERE indexname='idx_acts_dedupe_structural'",'sync_rollback_empty_itest'))
Path('/tmp/itest/native-sql-results.json').write_text(json.dumps(results,indent=2)+'\n')
if not all(r['passed'] for r in results):raise SystemExit(1)
