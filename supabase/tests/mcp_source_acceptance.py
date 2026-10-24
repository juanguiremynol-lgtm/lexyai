"""Source-specific and restore-at-cap assertions against local canonical functions only."""
import json
import psycopg2

c = psycopg2.connect(host="127.0.0.1", port=55442, user="lovable", dbname="postgres", sslmode="disable")
c.set_client_encoding("UTF8")
q = c.cursor()
u = "00000000-0000-0000-0000-000000000001"
s = "00000000-0000-0000-0000-000000000011"
org = "00000000-0000-0000-0000-000000000031"
checks = 0
def check(ok, name):
    global checks
    assert ok, name
    checks += 1
def owner():
    q.execute("RESET ROLE")
    q.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({"sub":u,"role":"authenticated","session_id":s}),))
    q.execute("SET LOCAL ROLE authenticated")
def maintenance():
    q.execute("RESET ROLE")
    q.execute("SELECT set_config('request.jwt.claims','{}',true)")
def denied(sql, args, state, prefix):
    q.execute("SAVEPOINT negative")
    try:
        q.execute(sql,args)
    except psycopg2.Error as e:
        q.execute("ROLLBACK TO SAVEPOINT negative")
        check(e.pgcode == state and e.diag.message_primary.startswith(prefix), f"wrong error {e.pgcode}/{e.diag.message_primary}")
    else:
        q.execute("ROLLBACK TO SAVEPOINT negative")
        raise AssertionError("unexpected success")
