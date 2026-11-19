"""Scoped technical recovery against isolated PostgreSQL and a fake net queue."""
import os,json,uuid,re
from pathlib import Path
import psycopg2
from psycopg2.extensions import parse_dsn

def test_enum_recovery_does_not_query_source_or_reset_attempt_history():
    p=parse_dsn(os.environ['MONITOR_RECOVERY_TEST_DSN'])
    assert p.get('host') in ('/tmp','127.0.0.1') and p.get('port')=='55439'
    admin=psycopg2.connect(**p);admin.autocommit=True
    name='test_cpnu_enum_'+uuid.uuid4().hex[:10]
    with admin.cursor() as c:
        for role in ['anon','authenticated','service_role']:
            c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,))
            if not c.fetchone():c.execute('CREATE ROLE '+role)
        c.execute('CREATE DATABASE '+name)
    db=psycopg2.connect(**{**p,'dbname':name})
    sql=(Path(__file__).resolve().parents[1]/'coordination/20261101_cpnu_remaining_enum_recovery.sql').read_text()
    targets=re.findall(r"\('([0-9a-f-]+)'::uuid,'([0-9]+)','([0-9a-f-]+)'\)",sql)
    assert len(targets)==9
    try:
        with db.cursor() as c:
            c.execute('''CREATE TABLE work_items(id uuid PRIMARY KEY,radicado text,monitoring_enabled bool,lifecycle_state text,deleted_at timestamptz);
              CREATE TABLE daily_update_cycles(work_item_id uuid,run_date date,channels jsonb,continuations int,updated_at timestamptz);
              CREATE TABLE work_item_provider_enrollment(work_item_id uuid,provider_key text,scope text,enabled bool);
              CREATE TABLE sync_traces(trace_id uuid,work_item_id uuid,error_code text,message text);
              CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
              INSERT INTO vault.decrypted_secrets VALUES('SUPABASE_URL','https://fixture.invalid'),('CRON_SERVICE_KEY','local-fixture');
              CREATE SCHEMA net;CREATE TABLE net.fake_queue(id bigserial,body jsonb);
              CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$
                INSERT INTO net.fake_queue(body) VALUES(body) RETURNING id $$;''')
            for i,(ident,rad,trace) in enumerate(targets[:3]):
                c.execute("INSERT INTO work_items VALUES(%s,%s,true,'ACTIVE',NULL)",(ident,rad))
                c.execute("INSERT INTO work_item_provider_enrollment VALUES(%s,'cpnu','ACTS',%s)",(ident,i!=1))
                ch={'acts':{'status':'DONE' if i==2 else 'FAILED','error_code':'INTERNAL_ERROR','trace_id':trace},'pubs':{'status':'DONE'}}
                c.execute("INSERT INTO daily_update_cycles VALUES(%s,'2026-10-31',%s,4,now())",(ident,json.dumps(ch)))
                c.execute("INSERT INTO sync_traces VALUES(%s,%s,'INTERNAL_ERROR',%s)",(trace,ident,'invalid input value for enum scrape_status: "EMPTY"'))
        db.commit()
        with db.cursor() as c:
            c.execute(sql)
            c.execute('SELECT count(*) FROM monitor_cpnu_enum_recovery_20261101');assert c.fetchone()[0]==1
            c.execute('SELECT body FROM net.fake_queue');body=c.fetchone()[0];assert body['allow_buscar'] is False and body['force_refresh'] is False
            c.execute('SELECT channels,continuations FROM daily_update_cycles WHERE work_item_id=%s',(targets[0][0],))
            ch,n=c.fetchone();assert 'acts' not in ch and ch['pubs']['status']=='DONE' and n==5
            assert ch['acts_before_empty_enum_20261101']['trace_id']==targets[0][2]
            c.execute(sql)
            c.execute('SELECT count(*) FROM net.fake_queue');assert c.fetchone()[0]==1
        db.commit()
    finally:
        db.close()
        with admin.cursor() as c:c.execute('DROP DATABASE '+name)
        admin.close()
