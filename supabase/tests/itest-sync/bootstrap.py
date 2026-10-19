#!/usr/bin/env python3
"""Initialize ONLY the disposable PostgreSQL 17 fixture on loopback port 54329.

Requires private catalog JSON previously exported through authorized read-only
access. Never reads hosted credentials or connects to an ambient PG connection.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import subprocess

here = Path(__file__).resolve().parent
repo = here.parents[2]
root = Path('/tmp/itest')
root.mkdir(exist_ok=True)
env = {k:v for k,v in os.environ.items() if not k.startswith('PG') and k != 'SUPABASE_DB_URL'}
env['PGSSLMODE'] = 'disable'
def psql(sql=None, file=None, db='sync_itest', check=True):
    cmd = ['psql','-h','127.0.0.1','-p','54329','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-qAt']
    if file: cmd += ['-f',str(file)]
    result = subprocess.run(cmd,input=sql,text=True,capture_output=True,env=env)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

version = psql('SHOW server_version;',db='postgres').stdout.strip()
if not version.startswith('17.'):
    raise SystemExit('Native PostgreSQL 17 is required; found ' + version)
for name in ['lpsql','postgrest.conf','gateway.ts','runfn.sh']:
    shutil.copy2(here/name,root/name)
(root/'lpsql').chmod(0o700)
(root/'runfn.sh').chmod(0o700)
subprocess.run(['python3',str(here/'build-catalog-schema.py')],check=True,env=env)
psql('DROP DATABASE IF EXISTS sync_run WITH (FORCE); DROP DATABASE IF EXISTS sync_itest WITH (FORCE);',db='postgres')
psql('CREATE DATABASE sync_itest;',db='postgres')
psql(file=here/'prelude.sql')
psql(file=root/'public_schema.sql')
psql("ALTER DATABASE sync_itest SET search_path = public, extensions;")
views = json.loads((root/'catalog-view-statements.json').read_text())
while views:
    remaining=[]
    for statement in views:
        result=psql(statement,check=False)
        if result.returncode: remaining.append(statement)
    if len(remaining)==len(views):
        raise RuntimeError('Unresolved production view dependencies: '+result.stderr)
    views=remaining
for path in sorted(root.glob('reference-*.json')):
    name=path.stem.removeprefix('reference-')
    if name not in {'deadline_rules','providencia_classification_rules','colombian_holidays','judicial_term_suspensions','holiday_calendar_coverage'}:
        raise RuntimeError('Unreviewed reference table '+name)
    records=json.loads(path.read_text())['rows']
    if name=='judicial_term_suspensions':
        # Only country-wide calendar reference; no user's private suspensions.
        records=[r for r in records if r.get('owner_id') is None]
    payload=json.dumps(records).replace("'","''")
    psql(f"INSERT INTO public.{name} SELECT * FROM jsonb_populate_recordset(NULL::public.{name}, '{payload}'::jsonb);")
for migration in ['20261019000100_samai_origin_identity.sql', '20261019000200_samai_publication_evidence.sql', '20261019000300_estado_document_recovery.sql', '20261019000400_act_document_observation_order.sql', '20261019000500_estado_document_scoped_claim.sql', '20261019000600_act_enrichment_body_cas.sql']:
    psql(file=repo/'supabase/migrations'/migration)
psql(file=here/'seed.sql')
secret='local-itest-jwt-secret-not-a-real-credential-0123456789'
def b64(data):return base64.urlsafe_b64encode(data).decode().rstrip('=')
def token(role,sub=None):
    claims={'role':role,'iss':'itest','exp':4102444800}
    if sub:claims['sub']=sub
    message=b64(json.dumps({'alg':'HS256','typ':'JWT'}).encode())+'.'+b64(json.dumps(claims).encode())
    return message+'.'+b64(hmac.new(secret.encode(),message.encode(),hashlib.sha256).digest())
for name,role,sub in [('svc','service_role',None),('anon','anon',None),('owner','authenticated','11111111-1111-1111-1111-111111111111'),('other','authenticated','99999999-9999-9999-9999-999999999999')]:
    path=root/(name+'.jwt');path.write_text(token(role,sub)+'\n');path.chmod(0o600)
print('Prepared PostgreSQL '+version+' with complete public schema, exact act triggers/RLS, reference rules and synthetic records.')
