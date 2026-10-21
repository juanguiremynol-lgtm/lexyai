"""Disposable PostgreSQL; real repair SQL, fake judicial/notification fixtures.
Never points at production. The entire fixture transaction is rolled back.
"""
import json,pathlib,sys,uuid,psycopg2
ROOT=pathlib.Path(__file__).resolve().parents[2]
c=psycopg2.connect(host='127.0.0.1',port=55439,user='ejcs1499',dbname='postgres');q=c.cursor()
for role in ['anon','authenticated','service_role']:q.execute('CREATE ROLE '+role)
q.execute('CREATE TABLE work_items(id uuid PRIMARY KEY,total_actuaciones int,updated_at timestamptz DEFAULT now())')
q.execute('''CREATE TABLE work_item_acts(id uuid PRIMARY KEY,work_item_id uuid,organization_id uuid,owner_id uuid,source text,description text,act_date date,
 raw_data jsonb,documentos jsonb DEFAULT '[]',hash_fingerprint text,is_archived boolean DEFAULT false,is_canonical boolean DEFAULT true,
 canonical_at timestamptz DEFAULT now(),archived_reason text,archived_at timestamptz,archived_by uuid,updated_at timestamptz DEFAULT now());
 CREATE FUNCTION act_origin_components(text,jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$ SELECT jsonb_build_object('indice',coalesce($2->>'origen_indice',$2->>'indice')) $f$;
 CREATE UNIQUE INDEX native_identity ON work_item_acts(work_item_id,description,act_date,(act_origin_components(description,raw_data)->>'indice')) WHERE NOT is_archived;
 CREATE TABLE work_item_publicaciones(id uuid PRIMARY KEY,work_item_id uuid,organization_id uuid,source text,title text,published_at timestamptz,
 fecha_fijacion timestamptz,raw_data jsonb,pdf_storage_path text,pdf_url text,hash_fingerprint text,is_archived boolean DEFAULT false,is_canonical boolean DEFAULT true,archived_reason text);
 CREATE UNIQUE INDEX pub_identity ON work_item_publicaciones(work_item_id,title,(coalesce((published_at AT TIME ZONE 'UTC')::date,'1900-01-01'))) WHERE NOT is_archived;''')
for name in ['notifications','notification_dispatch_ledger','work_item_deadlines','work_item_hearings','hearings','deadline_discharge_suggestions','digest_document_tokens','calendar_event_tokens','estado_attachment_queue','pub_deadline_outcomes','trigger_error_log']:
 q.execute('CREATE TABLE '+name+'(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_item_id uuid,payload jsonb)')
q.execute('CREATE TABLE notification_user_state(notification_id uuid,user_id uuid,read_at timestamptz); CREATE TABLE alert_instances(id uuid,entity_id uuid,payload jsonb); CREATE TABLE work_item_act_extras(work_item_act_id uuid); CREATE TABLE act_provenance(work_item_act_id uuid)')
q.execute('''CREATE FUNCTION test_count() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE work_items SET total_actuaciones=(SELECT count(*) FROM work_item_acts WHERE work_item_id=NEW.work_item_id AND NOT is_archived) WHERE id=NEW.work_item_id;RETURN NEW;END$$;
 CREATE TRIGGER trg_update_actuaciones_count AFTER UPDATE OF is_archived ON work_item_acts FOR EACH ROW EXECUTE FUNCTION test_count();
 CREATE FUNCTION test_deadline() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NOT NEW.is_archived THEN INSERT INTO work_item_deadlines(work_item_id,payload) VALUES(NEW.work_item_id,jsonb_build_object('unexpected_calculation',NEW.id));END IF;RETURN NEW;END$$;
 CREATE TRIGGER trg_compute_deadline_on_act AFTER UPDATE OF raw_data,is_archived ON work_item_acts FOR EACH ROW EXECUTE FUNCTION test_deadline();''')
