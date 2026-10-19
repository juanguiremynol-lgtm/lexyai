#!/usr/bin/env python3
"""Real SQL in an isolated local clone only; no production/HTTP/storage access."""
import concurrent.futures, json, os, subprocess
from pathlib import Path

DB='sync_estados_scoped'
APP=Path(__file__).resolve().parents[2]
ENV={k:v for k,v in os.environ.items() if not k.startswith('PG') and k!='SUPABASE_DB_URL'}
def sql(q,check=True,db=DB):
    r=subprocess.run(['/tmp/itest/lpsql','-d',db,'-qAt','-v','ON_ERROR_STOP=1','-c',q],text=True,capture_output=True,env=ENV)
    if check and r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip() if check else r
sql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)',db='postgres')
sql(f'CREATE DATABASE {DB} TEMPLATE sync_estados',db='postgres')
sql((APP/'migrations/20261019000500_estado_document_scoped_claim.sql').read_text())
A='33333333-3333-3333-3333-333333333333'
B='44444444-4444-4444-4444-444444444444'
C='55555555-5555-4555-8555-555555555555'
sql(f"""INSERT INTO work_items(id,owner_id,organization_id,workflow_type,stage,radicado)
 SELECT '{C}',owner_id,organization_id,workflow_type,stage,'99999233300020260000200' FROM work_items WHERE id='{A}';
 INSERT INTO work_item_publicaciones(work_item_id,organization_id,title,source,hash_fingerprint,raw_data)
 SELECT id,organization_id,'Local isolated scope fixture','samai_estados','scoped-fixture-'||id::text,'{{}}'::jsonb FROM work_items WHERE id='{C}';
 DELETE FROM estado_attachment_queue;
 INSERT INTO estado_attachment_queue(work_item_id,organization_id,publicacion_id,remote_url,status,attempt_count,max_attempts,next_retry_at)
 SELECT w.id,w.organization_id,p.id,'https://fixture.invalid/'||v.suffix||'/'||w.id::text,
 'pending',CASE WHEN v.suffix='exhausted' THEN 5 ELSE 0 END,5,'2000-01-01'
 FROM work_items w CROSS JOIN LATERAL (SELECT id FROM work_item_publicaciones WHERE work_item_id=w.id ORDER BY id LIMIT 1) p
 CROSS JOIN (VALUES('ready1'),('ready2'),('exhausted')) v(suffix) WHERE w.id IN ('{A}','{B}','{C}');
 INSERT INTO estado_attachment_queue(work_item_id,organization_id,publicacion_id,remote_url,status,attempt_count,max_attempts,next_retry_at)
 SELECT '{A}',organization_id,id,'https://fixture.invalid/mismatched-association','pending',0,5,'2000-01-01' FROM work_item_publicaciones WHERE work_item_id='{C}' LIMIT 1;
""")
results=[]
def check(name,ok):
    results.append({'name':name,'pass':bool(ok)})
    if not ok: raise AssertionError(name)
def snapshot(where): return sql(f"SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]') FROM estado_attachment_queue q WHERE {where}")
outside=snapshot(f"work_item_id='{C}' OR remote_url LIKE '%mismatched-association'")
for value in ['NULL::uuid[]','ARRAY[]::uuid[]',f"ARRAY['{A}',NULL]::uuid[]",f"ARRAY['{A}','{B}','{C}']::uuid[]"]:
    rejected=sql(f'SELECT * FROM claim_estado_attachment_downloads_scoped({value},1)',False)
    check(f'invalid SQL scope rejected: {value}',rejected.returncode!=0)
def claim(_): return json.loads(sql(f"SELECT coalesce(jsonb_agg(q),'[]') FROM claim_estado_attachment_downloads_scoped(ARRAY['{A}','{B}']::uuid[],1) q"))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    claimed=[q for batch in pool.map(claim,range(4)) for q in batch]
check('four concurrent scoped workers claim only selected matters',len(claimed)==4 and {q['work_item_id'] for q in claimed}=={A,B})
check('leases and attempts remain exclusive',len({q['id'] for q in claimed})==4 and all(q['attempt_count']==1 for q in claimed) and claim(0)==[])
check('outside and mismatched associations remain byte-identical, including exhausted rows',outside==snapshot(f"work_item_id='{C}' OR remote_url LIKE '%mismatched-association'"))
check('only selected exhausted attempts become terminal',sql(f"SELECT count(*) FROM estado_attachment_queue WHERE work_item_id IN ('{A}','{B}') AND status='failed'")=='2')
denied=sql(f"SET ROLE anon; SELECT * FROM claim_estado_attachment_downloads_scoped(ARRAY['{A}']::uuid[],1)",False)
check('anonymous caller denied scoped claims',denied.returncode!=0 and 'permission denied' in denied.stderr)
ordinary=json.loads(sql("SELECT coalesce(jsonb_agg(q),'[]') FROM claim_estado_attachment_downloads(1) q"))
check('ordinary cron function still works without scope',len(ordinary)==1)
out=Path('/tmp/samai-live/evidence/states-scoped-queue-native.json')
out.write_text(json.dumps({'kind':'real local PostgreSQL complete schema; synthetic queue; no production writes','results':results},indent=2))
print(json.dumps({'passed':len(results),'total':len(results),'evidence':str(out)}))
