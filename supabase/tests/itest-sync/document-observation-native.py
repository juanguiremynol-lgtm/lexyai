#!/usr/bin/env python3
"""Run temporal document RPC/CAS tests only in a loopback synthetic clone.
Requires the existing itest bootstrap (PostgreSQL17 on54329, sync_itest template,
/tmp/itest/svc.jwt) and installed application node_modules. Never resets public.
"""
from pathlib import Path
import os, socket, subprocess, time

repo=Path(__file__).resolve().parents[3]
evidence=Path('/tmp/samai-functional/evidence-r2'); evidence.mkdir(parents=True,exist_ok=True)
psql='/tmp/itest/lpsql'; postgrest='/tmp/samai-tools/bin/postgrest'
env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k!='SUPABASE_DB_URL'}
def sql(query=None,file=None,database='sync_temporal'):
    command=[psql,'-d',database,'-v','ON_ERROR_STOP=1','-At']
    if file: command+=['-f',str(file)]
    if query: command+=['-c',query]
    return subprocess.run(command,check=True,capture_output=True,text=True,env=env)
if not Path('/tmp/itest/svc.jwt').is_file(): raise SystemExit('Run the isolated itest bootstrap before this harness.')
with socket.socket() as probe:
    if probe.connect_ex(('127.0.0.1',3004))==0: raise SystemExit('Local port3004 is already occupied; no process was changed.')
if sql("SELECT 1 FROM pg_database WHERE datname='sync_temporal'",database='postgres').stdout.strip()!='1':
    sql('CREATE DATABASE sync_temporal TEMPLATE sync_itest',database='postgres')
migration=repo/'supabase/migrations/20261019000400_act_document_observation_order.sql'
with (evidence/'temporal-migration-apply.log').open('w') as log:
    for repeat in range(2):
        result=sql(file=migration);log.write(f'Application {repeat+1}: exit0\n'+result.stdout+result.stderr)
config=evidence/'temporal-postgrest.conf'
config.write_text('''db-uri = "postgres://authenticator:local@127.0.0.1:54329/sync_temporal?sslmode=disable"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "local-itest-jwt-secret-not-a-real-credential-0123456789"
server-port = 3004
server-host = "127.0.0.1"
db-pool = 5
''')
with (evidence/'temporal-postgrest.log').open('w') as serverlog:
    process=subprocess.Popen([postgrest,str(config)],stdout=serverlog,stderr=subprocess.STDOUT,env=env)
    try:
        for _ in range(100):
            if process.poll() is not None: raise RuntimeError('Local PostgREST exited; inspect temporal-postgrest.log')
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1',3004))==0: break
            time.sleep(.05)
        else: raise RuntimeError('Local PostgREST startup timed out')
        result=subprocess.run(['node','--import','tsx','--test','supabase/tests/itest-sync/document-observation-native.test.ts'],cwd=repo,env=env,capture_output=True,text=True)
        (evidence/'document-observation-native-tests.log').write_text(result.stdout+result.stderr)
        print(result.stdout,end='');print(result.stderr,end='')
        if result.returncode: raise SystemExit(result.returncode)
    finally:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill();process.wait()
