#!/usr/bin/env python3
"""Synthetic rehearsal of three scoped historical pairs with real triggers.

No actual case rows or approval scope are imported. This verifies the proposed
shape of the historical repair; it does not authorize or perform that repair.
"""
import json
import os
from pathlib import Path
import subprocess

env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k!='SUPABASE_DB_URL'}
def sql(statement,db='sync_history_itest'):
    r=subprocess.run(['/tmp/itest/lpsql','-d',db,'-v','ON_ERROR_STOP=1','-At'],input=statement,text=True,capture_output=True,env=env)
    if r.returncode:raise RuntimeError(r.stderr)
    return r.stdout.strip()
def literal(value):return "'"+str(value).replace("'","''")+"'"
def js(value):return literal(json.dumps(value))+"::jsonb"
sql('DROP DATABASE IF EXISTS sync_history_itest WITH (FORCE);','postgres')
sql('CREATE DATABASE sync_history_itest TEMPLATE sync_itest;','postgres')
wi='33333333-3333-3333-3333-333333333333'
owner='11111111-1111-1111-1111-111111111111'
org='22222222-2222-2222-2222-222222222222'
pairs=[]
for i,date in enumerate(['2026-07-27','2026-08-24','2026-10-16'],1):
    a,b=str(9400000+i*2),str(9400001+i*2)
    text=lambda sol:f'radicó la solicitud No. {sol} tipo: Recepción de Memoriales de fecha: 16/10/2026 16:12:08, Documentos anexos: 2. OPOSICION MEDIDA CAUTELAR'
    rowid=f'44444444-4444-4444-4444-{i:012d}'
    desc='RECIBE MEMORIALES ONLINE - '+text(a)
    raw={'actuacion':'RECIBE MEMORIALES ONLINE','anotacion':text(b),'anexos_anunciados':2}
    sql(f"INSERT INTO work_item_acts(id,work_item_id,owner_id,organization_id,act_date,description,event_summary,hash_fingerprint,source,raw_data,documentos) VALUES ({literal(rowid)},{literal(wi)},{literal(owner)},{literal(org)},{literal(date)},{literal(desc)},{literal(text(b))},{literal('history_'+a)},'samai',{js(raw)},NULL);")
    pairs.append((rowid,date,a,b,text(a),text(b)))
protected="SELECT jsonb_agg(jsonb_build_array(id,hash_fingerprint,description,act_date) ORDER BY id) FROM work_item_acts WHERE id::text LIKE '44444444-%'"
effects="""SELECT jsonb_build_object(
 'notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM notifications n),
 'alerts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM alert_instances a),
 'deadlines',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM work_item_deadlines d),
 'hearings',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM work_item_hearings h))"""
before_protected=sql(protected)
before_effects=sql(effects)
for i,(rowid,date,a,b,texta,textb) in enumerate(pairs,1):
    source={'actuacion':'RECIBE MEMORIALES ONLINE','anotacion':texta,'origen_solicitud':a,'origen_radicada_en':'16/10/2026 16:12:08','origen_indice':str(i*2),'anexos_anunciados':2}
    sql(f"UPDATE work_item_acts SET raw_data=raw_data||{js(source)},event_summary={literal('RECIBE MEMORIALES ONLINE - '+texta)} WHERE id={literal(rowid)};")
    raw={'actuacion':'RECIBE MEMORIALES ONLINE','anotacion':textb,'origen_solicitud':b,'origen_radicada_en':'16/10/2026 16:12:08','origen_indice':str(i*2+1),'anexos_anunciados':2}
    sql(f"INSERT INTO work_item_acts(work_item_id,owner_id,organization_id,act_date,description,event_summary,hash_fingerprint,source,raw_data,documentos,discovery_type,ingest_run_mode) VALUES ({literal(wi)},{literal(owner)},{literal(org)},{literal(date)},{literal('RECIBE MEMORIALES ONLINE - '+textb)},{literal(textb)},{literal('history_'+b)},'samai',{js(raw)},NULL,'HISTORICO_DETECTADO','SWEEP');")
checks=[
 ('three historical originals retain IDs, fingerprints and protected fields',sql(protected)==before_protected),
 ('three separate historical requests inserted',sql('SELECT count(*) FROM work_item_acts')=='6'),
 ('historical inserts remain HISTORICO_DETECTADO / SWEEP',sql("SELECT count(*) FROM work_item_acts WHERE id::text NOT LIKE '44444444-%' AND discovery_type='HISTORICO_DETECTADO' AND ingest_run_mode='SWEEP'")=='3'),
 ('historical repair leaves notifications, alert/deadline/hearing rows byte-for-byte unchanged',sql(effects)==before_effects),
 ('announced annexes remain unverified documents',sql('SELECT count(*) FROM work_item_acts WHERE documentos IS NULL')=='6'),
 ('each repaired annotation matches its protected solicitud',sql("SELECT count(*) FROM work_item_acts WHERE (regexp_match(description,'solicitud\\s+No\\.?\\s*(\\d+)','i'))[1] IS DISTINCT FROM (regexp_match(raw_data->>'anotacion','solicitud\\s+No\\.?\\s*(\\d+)','i'))[1]")=='0'),
]
for name,ok in checks:print(('PASS ' if ok else 'FAIL ')+name)
Path('/tmp/itest/historical-repair-results.json').write_text(json.dumps([{'name':n,'passed':b} for n,b in checks],indent=2)+'\n')
if not all(ok for _,ok in checks):raise SystemExit(1)
