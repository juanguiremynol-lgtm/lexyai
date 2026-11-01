"""Actual trigger on disposable PostgreSQL; no provider or production traffic."""
import uuid
from pathlib import Path
import psycopg2


def test_commit_scoped_delivery_failure_retains_outbox():
    db=psycopg2.connect(host='/tmp',port=55439,dbname='postgres',user='ejcs1499')
    schema='lifecycle_test_'+uuid.uuid4().hex[:10]
    sql=Path('coordination/20261101_lifecycle_delivery.sql').read_text()
    fn='CREATE OR REPLACE FUNCTION '+sql.split('CREATE OR REPLACE FUNCTION ',1)[1].split('REVOKE ALL ON FUNCTION ',1)[0]
    fn=fn.replace('public.',schema+'.').replace('pg_catalog,public','pg_catalog,'+schema).replace('cron.job',schema+'.job')
    try:
        with db.cursor() as c:
            c.execute('CREATE SCHEMA '+schema)
            c.execute('SET search_path TO '+schema)
            c.execute('''CREATE TABLE job(jobid int,jobname text,active bool,command text);
              CREATE TABLE lifecycle_delivery_kicks_20261101(transaction_id bigint PRIMARY KEY,
               queued bool DEFAULT false,error_state text);
              CREATE TABLE gcp_lifecycle_outbox(id int);
              CREATE TABLE deliveries(id serial);''')
            c.execute("INSERT INTO job VALUES(75,'gcp-lifecycle-broadcaster',true,%s)",
              ('INSERT INTO '+schema+'.deliveries DEFAULT VALUES /* /functions/v1/gcp-lifecycle-broadcaster */',))
            c.execute(fn)
            c.execute('CREATE TRIGGER deliver AFTER INSERT ON gcp_lifecycle_outbox FOR EACH STATEMENT EXECUTE FUNCTION '+schema+'.kick_existing_lifecycle_broadcaster()')
            c.execute('INSERT INTO gcp_lifecycle_outbox VALUES(1);INSERT INTO gcp_lifecycle_outbox VALUES(2)')
            c.execute('SELECT count(*) FROM deliveries');assert c.fetchone()[0]==1
            c.execute('SELECT queued,error_state FROM lifecycle_delivery_kicks_20261101');assert c.fetchone()==(True,None)
            # A new subtransaction has the same transaction ID: no duplicate.
            c.execute('SAVEPOINT interrupted;INSERT INTO gcp_lifecycle_outbox VALUES(3)')
            c.execute('SELECT count(*) FROM deliveries');assert c.fetchone()[0]==1
            c.execute('DELETE FROM lifecycle_delivery_kicks_20261101')
            c.execute("UPDATE job SET command='SELECT 1/0 /* /functions/v1/gcp-lifecycle-broadcaster */'")
            c.execute('INSERT INTO gcp_lifecycle_outbox VALUES(4)')
            c.execute('SELECT count(*) FROM gcp_lifecycle_outbox');assert c.fetchone()[0]==4
            c.execute('SELECT queued,error_state FROM lifecycle_delivery_kicks_20261101');assert c.fetchone()==(False,'22012')
    finally:
        db.rollback();db.close()
