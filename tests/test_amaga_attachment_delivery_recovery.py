import json,re
from pathlib import Path
from test_reader_contract_recoveries import isolated

ROOT=Path(__file__).resolve().parents[1]

def test_exact_native_recovery_preserves_existing_copy_attempts_and_repeats_without_effect():
    sql=(ROOT/'coordination/20261101_amaga_attachment_delivery_recovery.sql').read_text()
    plan=json.loads(re.search(r'\$plan\$(.*?)\$plan\$',sql,re.S).group(1))
    admin,db,name=isolated()
    try:
        with db.cursor() as c:
            c.execute('''CREATE TABLE work_items(id uuid,radicado text,monitoring_enabled bool,lifecycle_state text,deleted_at timestamptz);
              CREATE TABLE work_item_publicaciones(id uuid,work_item_id uuid,organization_id uuid,raw_data jsonb,is_archived bool DEFAULT false);
              CREATE TABLE work_item_provider_enrollment(work_item_id uuid,provider_key text,scope text,enabled bool);
              CREATE TABLE estado_attachment_queue(id uuid DEFAULT gen_random_uuid(),work_item_id uuid,publicacion_id uuid,organization_id uuid,
                remote_url text,filename text,status text,attempt_count int,max_attempts int,next_retry_at timestamptz,
                UNIQUE(publicacion_id,remote_url));''')
            first=plan[0]
            c.execute("INSERT INTO work_items VALUES(%s,'05030318900120250000200',true,'ACTIVE',NULL)",(first['work_item_id'],))
            c.execute("INSERT INTO work_item_provider_enrollment VALUES(%s,'publicaciones','PUBS',true)",(first['work_item_id'],))
            for item in [plan[0],plan[2]]:
                raw={'article_id':item['article_id'],'asset_id':item['asset_id'] if item==plan[0] else 'different-native-identity'}
                c.execute('INSERT INTO work_item_publicaciones(id,work_item_id,organization_id,raw_data) VALUES(%s,%s,%s,%s)',
                    (item['publicacion_id'],item['work_item_id'],item['organization_id'],json.dumps(raw)))
            c.execute("INSERT INTO estado_attachment_queue(work_item_id,publicacion_id,organization_id,remote_url,status,attempt_count) VALUES(%s,%s,%s,%s,'downloaded',4)",
                (first['work_item_id'],first['publicacion_id'],first['organization_id'],first['remote_url']))
        db.commit()
        with db.cursor() as c:
            c.execute(sql)
            c.execute('SELECT count(*) FROM pp_amaga_attachment_recovery_20261101');assert c.fetchone()[0]==1
            c.execute('SELECT status,attempt_count FROM estado_attachment_queue WHERE remote_url=%s',(first['remote_url'],));assert c.fetchone()==('downloaded',4)
            c.execute(sql)
            c.execute('SELECT count(*) FROM estado_attachment_queue');assert c.fetchone()[0]==2
            c.execute('SELECT count(*) FROM work_item_publicaciones');assert c.fetchone()[0]==2
        db.commit()
    finally:
        db.close()
        with admin.cursor() as c:c.execute('DROP DATABASE '+name)
        admin.close()
