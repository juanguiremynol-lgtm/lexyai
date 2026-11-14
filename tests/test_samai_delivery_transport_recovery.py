"""Run the scoped transport recovery SQL with local, counted HTTP calls."""
import os,uuid
from pathlib import Path
import psycopg2
from psycopg2.extensions import parse_dsn


def test_exact_sql_dispatches_once_and_recovers_prepared_unsent_row():
    cfg=parse_dsn(os.environ['SAMAI_FIJACION_TEST_DSN'])
    assert cfg.get('host') in ('/tmp','127.0.0.1') and cfg.get('port')=='55439'
    schema='samai_delivery_'+uuid.uuid4().hex[:12]
    db=psycopg2.connect(**cfg)
    sql=Path('coordination/20261101_samai_delivery_transport_recovery.sql').read_text()
    sql=sql.replace('public.',schema+'.').replace('net.http_post','http_post').replace('vault.decrypted_secrets','secrets')
    sql='\n'.join(line for line in sql.splitlines() if not line.startswith('REVOKE '))
    try:
        with db.cursor() as c:
            c.execute('CREATE SCHEMA '+schema);c.execute('SET search_path TO '+schema)
            c.execute('CREATE TABLE work_items(id uuid,radicado text,lifecycle_state text,monitoring_enabled bool,deleted_at timestamptz)')
            c.execute('CREATE TABLE samai_delivery_acceptance_20261101(work_item_id uuid,radicado text,admitted_at timestamptz,source_read_at timestamptz)')
            c.execute('CREATE TABLE work_item_sync_timeline(work_item_id uuid,operation text,provider text,started_at timestamptz)')
            c.execute('CREATE TABLE atenia_ai_remediation_queue(work_item_id uuid,action_type text,status text)')
            c.execute('CREATE TABLE secrets(name text,decrypted_secret text)')
            c.execute("INSERT INTO secrets VALUES('SUPABASE_URL','https://fixture.invalid'),('CRON_SERVICE_KEY','local-fixture')")
            c.execute('CREATE TABLE calls(id bigserial,body jsonb)')
            c.execute("CREATE FUNCTION http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) RETURNS bigint LANGUAGE sql AS 'INSERT INTO calls(body) VALUES($3) RETURNING id'")
            wid=str(uuid.uuid4());c.execute("INSERT INTO work_items VALUES(%s,'exact-fixture','ACTIVE',true,NULL)",(wid,))
            c.execute("INSERT INTO samai_delivery_acceptance_20261101 VALUES(%s,'exact-fixture',pg_postmaster_start_time()-interval '1 hour',now())",(wid,))
            c.execute(sql)
            c.execute(sql)
            c.execute('SELECT count(*) FROM calls');assert c.fetchone()[0]==1
            c.execute('SELECT request_id FROM samai_delivery_transport_20261101');assert c.fetchone()[0]==1
            # A prepared audit with no dispatched request is recoverable once.
            c.execute('UPDATE samai_delivery_transport_20261101 SET request_id=NULL')
            c.execute(sql);c.execute(sql)
            c.execute('SELECT count(*) FROM calls');assert c.fetchone()[0]==2
    finally:
        db.rollback()
        with db.cursor() as c:c.execute('DROP SCHEMA IF EXISTS '+schema+' CASCADE')
        db.commit();db.close()
