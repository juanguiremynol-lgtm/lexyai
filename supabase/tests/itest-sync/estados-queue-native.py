#!/usr/bin/env python3
"""Real queue SQL, only in the disposable sync_estados database.
Requires samai-estados-ingestion.test.ts to seed four synthetic queue rows.
No HTTP, remote credentials, real downloads or external effects are used.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess

ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG') and k != 'SUPABASE_DB_URL'}
results = []
def sql(statement, check=True):
    result = subprocess.run(['/tmp/itest/lpsql','-d','sync_estados','-qAt','-v','ON_ERROR_STOP=1','-c',statement], text=True,capture_output=True,env=ENV)
    if check and result.returncode: raise RuntimeError(result.stderr)
    return result.stdout.strip() if check else result
def literal(value): return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
def check(name, condition):
    results.append({'name':name,'pass':bool(condition)})
    if not condition: raise AssertionError(name)

sql("update estado_attachment_queue set next_retry_at='2000-01-01' where status='pending'")
def claim(_):
    return json.loads(sql("with c as (select * from claim_estado_attachment_downloads(1)) select coalesce(jsonb_agg(c),'[]'::jsonb) from c"))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    claims = [row for batch in pool.map(claim,range(4)) for row in batch]
check('four competing workers claim four different documents',len(claims)==4 and len({row['id'] for row in claims})==4)
check('live leases cannot be claimed again',claim(0)==[])
check('attempt budgets were incremented atomically',sorted(row['attempt_count'] for row in claims)==[1,1,1,3])

primary_before = json.loads(sql("select jsonb_object_agg(id,jsonb_build_object('path',pdf_storage_path,'available',pdf_available)) from work_item_publicaciones"))
annex = next(row for row in claims if row['remote_url'].endswith('/estado.pdf'))
primary = next(row for row in claims if row['publicacion_id']==annex['publicacion_id'] and row['remote_url'].endswith('/providencia.pdf'))
def finish(row, attempt=None):
    path=f"{row['publicacion_id']}/{row['id']}/{'a'*64}.pdf"
    evidence={'state':'verified','queue_id':row['id'],'publicacion_id':row['publicacion_id'],'source_url':row['remote_url'],'reading':{'sha256':'a'*64,'pages':2,'pagesRead':2,'method':'SIMULATED_READING_FOR_SQL_ONLY'},'correspondence':{'expected_sha256':'a'*64}}
    patch={'status':'downloaded','storage_path':path,'last_error':None,'validation_evidence':evidence,'validation_checked_at':'2026-10-19T12:00:00Z','downloaded_at':'2026-10-19T12:00:00Z'}
    return sql(f"select finish_estado_attachment_download('{row['id']}',{row['attempt_count'] if attempt is None else attempt},{literal(patch)},{literal({'available':True,'path':path})})"),path
stale,_ = finish(annex,annex['attempt_count']-1)
check('stale attempt cannot commit another workers document',stale=='f')
wrong_patch={'status':'downloaded','storage_path':'another-publication/another-queue/a.pdf','validation_evidence':{'state':'verified','queue_id':primary['id'],'publicacion_id':primary['publicacion_id'],'source_url':primary['remote_url'],'reading':{'sha256':'a'*64,'pages':2,'pagesRead':2},'correspondence':{'expected_sha256':'a'*64}}}
wrong=sql(f"select finish_estado_attachment_download('{annex['id']}',{annex['attempt_count']},{literal(wrong_patch)},null)",False)
check('finalization rejects another document identity and path transactionally',wrong.returncode!=0 and sql(f"select status from estado_attachment_queue where id='{annex['id']}'")=='downloading')
wrong_patch['status']='pending'
wrong_pending=sql(f"select finish_estado_attachment_download('{annex['id']}',{annex['attempt_count']},{literal(wrong_patch)},null)",False)
check('pending result also rejects evidence and path from another document',wrong_pending.returncode!=0 and sql(f"select status from estado_attachment_queue where id='{annex['id']}'")=='downloading')
done,annex_path=finish(annex)
check('valid current attempt commits once',done=='t' and finish(annex)[0]=='f')
after_annex=json.loads(sql("select jsonb_object_agg(id,jsonb_build_object('path',pdf_storage_path,'available',pdf_available)) from work_item_publicaciones"))
check('annex completion never overwrites any primary association',after_annex==primary_before)
_,primary_path=finish(primary)
after_primary=json.loads(sql("select jsonb_object_agg(id,jsonb_build_object('path',pdf_storage_path,'available',pdf_available)) from work_item_publicaciones"))
check('primary completion updates only its own publication',after_primary[primary['publicacion_id']]=={'path':primary_path,'available':True} and all(after_primary[key]==value for key,value in primary_before.items() if key!=primary['publicacion_id']))
check('equal filenames keep independently associated storage paths',annex_path!=primary_path)

remaining=[row for row in claims if row['id'] not in {annex['id'],primary['id']}]
one=remaining[0]
patch={'status':'pending','last_error':'origin_http_503','next_retry_at':'2099-01-01T00:00:00Z','validation_evidence':{'last_failure':'origin_http_503'}}
sql(f"select finish_estado_attachment_download('{one['id']}',{one['attempt_count']},{literal(patch)},null)")
check('retry waits for its own backoff without resetting attempts',claim(0)==[] and sql(f"select attempt_count from estado_attachment_queue where id='{one['id']}'")==str(one['attempt_count']))
sql(f"update estado_attachment_queue set status='downloading',attempt_count=max_attempts,next_retry_at='2000-01-01' where id='{one['id']}'")
claim(0)
check('crashed final attempt is bounded and reaches failed',sql(f"select status from estado_attachment_queue where id='{one['id']}'")=='failed')
denied=sql('set role anon; select * from claim_estado_attachment_downloads(1)',False)
check('anonymous role cannot claim production work',denied.returncode!=0 and 'permission denied' in denied.stderr)

out=Path('/tmp/samai-functional/evidence-r2/states-queue-native.json')
out.write_text(json.dumps({'kind':'native PostgreSQL SQL, synthetic queue and reading evidence; no worker/storage/HTTP here','results':results,'claimed_ids':[row['id'] for row in claims]},indent=2))
print(json.dumps({'passed':sum(row['pass'] for row in results),'total':len(results),'evidence':str(out)}))
