"""The actual replacement RPC on disposable PostgreSQL; never production."""
import json,uuid
from pathlib import Path
import psycopg2
from psycopg2.extras import Json


def test_verified_ingestion_and_independent_monitor_ownership():
    db=psycopg2.connect(host='/tmp',port=55439,dbname='postgres',user='ejcs1499')
    schema='claim_test_'+uuid.uuid4().hex[:10]
    sql=Path('coordination/20261101_supervisor_verified_ingestion.sql').read_text()
    fn='CREATE OR REPLACE FUNCTION '+sql.split('CREATE OR REPLACE FUNCTION ',1)[1].split('REVOKE ALL ON FUNCTION ',1)[0]
    fn=fn.replace('public.',schema+'.').replace("'public'","'"+schema+"'")
    try:
        with db.cursor() as c:
            c.execute('CREATE SCHEMA '+schema);c.execute('SET search_path TO '+schema)
            c.execute('CREATE SCHEMA IF NOT EXISTS auth')
            c.execute("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_setting(''test.auth_role'',true)'")
            c.execute("SET LOCAL test.auth_role='service_role'")
            c.execute('''CREATE TABLE atenia_ai_remediation_queue(id uuid PRIMARY KEY,work_item_id uuid,organization_id uuid,
              action_type text,status text,run_after timestamptz,attempts int,max_attempts int,priority int,
              created_at timestamptz,updated_at timestamptz,last_error text,payload jsonb);
              CREATE TABLE work_items(id uuid PRIMARY KEY,organization_id uuid,radicado text,lifecycle_state text,
               monitoring_enabled boolean,deleted_at timestamptz,workflow_type text);
              CREATE TABLE work_item_sync_timeline(id uuid,work_item_id uuid,organization_id uuid,operation text,
               provider text,status text,metadata jsonb,started_at timestamptz);
              CREATE TABLE work_item_provider_enrollment(work_item_id uuid,provider_key text,scope text,enabled boolean);
              CREATE TABLE supervisor_verified_ingestion_20261101(queue_id uuid PRIMARY KEY,before_image jsonb,
                timeline_id uuid,source_observed_at timestamptz);
              CREATE TABLE estados_monitor_runs(id uuid,run_date date,channel text);
              CREATE TABLE estados_monitor_run_items(run_id uuid,work_item_id uuid,status text)''')
            org=str(uuid.uuid4())
            def item(action='RETRY_ACTS',paused=False):
                wid,qid=str(uuid.uuid4()),str(uuid.uuid4())
                c.execute("INSERT INTO work_items VALUES(%s,%s,'05001400300120250154400','ACTIVE',%s,NULL,'CGP')",(wid,org,not paused))
                c.execute("INSERT INTO work_item_provider_enrollment VALUES(%s,'cpnu','ACTS',true)",(wid,))
                c.execute("INSERT INTO atenia_ai_remediation_queue VALUES(%s,%s,%s,%s,'PENDING',now(),0,3,50,now(),now(),NULL,'{}')",(qid,wid,org,action))
                return wid,qid
            current,done=item();old,oldq=item();partial,partialq=item();paused,pausedq=item(paused=True)
            for wid,status,age in [(current,'success','0 hours'),(old,'success','25 hours'),(partial,'partial','0 hours'),(paused,'success','0 hours')]:
                c.execute("INSERT INTO work_item_sync_timeline VALUES(%s,%s,NULL,'acts','cpnu',%s,jsonb_build_object('source_complete',true,'source_observed_at',now()-%s::interval),now())",(str(uuid.uuid4()),wid,status,age))
            managed,pubq=item('RETRY_PUBS');run=str(uuid.uuid4())
            c.execute("INSERT INTO estados_monitor_runs VALUES(%s,(now() AT TIME ZONE 'America/Bogota')::date,'publicaciones')",(run,))
            c.execute("INSERT INTO estados_monitor_run_items VALUES(%s,%s,'PENDING')",(run,managed))
            for _ in range(6):item()
            c.execute(fn);c.execute('SELECT * FROM atenia_ai_claim_supported_queue(50)');claims=c.fetchall()
            assert len(claims)==5 and all(x[3]=='RETRY_ACTS' for x in claims)
            c.execute('SELECT status,attempts,payload FROM atenia_ai_remediation_queue WHERE id=%s',(done,))
            status,attempts,payload=c.fetchone();assert (status,attempts)==('DONE',0)
            assert payload['completion_kind']=='VERIFIED_STORED_INGESTION'
            for qid in [oldq,partialq]:
                c.execute('SELECT status FROM atenia_ai_remediation_queue WHERE id=%s',(qid,));assert c.fetchone()[0]!='DONE'
            for qid in [pubq,pausedq]:
                c.execute('SELECT status,attempts FROM atenia_ai_remediation_queue WHERE id=%s',(qid,));assert c.fetchone()==('PENDING',0)
            c.execute('SELECT * FROM atenia_ai_claim_supported_queue(5)');c.fetchall()
            c.execute('SELECT count(*) FROM supervisor_verified_ingestion_20261101');assert c.fetchone()[0]==1
            c.execute("UPDATE work_items SET monitoring_enabled=true WHERE id=%s",(paused,))
            c.execute("UPDATE work_item_sync_timeline SET metadata=metadata||jsonb_build_object('source_observed_at',now()-interval '25 hours') WHERE work_item_id=%s",(paused,))
            c.execute('SELECT * FROM atenia_ai_claim_supported_queue(5)');reactivated=c.fetchall()
            assert any(str(x[0])==pausedq for x in reactivated)
            c.execute('SAVEPOINT noauth');c.execute("SET LOCAL test.auth_role='authenticated'")
            try:c.execute('SELECT * FROM atenia_ai_claim_supported_queue(5)')
            except psycopg2.errors.InsufficientPrivilege:c.execute('ROLLBACK TO SAVEPOINT noauth')
            else:raise AssertionError('untrusted RPC execution accepted')
    finally:
        db.rollback();db.close()
