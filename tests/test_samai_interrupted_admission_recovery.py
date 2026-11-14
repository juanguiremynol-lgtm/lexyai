"""Exact scoped admission repair retains publications and fences late finish."""
import os,uuid,json
from pathlib import Path
import psycopg2
from psycopg2.extensions import parse_dsn


def test_interrupted_admission_repair_is_scoped_and_repeatable():
    cfg=parse_dsn(os.environ['SAMAI_FIJACION_TEST_DSN'])
    assert cfg.get('host') in ('/tmp','127.0.0.1') and cfg.get('port')=='55439'
    schema='samai_admission_'+uuid.uuid4().hex[:12];db=psycopg2.connect(**cfg)
    sql=Path('coordination/20261101_samai_interrupted_admission_recovery.sql').read_text().replace('public.',schema+'.')
    sql='\n'.join(line for line in sql.splitlines() if not line.startswith('REVOKE '))
    try:
        with db.cursor() as c:
            c.execute('CREATE SCHEMA '+schema);c.execute('SET search_path TO '+schema)
            c.execute('CREATE TABLE work_items(id uuid,radicado text,lifecycle_state text,monitoring_enabled bool,deleted_at timestamptz)')
            c.execute('CREATE TABLE samai_delivery_acceptance_20261101(work_item_id uuid,radicado text,admitted_at timestamptz,source_read_at timestamptz)')
            c.execute('CREATE TABLE work_item_sync_timeline(work_item_id uuid,operation text,provider text,started_at timestamptz)')
            c.execute('CREATE TABLE atenia_ai_remediation_queue(work_item_id uuid,action_type text,status text)')
            c.execute('CREATE TABLE work_item_provider_enrollment(work_item_id uuid,provider_key text,enabled bool,scope text)')
            c.execute('CREATE TABLE daily_update_cycles(work_item_id uuid,run_date date,channels jsonb,updated_at timestamptz)')
            wid=str(uuid.uuid4());token=str(uuid.uuid4())
            c.execute("INSERT INTO work_items VALUES(%s,'exact-fixture','ACTIVE',true,NULL)",(wid,))
            c.execute("INSERT INTO samai_delivery_acceptance_20261101 VALUES(%s,'exact-fixture',pg_postmaster_start_time()-interval '10 minutes',now())",(wid,))
            c.execute("INSERT INTO work_item_provider_enrollment VALUES(%s,'samai',true,'ACTS')",(wid,))
            c.execute("SELECT (pg_postmaster_start_time()-interval '5 minutes')::text")
            channels={'acts':{'status':'STARTED','token':token,'started_at':c.fetchone()[0],
                'invoker':'fresh-samai-delivery-acceptance-20261101'},'pubs':{'status':'DONE','trace_id':'preserve'}}
            c.execute("INSERT INTO daily_update_cycles VALUES(%s,(now() AT TIME ZONE 'America/Bogota')::date,%s::jsonb,now())",(wid,json.dumps(channels)))
            c.execute(sql);c.execute(sql)
            c.execute('SELECT channels FROM daily_update_cycles');after=c.fetchone()[0]
            assert after['pubs']==channels['pubs'] and 'acts' not in after
            assert after['acts_interrupted']['error_code']=='DELIVERY_INTERRUPTED_BY_DB_RESTART'
            c.execute("UPDATE daily_update_cycles SET channels=jsonb_set(channels,'{acts,status}','\"DONE\"') WHERE channels->'acts'->>'token'=%s",(token,))
            assert c.rowcount==0
            c.execute('SELECT channels_before FROM samai_interrupted_admission_20261101');assert c.fetchall()==[(channels,)]
    finally:
        db.rollback()
        with db.cursor() as c:c.execute('DROP SCHEMA IF EXISTS '+schema+' CASCADE')
        db.commit();db.close()
