"""Canonical stage RPC positives and exact negatives; transaction-local grants."""
import json
import uuid
import psycopg2

c = psycopg2.connect(host='127.0.0.1',port=55442,user='lovable',dbname='postgres',sslmode='disable')
q = c.cursor()
checks = 0
def check(value, name):
    global checks
    assert value is True, name
    checks += 1
def denied(sql,args,state,prefix):
    q.execute('SAVEPOINT negative')
    try:
        q.execute(sql,args)
    except psycopg2.Error as e:
        q.execute('ROLLBACK TO SAVEPOINT negative')
        check(e.pgcode==state and e.diag.message_primary.startswith(prefix),f'unexpected denial {e.pgcode}/{e.diag.message_primary}')
    else:
        q.execute('ROLLBACK TO SAVEPOINT negative')
        raise AssertionError('unexpected success')
def revision(wi):
    q.execute('SELECT updated_at FROM work_items WHERE id=%s',(wi,))
    return q.fetchone()[0]
def move(wi,to,reason=None):
    q.execute('SELECT mcp_move_work_item_stage(%s,%s,%s,ARRAY[\'NO_EXISTE\'],%s,%s)',(wi,to,revision(wi),str(uuid.uuid4()),reason))
    return q.fetchone()[0]
try:
    q.execute('BEGIN')
    q.execute('GRANT EXECUTE ON FUNCTION mcp_move_work_item_stage(uuid,text,timestamptz,text[],text,text) TO authenticated')
    u,s,org,wi,pet = [str(uuid.uuid4()) for _ in range(5)]
    q.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(s,u))
    q.execute("INSERT INTO organizations(id,name) VALUES(%s,'stage fixture')",(org,))
    q.execute("INSERT INTO work_items(id,owner_id,organization_id,workflow_type,stage,cgp_phase,cgp_phase_source) VALUES(%s,%s,%s,'CGP','RADICADO','FILING','MANUAL')",(wi,u,org))
    q.execute("INSERT INTO workflow_definitions VALUES('PETICION',true,true)")
    q.execute("INSERT INTO workflow_stages_global VALUES('PETICION','A',true,1),('PETICION','B',true,2),('PETICION','C',true,3)")
    q.execute("INSERT INTO workflow_stage_transitions VALUES('PETICION',true,'A','B',false),('PETICION',true,'B','A',true)")
    q.execute("INSERT INTO work_items(id,owner_id,organization_id,workflow_type,stage) VALUES(%s,%s,%s,'PETICION','A')",(pet,u,org))
    q.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':u,'role':'authenticated','session_id':s}),))
    q.execute('SET LOCAL ROLE authenticated')
    stale = revision(wi)
    move(wi,'ADMISION')
    q.execute('SELECT cgp_phase::text,cgp_phase_source::text,last_stage_change_source,last_stage_change_by_user_id::text FROM work_items WHERE id=%s',(wi,))
    check(q.fetchone()==('PROCESS','MANUAL','MANUAL_USER',u),'forward phase/markers differ')
    q.execute('SELECT count(*) FROM work_item_stage_audit WHERE work_item_id=%s AND new_cgp_phase=\'PROCESS\'',(wi,))
    check(q.fetchone()[0]==1,'audit not inserted atomically')
    sql='SELECT mcp_move_work_item_stage(%s,%s,%s,%s,%s,%s)'
    denied(sql,(wi,'RADICADO',revision(wi),None,'stage-no-reason',None),'MCP22','REASON_REQUIRED:')
    move(wi,'RADICADO','User requests correction')
    q.execute('SELECT stage,cgp_phase::text FROM work_items WHERE id=%s',(wi,))
    check(q.fetchone()==('RADICADO','FILING'),'valid cross-phase regression blocked')
    before = revision(wi)
    denied(sql,(wi,'NO_EXISTE',before,['NO_EXISTE'],'stage-arbitrary','User requests change'),'MCP22','INVALID_STAGE:')
    denied(sql,(wi,'ADMISION',stale,None,'stage-stale',None),'MCP09','STALE_REVISION:')
    check(revision(wi)==before,'negative cases mutated version')
    move(pet,'B')
    denied(sql,(pet,'A',revision(pet),None,'stage-catalog-reason',None),'MCP22','REASON_REQUIRED:')
    move(pet,'A','User-authorized backward move')
    check(move(pet,'B')['validated_by']=='catalog_transition','live transition not authoritative')
    denied(sql,(pet,'C',revision(pet),['A','B','C'],'stage-invented-transition',None),'MCP22','TRANSITION_NOT_ALLOWED:')
    print(json.dumps({'suite':'canonical_manual_stage','status':'PASS','checks':checks,'failed':0,'persistence':'ROLLBACK'}))
finally:
    c.rollback()
    c.close()