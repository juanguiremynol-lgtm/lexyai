"""Execute the actual service-only finisher on disposable PostgreSQL."""
import json,os,uuid
from pathlib import Path
import psycopg2,pytest
from psycopg2.extensions import parse_dsn
from psycopg2.extras import Json


def test_waits_back_off_without_false_source_failure_or_unfenced_completion():
    cfg=parse_dsn(os.environ['SAMAI_FIJACION_TEST_DSN'])
    assert cfg.get('host') in ('/tmp','127.0.0.1') and cfg.get('port')=='55439'
    schema='wait_finish_'+uuid.uuid4().hex[:12];db=psycopg2.connect(**cfg)
    sql=Path('coordination/20261101_monitor_expired_wait_backoff.sql').read_text()
    body='CREATE OR REPLACE FUNCTION '+sql.split('CREATE OR REPLACE FUNCTION ',1)[1].split('REVOKE ALL ON FUNCTION ',1)[0]
    body=body.replace('public.',schema+'.').replace("'public'","'"+schema+"'")
    try:
        with db.cursor() as c:
            c.execute('CREATE SCHEMA '+schema)
            c.execute('CREATE SCHEMA IF NOT EXISTS auth')
            c.execute("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_setting(''test.auth_role'',true)'")
            c.execute("SET LOCAL test.auth_role='service_role'")
            c.execute('SET search_path TO '+schema)
            c.execute('''CREATE TABLE estados_monitor_run_items(run_id uuid,work_item_id uuid,status text,
             attempts int,claimed_at timestamptz,lease_token uuid,finished_at timestamptz,
             next_attempt_at timestamptz,error_code text,result jsonb)''')
            c.execute(body)
            run,wid,lease=[str(uuid.uuid4()) for _ in range(3)]
            payload={'result_code':'PENDING_UPSTREAM','pending_upstream':True,
              'backend_trace':{'estado':'ADMITIDA','run_status_http':200,
                'backend_run_id':str(uuid.uuid4()),'followup_expired_needs_intervention':True}}
            def fresh(claim_age='1 minute'):
                c.execute('TRUNCATE estados_monitor_run_items')
                c.execute("INSERT INTO estados_monitor_run_items VALUES(%s,%s,'CLAIMED',3,now()-%s::interval,%s,NULL,now(),NULL,'{}')",(run,wid,claim_age,lease))
            def finish(value,token=lease,success=False):
                c.execute('SELECT finish_public_monitor_item(%s,%s,%s,%s,true,%s,%s)',(run,wid,token,success,None if success else 'PENDING_UPSTREAM',Json(value)))
                return c.fetchone()[0]
            fresh();assert finish(payload)
            c.execute("SELECT status,attempts,extract(epoch FROM next_attempt_at-now()),result FROM estados_monitor_run_items")
            status,attempts,delay,result=c.fetchone()
            assert (status,attempts,int(delay))==('PENDING',2,3600)
            assert result['monitor_requires_intervention'] is True
            assert result['monitor_followup_budget_exhausted'] is True
            assert not finish(payload)  # same lease cannot credit the claim twice
            payload['backend_trace']['followup_expired_needs_intervention']=False
            fresh();assert finish(payload)
            c.execute('SELECT attempts,extract(epoch FROM next_attempt_at-now()) FROM estados_monitor_run_items')
            assert c.fetchone()==(2,600)
            for change in [{'estado':'PARCIAL'},{'run_status_http':401},{'backend_run_id':'invalid'}]:
                value=json.loads(json.dumps(payload));value['backend_trace'].update(change)
                fresh();assert finish(value)
                c.execute('SELECT status,attempts FROM estados_monitor_run_items');assert c.fetchone()==('FAILED',3)
            fresh();assert not finish(payload,str(uuid.uuid4()))
            fresh('5 minutes');assert not finish(payload)
            fresh();assert finish({'ok':True},success=True)
            c.execute('SELECT status FROM estados_monitor_run_items');assert c.fetchone()[0]=='SUCCESS'
            c.execute('SAVEPOINT denied');c.execute("SET LOCAL test.auth_role='authenticated'")
            with pytest.raises(psycopg2.errors.InsufficientPrivilege):finish(payload)
            c.execute('ROLLBACK TO SAVEPOINT denied')
    finally:
        db.rollback()
        with db.cursor() as c:c.execute('DROP SCHEMA IF EXISTS '+schema+' CASCADE')
        db.commit();db.close()
