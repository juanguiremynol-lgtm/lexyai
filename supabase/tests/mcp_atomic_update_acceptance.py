"""Rollback-only atomic update, runtime gates and equal-timestamp freshness."""
import json
import uuid
import psycopg2
c=psycopg2.connect(host='127.0.0.1',port=55442,user='lovable',dbname='postgres',sslmode='disable')
q=c.cursor();checks=0
def check(ok,label):
    global checks
    assert ok is True,label
    checks+=1
u,s,wi,client=[str(uuid.uuid4()) for _ in range(4)]
def owner():
    q.execute('RESET ROLE')
    q.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':u,'session_id':s,'role':'authenticated'}),))
    q.execute('SET LOCAL ROLE authenticated')
def snapshot():
    q.execute('RESET ROLE')
    q.execute('SELECT to_jsonb(w) FROM work_items w WHERE id=%s',(wi,));w=q.fetchone()[0]
    q.execute('SELECT count(*) FROM mcp_action_audit WHERE user_id=%s',(u,));a=q.fetchone()[0]
    q.execute('SELECT count(*) FROM mcp_idempotency WHERE user_id=%s',(u,));return w,a,q.fetchone()[0]
def call(patch,monitor=None,reason=None,key='atomic-update-test'):
    owner();q.execute('SELECT mcp_update_work_item(%s,%s::jsonb,%s,%s,%s)',(wi,json.dumps(patch),monitor,reason,key));return q.fetchone()[0]
def denied(patch,state,prefix):
    before=snapshot();owner();q.execute('SAVEPOINT bad')
    try:call(patch,False,'User pause')
    except psycopg2.Error as e:
        q.execute('ROLLBACK TO SAVEPOINT bad')
        check(e.pgcode==state and e.diag.message_primary.startswith(prefix),f'unexpected error {e.pgcode}/{e.diag.message_primary}')
    else:raise AssertionError('unexpected success')
    check(snapshot()==before,'failure left metadata, monitoring, audit or idempotency changes')
try:
    q.execute('BEGIN')
    q.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(s,u))
    q.execute("INSERT INTO work_items(id,owner_id,workflow_type,stage,title) VALUES(%s,%s,'CGP','DRAFTED','Before')",(wi,u))
    owner();q.execute('SELECT mcp_mutation_availability()');g=q.fetchone()[0]
    check(g['tools']['update_work_item']=={'available':False,'execution_available':False},'gate not reflected at runtime')
    q.execute('RESET ROLE');q.execute('GRANT EXECUTE ON FUNCTION mcp_update_work_item(uuid,jsonb,boolean,text,text) TO authenticated')
    denied({'client_id':client,'title':'Must not save'},'MCP04','NOT_FOUND: cliente')
    # Inject a later canonical pause update failure, proving earlier metadata rollback.
    q.execute("CREATE FUNCTION fixture_fail_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.monitoring_disabled_by='USER' THEN RAISE EXCEPTION 'LOCAL_PAUSE_FAILURE' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$")
    q.execute('CREATE TRIGGER aa_fixture_fail_pause BEFORE UPDATE ON work_items FOR EACH ROW EXECUTE FUNCTION fixture_fail_pause()')
    denied({'title':'Must roll back'},'P0001','LOCAL_PAUSE_FAILURE')
    q.execute('DROP TRIGGER aa_fixture_fail_pause ON work_items')
    saved=call({'title':'Saved'},False,'User pause','atomic-success-test')
    check(saved['work_item']['title']=='Saved' and saved['work_item']['monitoring_enabled'] is False,'combined commit failed')
    check(snapshot()[0]['monitoring_disabled_reason']=='User pause','canonical reason lost')
    check(call({'title':'Saved'},False,'User pause','atomic-success-test')['replayed'] is True,'retry not replayed')
    check(snapshot()[1:]==(1,1),'retry duplicated audit')
    resumed=call({},True,None,'atomic-resume-test')
    check(resumed['work_item']['monitoring_enabled'] is False and resumed['work_item']['monitoring_disabled_by']=='SYSTEM','unmonitorable resume falsely reported true')
    owner();q.execute('SELECT mcp_mutation_availability()');check(q.fetchone()[0]['tools']['update_work_item']['available'] is True,'opened local gate not reflected')
    q.execute('RESET ROLE')
    q.execute("INSERT INTO work_item_sync_timeline(id,work_item_id,provider,operation,status,created_at,started_at,finished_at) VALUES('00000000-0000-0000-0000-000000000001',%s,'cpnu','acts','success',now(),now(),now()),('ffffffff-ffff-ffff-ffff-ffffffffffff',%s,'cpnu','acts','error',now(),now(),now())",(wi,wi))
    owner();q.execute('SELECT _mcp_feed_freshness(%s,ARRAY[]::uuid[]),mcp_list_freshness_issues(NULL,50,%s)',(wi,wi));inline,pager=q.fetchone()
    check(inline['items'][0]['sync_checks'][0]['status']=='error','inline tie did not prefer highest ID')
    check(pager['items'][0]['sync_checks'][0]['status']==inline['items'][0]['sync_checks'][0]['status'],'inline/pager ties disagree')
    print(json.dumps({'suite':'atomic_update_runtime_ties','checks':checks,'failed':0,'status':'PASS','persistence':'ROLLBACK'}))
finally:c.rollback();c.close()