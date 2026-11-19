"""Real isolated PostgreSQL recovery, with no portal/production connections."""
import json,os,uuid
from pathlib import Path
import psycopg2
from psycopg2.extensions import parse_dsn


def test_scoped_contract_recovery_preserves_history_and_is_repeatable():
    dsn=os.environ['MONITOR_RECOVERY_TEST_DSN']
    parsed=parse_dsn(dsn)
    assert parsed.get('host') in ('/tmp','127.0.0.1') and parsed.get('port')=='55439'
    admin=psycopg2.connect(dsn);admin.autocommit=True
    name='test_monitor_contract_'+uuid.uuid4().hex[:10]
    with admin.cursor() as c:
        for role in ['anon','authenticated','service_role']:
            c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,))
            if not c.fetchone():c.execute('CREATE ROLE '+role)
        c.execute('CREATE DATABASE '+name)
    db=psycopg2.connect(**{**parsed,'dbname':name})
    run='68f2c917-02ca-4bcd-931c-b912f88f4891'
    ids=[str(uuid.uuid4()) for _ in range(3)]
    try:
        with db.cursor() as c:
            c.execute('''CREATE TABLE work_items(id uuid PRIMARY KEY,workflow_type text,lifecycle_state text,
                monitoring_enabled boolean,deleted_at timestamptz,radicado text);
              CREATE TABLE work_item_provider_enrollment(work_item_id uuid,provider_key text,scope text,enabled boolean);
              CREATE TABLE estados_monitor_runs(id uuid PRIMARY KEY,channel text,run_date date,status text);
              CREATE TABLE estados_monitor_run_items(run_id uuid,work_item_id uuid,status text,error_code text,
                lease_token uuid,attempts int,next_attempt_at timestamptz,result jsonb,PRIMARY KEY(run_id,work_item_id));
              CREATE TABLE daily_update_cycles(work_item_id uuid,run_date date,channels jsonb,updated_at timestamptz);''')
            c.execute("INSERT INTO estados_monitor_runs VALUES(%s,'samai_estados','2026-10-31','PARTIAL')",(run,))
            for i,ident in enumerate(ids):
                c.execute("INSERT INTO work_items VALUES(%s,'CPACA','ACTIVE',true,NULL,'05001233300020260142400')",(ident,))
                c.execute("INSERT INTO work_item_provider_enrollment VALUES(%s,'samai_estados','PUBS',%s)",(ident,i!=1))
                c.execute("INSERT INTO estados_monitor_run_items VALUES(%s,%s,%s,'DAILY_UPDATE_ALREADY_STARTED',NULL,2,now()+interval '1 day','{}')",(run,ident,'CLAIMED' if i==2 else 'PENDING'))
                c.execute("INSERT INTO daily_update_cycles VALUES(%s,'2026-10-31',%s,now())",(ident,json.dumps({'acts':{'status':'DONE'},'pubs':{'status':'PENDING_UPSTREAM','started_at':'2026-10-31T12:00:00Z','trace_id':'keep-old'}})))
        db.commit()
        sql=(Path(__file__).resolve().parents[1]/'coordination/20261101_recover_samai_monitor_read_contract.sql').read_text()
        with db.cursor() as c:
            c.execute(sql)
            c.execute('SELECT count(*) FROM samai_monitor_contract_recovery_20261101');assert c.fetchone()[0]==1
            c.execute('SELECT channels FROM daily_update_cycles WHERE work_item_id=%s',(ids[0],))
            channels=c.fetchone()[0]
            assert 'pubs' not in channels and channels['acts']=={'status':'DONE'}
            assert channels['pubs_before_source_contract_20261101']['trace_id']=='keep-old'
            c.execute('SELECT attempts FROM estados_monitor_run_items WHERE work_item_id=%s',(ids[0],));assert c.fetchone()[0]==2
            c.execute(sql)
            c.execute('SELECT count(*) FROM samai_monitor_contract_recovery_20261101');assert c.fetchone()[0]==1
            c.execute("SELECT has_table_privilege('service_role','samai_monitor_contract_recovery_20261101','SELECT')");assert c.fetchone()[0] is False
            c.execute("SELECT count(*) FROM daily_update_cycles WHERE channels ? 'pubs'");assert c.fetchone()[0]==2
        db.commit()
    finally:
        db.close()
        with admin.cursor() as c:c.execute('DROP DATABASE '+name)
        admin.close()