try:
    q.execute("BEGIN")
    q.execute("INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)",(s,u))
    q.execute("INSERT INTO organizations(id,name,max_monitored_items) VALUES(%s,'local cap',1)",(org,))
    q.execute("INSERT INTO work_items(owner_id,organization_id,workflow_type,stage,radicado,monitoring_disabled_by,monitoring_disabled_reason) VALUES(%s,%s,'CGP','DRAFTED','05001400300220990000100',NULL,NULL) RETURNING id",(u,org))
    active = q.fetchone()[0]
    q.execute("SELECT count(*) FROM work_items WHERE organization_id=%s AND monitoring_enabled",(org,))
    check(q.fetchone()[0]==1,"fixture is not at quota")
    # Lifecycle runs its real quota, invariant, ledger and outbox bodies.
    for wf,rad,by,reason in [
        ('PETICION','05001400300220990000200',None,None),
        ('GOV_PROCEDURE','05001400300220990000300',None,None),
        ('CGP',None,None,None),
        ('CGP','05001400300220990000400','USER','Explicit suspension'),
    ]:
        maintenance()
        q.execute("INSERT INTO work_items(owner_id,organization_id,workflow_type,stage,lifecycle_state,radicado,deleted_at,purge_after,monitoring_disabled_by,monitoring_disabled_reason) VALUES(%s,%s,%s,'DRAFTED','DELETED',%s,now(),now()+interval '10 days',%s,%s) RETURNING id",(u,org,wf,rad,by,reason))
        wi=q.fetchone()[0]
        owner()
        q.execute("SELECT set_work_item_lifecycle(%s,'ACTIVE','restore test','USER',NULL,'{}')",(wi,))
        check(q.fetchone()[0]['ok'] is True,f"restore failed {wf}")
        maintenance()
        q.execute("SELECT monitoring_enabled,lifecycle_state::text,monitoring_disabled_reason FROM work_items WHERE id=%s",(wi,))
        row=q.fetchone()
        check(row[0] is False and row[1]=='ACTIVE',f"nonmonitorable restore consumed quota {wf}")
        if by=='USER': check(row[2]==reason,"restore erased suspension")
        q.execute("SELECT count(*) FROM work_item_lifecycle_ledger l JOIN gcp_lifecycle_outbox o ON o.id=l.gcp_outbox_id WHERE l.work_item_id=%s AND o.work_item_id=l.work_item_id",(wi,))
        check(q.fetchone()[0]==1,"restore ledger not atomically bound")
    maintenance()
    q.execute("INSERT INTO work_items(owner_id,organization_id,workflow_type,stage,lifecycle_state,radicado) VALUES(%s,%s,'CGP','DRAFTED','ARCHIVED','05001400300220990000500') RETURNING id",(u,org))
    monitorable=q.fetchone()[0]
    owner()
    denied("SELECT set_work_item_lifecycle(%s,'ACTIVE','restore test','USER',NULL,'{}')",(monitorable,),"P0429","Monitoring limit reached")
    maintenance()
    q.execute("SELECT lifecycle_state::text FROM work_items WHERE id=%s",(monitorable,))
    check(q.fetchone()[0]=='ARCHIVED',"over-limit denial mutated lifecycle")
    # Old detected_at with new revision must appear, kinds stay separate.
    for i in range(5):
        q.execute("INSERT INTO work_item_acts(owner_id,work_item_id,description,detected_at,created_at,updated_at,is_archived) VALUES(%s,%s,%s,now()-interval '120 days',now()-interval '120 days',now()-interval '1 minute',false)",(u,active,f'fixture act {i}'))
    q.execute("INSERT INTO work_item_publicaciones(work_item_id,title,detected_at,created_at,updated_at,is_archived) VALUES(%s,'fixture estado',now()-interval '120 days',now()-interval '120 days',now()-interval '1 minute',true)",(active,))
    owner()
    q.execute("SELECT mcp_list_updates(NULL,2,%s)",(active,))
    page=q.fetchone()[0]; upper=page['scan_upper_watermark']; events=[]
    while True:
        events+=page['events']
        check(page['scan_upper_watermark']==upper,"pagination watermark drift")
        if not page['has_more']: break
        q.execute("SELECT mcp_list_updates(%s,2,%s)",(page['next_cursor'],active));page=q.fetchone()[0]
    check(len(events)==7,"equal timestamp pagination lost events (including lifecycle)")
    check(len({e['dedupe_key'] for e in events})==7,"page duplicates")
    check({'actuacion','estado','work_item_lifecycle'}=={e['kind'] for e in events},"source kinds collapsed")
    check(any(e['kind']=='estado' and e['data']['is_archived'] is True for e in events),"archive correction missing")
    checkpoint=page['checkpoint']; cursor=page['next_cursor']
    # Quiet poll in same transaction has same now/watermark; no checkpoint regression.
    q.execute("SELECT mcp_list_updates(%s,100,%s)",(cursor,active));quiet=q.fetchone()[0]
    check(quiet['checkpoint']==checkpoint,"quiet checkpoint changed")
    denied("SELECT mcp_list_updates('c9.invalid',2,%s)",(active,),"MCP22","CURSOR_INVALID")
    denied("SELECT mcp_list_updates(%s,2,NULL)",(cursor,),"MCP22","CURSOR_SCOPE_MISMATCH")
    maintenance()
    q.execute("UPDATE mcp_feed_cursors SET expires_at=now()-interval '1 day' WHERE id=%s",(cursor[3:],))
    owner()
    denied("SELECT mcp_list_updates(%s,2,%s)",(cursor,active),"MCP22","CURSOR_EXPIRED")
    # Freshness: distinct per-provider successes and latest failures even with no events.
    maintenance()
    for provider,op,status,age in [('cpnu','acts','success',4),('publicaciones','estados','success',3),('cpnu','acts','error',1)]:
        q.execute("INSERT INTO work_item_sync_timeline(work_item_id,provider,operation,status,created_at,started_at,finished_at) VALUES(%s,%s,%s,%s,now(),now()-%s*interval '1 hour',now()-%s*interval '1 hour')",(active,provider,op,status,age,age))
    owner()
    q.execute("SELECT _mcp_feed_freshness(%s,ARRAY[]::uuid[])",(active,));fresh=q.fetchone()[0]
    statuses={r['provider']:r for r in fresh['items'][0]['sync_checks']}
    check(statuses['cpnu']['status']=='error' and statuses['cpnu']['successful_check'] is False,"provider error promoted to success")
    check(statuses['cpnu']['last_success_at'] != statuses['publicaciones']['last_success_at'],"global matter success replaced source successes")
    # Global inbox question lists sibling metadata without bodies and conflicts.
    maintenance()
    for rank in [1,2]:
        q.execute("INSERT INTO work_item_email_links(user_id,work_item_id,internet_message_id,message_id,subject,link_status,received_at,created_at,evidence_meta,candidate_rank,confidence) VALUES(%s,%s,'local-imid','local-mid','Caso 05001400300220990000100','SUGGESTED',now(),now(),'{}',%s,0.9)",(u,active,rank))
    owner()
    q.execute("SELECT mcp_list_email_questions(NULL,1)");questions=q.fetchone()[0]
    check(len(questions['questions'])==1 and len(questions['questions'][0]['candidates'])==2,"message siblings not grouped")
    check(questions['questions'][0]['raw_subject_radicado_bases']==['050014003002209900001'],"raw subject base not parsed")
    check('body' not in questions['questions'][0]['source'],"message body exposed")
    print(json.dumps({'suite_status':'PASS','checks':checks,'failed':0,'suite':'source_and_restore_at_cap'}))
finally:
    c.rollback();c.close()