"""Exact cursor authority checks, same user/different OAuth clients, rollback-only."""
import json
import uuid
import psycopg2

c=psycopg2.connect(host='127.0.0.1',port=55442,user='lovable',dbname='postgres',sslmode='disable')
q=c.cursor(); checks=0
def check(v,name):
    global checks
    assert v is True,name
    checks+=1
def claims(v):
    q.execute('RESET ROLE');q.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps(v),));q.execute('SET LOCAL ROLE authenticated')
def denied(sql,args,state,prefix):
    q.execute('SAVEPOINT bad')
    try:q.execute(sql,args)
    except psycopg2.Error as e:
        q.execute('ROLLBACK TO SAVEPOINT bad')
        check(e.pgcode==state and e.diag.message_primary.startswith(prefix),f'wrong denial {e.pgcode}/{e.diag.message_primary}')
    else:
        q.execute('ROLLBACK TO SAVEPOINT bad');raise AssertionError('unexpected success')
try:
    q.execute('BEGIN')
    for role in ('anon', 'authenticated', 'mcp_feed_executor'):
        for privilege in ('TRUNCATE', 'REFERENCES', 'TRIGGER'):
            q.execute("SELECT has_table_privilege(%s,'public.mcp_feed_cursors',%s)", (role, privilege))
            check(q.fetchone()[0] is False, f'{role} retains {privilege}')
    q.execute("SELECT has_table_privilege('authenticated','public.mcp_feed_cursors','SELECT'),has_table_privilege('authenticated','public.mcp_feed_cursors','DELETE'),has_table_privilege('authenticated','public.mcp_feed_cursors','INSERT'),has_table_privilege('mcp_feed_executor','public.mcp_feed_cursors','INSERT')")
    check(q.fetchone() == (True, True, False, True), 'row privileges changed')
    u,s,a,b,sa,sb,org=[str(uuid.uuid4()) for _ in range(7)]
    q.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(s,u))
    for client,sid in [(a,sa),(b,sb)]:
        q.execute('INSERT INTO auth.oauth_clients(id) VALUES(%s)',(client,))
        q.execute('INSERT INTO auth.sessions(id,user_id,oauth_client_id) VALUES(%s,%s,%s)',(sid,u,client))
        q.execute('INSERT INTO auth.oauth_consents(id,user_id,client_id,granted_at) VALUES(gen_random_uuid(),%s,%s,now())',(u,client))
    q.execute("INSERT INTO organizations(id,name) VALUES(%s,'freshness paging fixture')",(org,))
    ids=[]
    for i in range(3):
        q.execute("INSERT INTO work_items(owner_id,organization_id,workflow_type,stage) VALUES(%s,%s,'CGP','DRAFTED') RETURNING id",(u,org)); wi=q.fetchone()[0];ids.append(str(wi))
        q.execute("INSERT INTO work_item_sync_timeline(work_item_id,provider,operation,status,created_at,started_at,finished_at,error_code) VALUES(%s,'cpnu','acts','error',now(),now(),now(),'LOCAL_FAIL')",(wi,))
    native={'sub':u,'session_id':s,'role':'authenticated'}
    claims({k:v for k,v in native.items() if k!='role'})
    q.execute('SELECT mcp_access_level(),mcp_write_allowed()');check(q.fetchone()==('none',False),'native missing role has write authority')
    denied('SELECT mcp_list_updates(NULL,2,NULL)',(), '42501','not authenticated')
    ca={'sub':u,'session_id':sa,'role':'authenticated','client_id':a};cb={**ca,'session_id':sb,'client_id':b}
    claims(ca)
    q.execute('SELECT mcp_list_updates(NULL,2,NULL)');issued=q.fetchone()[0];token=issued['next_cursor'];cid=token[3:]
    check(token.startswith('c1.'),'issued cursor missing')
    denied('INSERT INTO mcp_feed_cursors(user_id,client_key,mode,checkpoint) VALUES(%s,%s,\'incremental\',now())',(u,a),'42501','permission denied for table mcp_feed_cursors')
    denied('SELECT _mcp_feed_step(%s,NULL,\'incremental\',now(),\'\',%s,now(),now(),2)',(b,str(uuid.uuid4())),'42501','permission denied for function _mcp_feed_step')
    claims(cb)
    q.execute('SELECT count(*) FROM mcp_feed_cursors WHERE id=%s',(cid,));check(q.fetchone()[0]==0,'same user client B can read A cursor')
    q.execute('DELETE FROM mcp_feed_cursors WHERE id=%s',(cid,));check(q.rowcount==0,'client B deleted A cursor')
    denied('SELECT mcp_list_updates(%s,2,NULL)',(token,),'MCP22','CURSOR_INVALID:')
    claims(ca)
    q.execute('SELECT mcp_list_updates(%s,2,NULL)',(token,));check(q.fetchone()[0]['next_cursor'].startswith('c1.'),'issued cursor no longer functions')
    seen=[];after=None
    while True:
        q.execute('SELECT mcp_list_freshness_issues(%s,1,NULL)',(after,));page=q.fetchone()[0]
        seen.extend(str(x['work_item_id']) for x in page['items'])
        if not page['has_more']:break
        after=page['next_after']
    check(set(seen)==set(ids) and len(seen)==3,'freshness issue pages lost identifiers')
    q.execute("SELECT rolbypassrls,rolsuper,rolcanlogin FROM pg_roles WHERE rolname='mcp_feed_executor'");check(q.fetchone()==(False,False,False),'executor bypass/login permissions unsafe')
    q.execute("SELECT pg_has_role('authenticated','mcp_feed_executor','MEMBER')");check(q.fetchone()[0] is False,'authenticated can assume executor')
    print(json.dumps({'suite':'protected_cursor_storage','checks':checks,'status':'PASS','failed':0,'persistence':'ROLLBACK'}))
finally:
    c.rollback();c.close()