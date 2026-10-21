"""Disposable localhost test only; no judicial records or external calls."""
from pathlib import Path
import psycopg2
c=psycopg2.connect(host='127.0.0.1',port=55439,dbname='postgres',user='pgtest',sslmode='disable')
c.set_client_encoding('UTF8');q=c.cursor()
q.execute("CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE TABLE public.notifications(id uuid PRIMARY KEY,user_id uuid,org_id uuid,audience_scope text,read_at timestamptz,dismissed_at timestamptz); GRANT SELECT ON public.notifications TO authenticated; ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY; CREATE POLICY visible ON public.notifications TO authenticated USING(user_id=auth.uid() OR (audience_scope='ORG_ADMIN' AND org_id='00000000-0000-0000-0000-000000000001'));")
q.execute(Path('drizzle/migrations/0047_notification_user_state.sql').read_text())
q.execute(Path('drizzle/migrations/0048_notification_personal_read_isolation.sql').read_text())
a='00000000-0000-0000-0000-00000000000a';b='00000000-0000-0000-0000-00000000000b';n='00000000-0000-0000-0000-00000000000c';private='00000000-0000-0000-0000-00000000000d'
q.execute("INSERT INTO notifications VALUES(%s,NULL,'00000000-0000-0000-0000-000000000001','ORG_ADMIN',NULL,NULL),(%s,%s,NULL,'USER',NULL,NULL)",(n,private,a))
def user(u):
 q.execute('SET LOCAL ROLE authenticated');q.execute("SELECT set_config('test.uid',%s,true)",(u,))
def action(id,act,until=None):
 q.execute('SELECT notification_id FROM set_notification_user_state(ARRAY[%s]::uuid[],%s,%s::timestamptz)',(id,act,until));assert q.fetchone()[0]==id
user(a);action(n,'snooze','2099-01-01');q.execute('SELECT count(*) FROM notification_inbox WHERE id=%s',(n,));assert q.fetchone()[0]==0
user(b);q.execute('SELECT count(*) FROM notification_inbox WHERE id=%s',(n,));assert q.fetchone()[0]==1
q.execute('SAVEPOINT forbidden')
try:
 action(private,'dismiss');raise AssertionError('other user notification accepted')
except psycopg2.Error:q.execute('ROLLBACK TO SAVEPOINT forbidden')
user(a);action(n,'dismiss');action(n,'snooze','2099-02-01');q.execute('SELECT dismissed_at IS NOT NULL FROM notification_user_state WHERE notification_id=%s',(n,));assert q.fetchone()[0]
q.execute('RESET ROLE');q.execute("UPDATE notifications SET read_at=now() WHERE id=%s",(n,))
user(a);q.execute('SELECT count(*) FROM notification_inbox WHERE id=%s',(n,));assert q.fetchone()[0]==0
user(b);q.execute('SELECT count(*) FROM notification_inbox WHERE id=%s',(n,));assert q.fetchone()[0]==1
q.execute('SELECT effective_read_at FROM notification_inbox WHERE id=%s',(n,));assert q.fetchone()[0] is None
q.execute('RESET ROLE');q.execute('SELECT count(*) FROM notifications');assert q.fetchone()[0]==2
c.rollback();print('PASS: per-user org dismissal/snooze, reload/resync retained, other-user denied, history preserved')
