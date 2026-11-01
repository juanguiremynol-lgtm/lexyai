"""Current production RPC shape, isolated PG; no production data or portals."""
import json,os,uuid
from pathlib import Path
import psycopg2
from psycopg2.extensions import parse_dsn

ROOT=Path(__file__).resolve().parents[1]

def test_rpc_returns_exact_persisted_id_for_retained_fingerprint_without_privilege_drift():
    p=parse_dsn(os.environ['MONITOR_RECOVERY_TEST_DSN'])
    assert p.get('host') in ('/tmp','127.0.0.1') and p.get('port')=='55439'
    admin=psycopg2.connect(**p);admin.autocommit=True
    name='test_pub_receipt_'+uuid.uuid4().hex[:10]
    with admin.cursor() as c:c.execute('CREATE DATABASE '+name)
    db=psycopg2.connect(**{**p,'dbname':name})
    db.set_client_encoding('UTF8')
    try:
        with db.cursor() as c:
            c.execute('''CREATE TABLE work_item_publicaciones(
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_item_id uuid,organization_id uuid,
             source text,title text,annotation text,pdf_url text,entry_url text,pdf_available bool,
             published_at timestamptz,fecha_fijacion timestamptz,fecha_providencia timestamptz,
             tipo_publicacion text,hash_fingerprint text,raw_data jsonb,date_source text,date_confidence text,
             raw_schema_version text,sources text[],detected_at timestamptz,last_seen_at timestamptz,
             content_hash text,source_radicado text,recurso_consecutivo text,instancia_grado text,
             is_archived bool DEFAULT false,updated_at timestamptz,
             UNIQUE(work_item_id,hash_fingerprint));
             CREATE FUNCTION safe_jsonb_to_text_array(j jsonb) RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY(SELECT jsonb_array_elements_text(j)) $$;
             CREATE FUNCTION canon_normalize_title(t text) RETURNS text LANGUAGE sql AS $$ SELECT lower(trim(t)) $$;
             CREATE FUNCTION canon_strip_title_noise(t text) RETURNS text LANGUAGE sql AS $$ SELECT t $$;
             CREATE FUNCTION samai_publication_merge_evidence(a jsonb,b jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(a,'{}')||coalesce(b,'{}') $$;''')
            c.execute((ROOT/'tests/fixtures/publication_rpc_before_reader_identity.sql').read_text())
            c.execute('REVOKE ALL ON FUNCTION rpc_upsert_work_item_publicaciones(jsonb) FROM PUBLIC; GRANT EXECUTE ON FUNCTION rpc_upsert_work_item_publicaciones(jsonb) TO service_role')
            c.execute("SELECT proacl::text FROM pg_proc WHERE proname='rpc_upsert_work_item_publicaciones'");acl=c.fetchone()[0]
            migration=(ROOT/'supabase/migrations/20261101010000_publication_attachment_receipt_identity.sql').read_text()
            c.execute(migration)
            c.execute("SELECT proacl::text FROM pg_proc WHERE proname='rpc_upsert_work_item_publicaciones'");assert c.fetchone()[0]==acl
            row={'work_item_id':str(uuid.uuid4()),'organization_id':str(uuid.uuid4()),'source':'publicaciones','title':'Estado 034',
              'published_at':'2026-10-13T05:00:00Z','tipo_publicacion':'estado','hash_fingerprint':'original-short',
              'source_radicado':'05030318900120250000200','raw_data':{'article_id':'source-034'}}
            c.execute('SELECT rpc_upsert_work_item_publicaciones(%s::jsonb)',(json.dumps([row]),));first=c.fetchone()[0]
            assert first['inserted_count']==1 and first['persisted_publicacion_id']
            row['hash_fingerprint']='new-long-fingerprint'
            c.execute('SELECT rpc_upsert_work_item_publicaciones(%s::jsonb)',(json.dumps([row]),));repeat=c.fetchone()[0]
            assert repeat['skipped_count']==1 and repeat['structural_count']==1
            assert repeat['persisted_publicacion_id']==first['persisted_publicacion_id']
            c.execute('SELECT hash_fingerprint FROM work_item_publicaciones');assert c.fetchall()==[('original-short',)]
            c.execute('SELECT id FROM work_item_publicaciones WHERE id=%s AND work_item_id=%s AND organization_id=%s',
              (repeat['persisted_publicacion_id'],row['work_item_id'],str(uuid.uuid4())))
            assert c.fetchall()==[]
            c.execute(migration)
            c.execute('SELECT count(*) FROM work_item_publicaciones');assert c.fetchone()[0]==1
            c.execute('SELECT rpc_upsert_work_item_publicaciones(%s::jsonb)',(json.dumps([row,row]),));assert c.fetchone()[0]['persisted_publicacion_id'] is None
            row['published_at']='not-a-date'
            c.execute('SELECT rpc_upsert_work_item_publicaciones(%s::jsonb)',(json.dumps([row]),));bad=c.fetchone()[0]
            assert bad['error_count']==1 and bad['persisted_publicacion_id'] is None
        db.commit()
    finally:
        db.close()
        with admin.cursor() as c:c.execute('DROP DATABASE '+name)
        admin.close()