q.execute((ROOT/'coordination/reconciliation-20261021/repair.sql').read_text())
wi,org,owner,old,new=[str(uuid.uuid4()) for _ in range(5)]
q.execute('INSERT INTO work_items VALUES(%s,2,now())',(wi,));q.execute("INSERT INTO work_item_acts(id,work_item_id,organization_id,owner_id,source,description,act_date,raw_data,hash_fingerprint) VALUES(%s,%s,%s,%s,'cpnu','Auto - exact','2026-01-01',%s,'old'),(%s,%s,%s,%s,'cpnu','Auto - exact','2026-01-01',%s,'new')",(old,wi,org,owner,json.dumps({'indice':'6'}),new,wi,org,owner,json.dumps({'origen_indice':'106713346','indice':'106713346','_idProceso':'3272913431'})))
q.execute("INSERT INTO controlled_public_repair_20261021(id,kind,canonical_id,work_item_id,classification,evidence,before_row,before_canonical) SELECT %s,'ACT',%s,%s,'copia_demostrada',%s,to_jsonb(d),to_jsonb(o) FROM work_item_acts d CROSS JOIN work_item_acts o WHERE d.id=%s AND o.id=%s",(new,old,wi,json.dumps({'native_act':'106713346','official':{'_idProceso':'3272913431'}}),new,old))
q.execute('SAVEPOINT original')
q.execute('SELECT repair_controlled_public_pair_20261021(%s)',(new,));assert q.fetchone()[0]['protected_unchanged']
q.execute('SELECT repair_controlled_public_pair_20261021(%s)',(new,));assert not q.fetchone()[0]['changed']
q.execute('SELECT count(*) FROM work_item_deadlines');assert q.fetchone()[0]==0
q.execute("SELECT tgenabled FROM pg_trigger WHERE tgname='trg_compute_deadline_on_act'");assert q.fetchone()[0]=='O'
q.execute('SELECT repair_controlled_public_pair_20261021(%s,true)',(new,));assert q.fetchone()[0]['changed']
q.execute("SELECT raw_data->>'indice',is_archived FROM work_item_acts WHERE id=%s",(old,));assert q.fetchone()==('6',False)
q.execute('SELECT total_actuaciones FROM work_items WHERE id=%s',(wi,));assert q.fetchone()[0]==2
q.execute('ROLLBACK TO SAVEPOINT original')
q.execute("UPDATE work_item_acts SET description='new unrelated text' WHERE id=%s",(new,))
q.execute('SAVEPOINT changed')
try:q.execute('SELECT repair_controlled_public_pair_20261021(%s)',(new,));raise AssertionError('CAS accepted changed row')
except psycopg2.Error:q.execute('ROLLBACK TO SAVEPOINT changed')
q.execute('ROLLBACK TO SAVEPOINT original')
# Date correction resolves a genuine duplicate; preserves original and canonical.
pub,canon=str(uuid.uuid4()),str(uuid.uuid4())
q.execute("INSERT INTO work_item_publicaciones(id,work_item_id,organization_id,source,title,published_at,raw_data,pdf_storage_path,hash_fingerprint) VALUES(%s,%s,%s,'publicaciones','Same','0131-10-01',%s,'original/path','unchanged'),(%s,%s,%s,'publicaciones','Same',NULL,%s,'canonical/path','canonical')",(pub,wi,org,'{"fecha_publicacion":"sin-fecha"}',canon,wi,org,'{}'))
q.execute("INSERT INTO controlled_public_repair_20261021(id,kind,canonical_id,work_item_id,classification,evidence,before_row,before_canonical) SELECT %s,'PUB',%s,%s,'copia_demostrada','{\"pdfs_identical\":true}',to_jsonb(d),to_jsonb(o) FROM work_item_publicaciones d CROSS JOIN work_item_publicaciones o WHERE d.id=%s AND o.id=%s",(pub,canon,wi,pub,canon))
q.execute('SELECT repair_controlled_public_pair_20261021(%s)',(pub,));assert q.fetchone()[0]['protected_unchanged']
q.execute('SELECT published_at,is_archived,pdf_storage_path,hash_fingerprint FROM work_item_publicaciones WHERE id=%s',(pub,));assert q.fetchone()==(None,True,'original/path','unchanged')
q.execute('SELECT repair_controlled_public_pair_20261021(%s)',(pub,));assert not q.fetchone()[0]['changed']
q.execute('SELECT repair_controlled_public_pair_20261021(%s,true)',(pub,));assert q.fetchone()[0]['changed']
q.execute("SELECT has_function_privilege('authenticated','repair_controlled_public_pair_20261021(uuid,boolean)','EXECUTE')");assert not q.fetchone()[0]
c.rollback();print('PASS local PostgreSQL: pair archive/native convergence, no term recalculation, trigger restored, count convergence, exact rollback, CAS rejection, unknown-date/native duplicate correction, unchanged PDF references/fingerprints, idempotence and private access; no production writes')
