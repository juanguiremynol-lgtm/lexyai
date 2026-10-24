"""Multiple LOCAL connections; disposable cluster only, no hosted credentials."""
import json
import uuid
import psycopg2

def connect():
    return psycopg2.connect(host='127.0.0.1', port=55442, user='lovable', dbname='postgres', sslmode='disable')

setup, writer, reader = connect(), connect(), connect()
u, session, org, wi = [str(uuid.uuid4()) for _ in range(4)]
checks = 0
def check(value, label):
    global checks
    assert value is True, label
    checks += 1
def call(cursor=None, limit=500, since=None):
    q = reader.cursor()
    q.execute('RESET ROLE')
    q.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub':u,'session_id':session,'role':'authenticated'}),))
    q.execute('SET LOCAL ROLE authenticated')
    if since is None:
        q.execute('SELECT mcp_list_updates(%s,%s,%s)',(cursor,limit,wi))
    else:
        q.execute('SELECT mcp_reconcile_updates(%s,%s,%s)',(since,limit,wi))
    result = q.fetchone()[0]
    reader.commit()  # LOCAL cursor persistence across independently committed readers.
    return result
def insert(age, description):
    q = writer.cursor()
    q.execute("INSERT INTO work_item_acts(owner_id,work_item_id,description,updated_at,created_at,detected_at) VALUES(%s,%s,%s,now()-%s*interval '1 minute',now()-interval '60 days',now()-interval '60 days') RETURNING id",(u,wi,description,age))
    return str(q.fetchone()[0])
try:
    q = setup.cursor()
    q.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,u))
    q.execute("INSERT INTO organizations(id,name) VALUES(%s,'local concurrent feed')",(org,))
    q.execute("INSERT INTO work_items(id,owner_id,organization_id,workflow_type,stage,created_at,lifecycle_changed_at) VALUES(%s,%s,%s,'CGP','DRAFTED',now()-interval '60 days',now()-interval '60 days')",(wi,u,org))
    setup.commit()
    ids = [insert(2, 'equal revision '+str(i)) for i in range(4)]
    writer.commit()
    first = call(limit=2)
    check(first['has_more'] is True,'fixture must span pages')
    # Commit after the initial page with a revision newer than the fixed upper.
    during = insert(0,'committed during pagination')
    writer.commit()
    page, events = first, list(first['events'])
    while page['has_more']:
        page = call(page['next_cursor'],2)
        check(page['scan_upper_watermark']==first['scan_upper_watermark'],'watermark changed across transactions')
        events += page['events']
    check(set(ids).issubset({e['id'] for e in events}),'equal timestamps lost across connections')
    check(during not in {e['id'] for e in events},'post-watermark event included too early')
    overlap = call(page['next_cursor'])
    check(during in {e['id'] for e in overlap['events']},'next poll missed pagination-time commit')
    # Writer starts before reader, stays uncommitted during completed scan.
    late = insert(0,'uncommitted actual transaction')
    pending = call(overlap['next_cursor'])
    check(late not in {e['id'] for e in pending['events']},'uncommitted writer visible')
    writer.commit()
    recovered = call(pending['next_cursor'])
    check(late in {e['id'] for e in recovered['events']},'overlap missed actual late commit')
    # Clock-controlled revision models >15min transaction start. No 16-minute wait.
    too_late = insert(16,'clock-model beyond overlap')
    scanned = call(recovered['next_cursor'])
    writer.commit()
    missed = call(scanned['next_cursor'])
    check(too_late not in {e['id'] for e in missed['events']},'documented overlap bound differs')
    q.execute("SELECT now()-interval '17 minutes'")
    reconciled = call(since=q.fetchone()[0])
    check(too_late in {e['id'] for e in reconciled['events']},'bounded reconcile failed to recover delayed current row')
    # Unsupported version is checked on the public boundary, not token decoding.
    r = reader.cursor()
    r.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':u,'session_id':session,'role':'authenticated'}),))
    r.execute('SET LOCAL ROLE authenticated')
    try:
        r.execute('SELECT mcp_list_updates(%s,2,%s)',('c9.'+str(uuid.uuid4()),wi))
    except psycopg2.Error as e:
        check(e.pgcode=='MCP22' and e.diag.message_primary.startswith('CURSOR_INVALID'),'wrong unsupported-version denial')
        reader.rollback()
    else:
        raise AssertionError('unsupported version accepted')
    # Expire actual final storage row, preserve recovery hint (no silent restart).
    q.execute('UPDATE mcp_feed_cursors SET expires_at=now()-interval \'1 day\' WHERE id=%s',(missed['next_cursor'][3:],))
    setup.commit()
    try:
        call(missed['next_cursor'])
    except psycopg2.Error as e:
        check(e.pgcode=='MCP09' and e.diag.message_primary.startswith('CURSOR_EXPIRED: reconcilia con reconcile_since='),'wrong expiry boundary')
        reader.rollback()
    else:
        raise AssertionError('expired cursor restarted silently')
    print(json.dumps({'suite':'local_multisession_feed','status':'PASS','checks':checks,'failed':0,'clock_model':'16-minute revision age, not a 16-minute wall-clock transaction'}))
finally:
    for c in [setup,writer,reader]:
        c.rollback()
        c.close()