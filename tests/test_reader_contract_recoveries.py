"""Local PostgreSQL, fake net queue, exact recovery SQL; never public portals."""
import json,os,re,uuid
from pathlib import Path
import psycopg2
from psycopg2.extensions import parse_dsn

ROOT=Path(__file__).resolve().parents[1]

def isolated():
    p=parse_dsn(os.environ['MONITOR_RECOVERY_TEST_DSN'])
    assert p.get('host') in ('/tmp','127.0.0.1') and p.get('port')=='55439'
    admin=psycopg2.connect(**p);admin.autocommit=True
    name='test_reader_contract_'+uuid.uuid4().hex[:10]
    with admin.cursor() as c:
        for role in ['anon','authenticated','service_role']:
            c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,))
            if not c.fetchone():c.execute('CREATE ROLE '+role)
        c.execute('CREATE DATABASE '+name)
    return admin,psycopg2.connect(**{**p,'dbname':name}),name

def test_negative_contract_keeps_history_and_repeats_without_new_requests():
    admin,db,name=isolated()
    sql=(ROOT/'coordination/20261101_cpnu_negative_contract_recovery.sql').read_text()
    targets=re.findall(r"\('([0-9a-f-]+)'::uuid,'([0-9]+)','([0-9a-f-]+)'\)",sql)
    assert len(targets)==6
    try:
        with db.cursor() as c:
            c.execute('''CREATE TABLE work_items(id uuid PRIMARY KEY,radicado text,monitoring_enabled bool,lifecycle_state text,deleted_at timestamptz);
             CREATE TABLE daily_update_cycles(work_item_id uuid,run_date date,channels jsonb,continuations int,updated_at timestamptz);
             CREATE TABLE work_item_provider_enrollment(work_item_id uuid,provider_key text,scope text,enabled bool);
             CREATE TABLE sync_traces(trace_id uuid,work_item_id uuid,step text,http_status int,message text);
             CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
             INSERT INTO vault.decrypted_secrets VALUES('SUPABASE_URL','https://fixture.invalid'),('CRON_SERVICE_KEY','local-fixture');
             CREATE SCHEMA net;CREATE TABLE net.fake_queue(id bigserial,body jsonb);
             CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$
              INSERT INTO net.fake_queue(body) VALUES(body) RETURNING id $$;''')
            for i,(ident,rad,trace) in enumerate(targets[:3]):
                c.execute("INSERT INTO work_items VALUES(%s,%s,true,'ACTIVE',NULL)",(ident,rad))
                c.execute("INSERT INTO work_item_provider_enrollment VALUES(%s,'cpnu','ACTS',%s)",(ident,i!=1))
                ch={'acts':{'status':'DONE' if i==2 else 'FAILED','error_code':'PROVIDER_ERROR','trace_id':trace},'pubs':{'status':'DONE'}}
                c.execute("INSERT INTO daily_update_cycles VALUES(%s,'2026-10-31',%s,5,now())",(ident,json.dumps(ch)))
                c.execute("INSERT INTO sync_traces VALUES(%s,%s,'SYNC_FAILED',410,'CPNU: UPSTREAM_HTTP_410')",(trace,ident))
        db.commit()
        with db.cursor() as c:
            c.execute(sql)
            c.execute('SELECT count(*) FROM monitor_cpnu_negative_recovery_20261101');assert c.fetchone()[0]==1
            c.execute('SELECT channels,continuations FROM daily_update_cycles WHERE work_item_id=%s',(targets[0][0],))
            ch,n=c.fetchone();assert ch['acts_before_negative_contract_20261101']['trace_id']==targets[0][2] and n==6
            assert ch['pubs']['status']=='DONE' and 'acts' not in ch
            c.execute('SELECT body FROM net.fake_queue');body=c.fetchone()[0]
            assert body['allow_buscar'] is False and body['force_refresh'] is False
            c.execute(sql)
            c.execute('SELECT count(*) FROM net.fake_queue');assert c.fetchone()[0]==1
        db.commit()
    finally:
        db.close()
        with admin.cursor() as c:c.execute('DROP DATABASE '+name)
        admin.close()

def test_certified_reader_switches_only_unleased_pending_and_preserves_old_poll_history():
    admin,db,name=isolated()
    sql=(ROOT/'coordination/20261101_pp_certified_reader_recovery.sql').read_text()
    targets=re.findall(r"\('([0-9a-f-]+)'::uuid,'([0-9]+)','([0-9a-f-]+)'::uuid,'([0-9a-f-]+)'\)",sql)
    assert len(targets)==2
    run=str(uuid.uuid4())
    try:
        with db.cursor() as c:
            c.execute('''CREATE TABLE work_items(id uuid PRIMARY KEY,radicado text,lifecycle_state text,monitoring_enabled bool,deleted_at timestamptz);
             CREATE TABLE work_item_provider_enrollment(work_item_id uuid,provider_key text,scope text,enabled bool);
             CREATE TABLE cron_state(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
             CREATE TABLE estados_monitor_runs(id uuid PRIMARY KEY,run_date date,channel text);
             CREATE TABLE estados_monitor_run_items(run_id uuid,work_item_id uuid,status text,error_code text,lease_token uuid,
              result jsonb,next_attempt_at timestamptz,attempts int);''')
            c.execute("INSERT INTO estados_monitor_runs VALUES(%s,'2026-10-31','publicaciones')",(run,))
            for i,(ident,rad,backend,trace) in enumerate(targets):
                c.execute("INSERT INTO work_items VALUES(%s,%s,'ACTIVE',true,NULL)",(ident,rad))
                c.execute("INSERT INTO work_item_provider_enrollment VALUES(%s,'publicaciones','PUBS',true)",(ident,))
                value={'backend_run_id':str(uuid.uuid4()),'followup_closed':True,'trazabilidad_id':trace,'poll_count':17,'attempts':71}
                c.execute('INSERT INTO cron_state VALUES(%s,%s,now())',('pub_rescrape:'+ident,json.dumps(value)))
                c.execute("INSERT INTO estados_monitor_run_items VALUES(%s,%s,'PENDING','DAILY_UPDATE_ALREADY_STARTED',%s,'{}',now(),3)",(run,ident,None if i==0 else str(uuid.uuid4())))
        db.commit()
        with db.cursor() as c:
            c.execute(sql)
            c.execute('SELECT gate_before FROM monitor_pp_reader_recovery_20261101');audit=c.fetchall()
            assert len(audit)==1 and audit[0][0]['value']['poll_count']==17
            c.execute('SELECT value FROM cron_state WHERE key=%s',('pub_rescrape:'+targets[0][0],));v=c.fetchone()[0]
            assert v['backend_run_id']==targets[0][2] and v['poll_count']==0 and v['attempts']==71 and v['previous_run_id']!=v['backend_run_id']
            c.execute('SELECT attempts FROM estados_monitor_run_items WHERE work_item_id=%s',(targets[0][0],));assert c.fetchone()[0]==3
            c.execute(sql)
            c.execute('SELECT count(*) FROM monitor_pp_reader_recovery_20261101');assert c.fetchone()[0]==1
        db.commit()
    finally:
        db.close()
        with admin.cursor() as c:c.execute('DROP DATABASE '+name)
        admin.close()
