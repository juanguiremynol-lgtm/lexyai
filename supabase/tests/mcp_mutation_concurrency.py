"""Real overlapping transactions, exclusively in the disposable loopback cluster.

Local commits are required so two sessions can see fixtures/results. Explicit
cleanup plus the runner's cluster-destruction trap removes all synthetic state.
No hosted connection, credentials, provider or communication is used.
"""
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import psycopg2

def connect():
    return psycopg2.connect(host="127.0.0.1", port=55442, user="lovable", dbname="postgres", sslmode="disable")

setup, winner, loser = connect(), connect(), connect()
u, session, org, wi, a, b = [str(uuid.uuid4()) for _ in range(6)]
keys = [str(uuid.uuid4()) for _ in range(5)]
checks = 0
def check(ok, message):
    global checks
    assert ok is True, message
    checks += 1

def caller(c):
    q = c.cursor()
    q.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({"sub": u, "role": "authenticated", "session_id": session}),))
    q.execute("SET LOCAL ROLE authenticated")
    q.execute("SET LOCAL statement_timeout='8s'")
    return q

def overlap(sql, args1, args2, expected=None):
    first = caller(winner)
    first.execute(sql, args1)
    result = first.fetchone()[0]
    second = caller(loser)
    second.execute("SELECT pg_backend_pid()")
    pid = second.fetchone()[0]
    def competing():
        try:
            second.execute(sql, args2)
            value = second.fetchone()[0]
            loser.commit()
            return (value, None, None)
        except psycopg2.Error as error:
            loser.rollback()
            return (None, error.pgcode, error.diag.message_primary)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(competing)
        blocked = False
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            q = setup.cursor()
            q.execute("SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s", (pid,))
            row = q.fetchone()
            setup.commit()
            if row and row[0] == "Lock":
                blocked = True
                break
            if future.done(): break
            time.sleep(0.02)
        check(blocked, "competing transaction never overlapped on a real lock")
        winner.commit()
        other, state, message = future.result(timeout=9)
    if expected:
        check(other is None and state == expected[0] and message is not None and message.startswith(expected[1]), f"unexpected denial {state}/{message}")
    else:
        check(state is None and other is not None and other.get("replayed") is True, "same-key create was not replayed")
        check(other["work_item"]["id"] == result["work_item"]["id"], "same-key create produced another result")
    return result

def counts(action, key):
    q = setup.cursor()
    q.execute("SELECT (SELECT count(*) FROM mcp_action_audit WHERE user_id=%s AND action=%s AND idem_key=%s),(SELECT count(*) FROM mcp_idempotency WHERE user_id=%s AND action=%s AND idem_key=%s)", (u, action, key, u, action, key))
    return q.fetchone()

try:
    q = setup.cursor()
    q.execute("GRANT EXECUTE ON FUNCTION mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text),mcp_resolve_email_question(uuid,text,text),mcp_move_work_item_stage(uuid,text,timestamptz,text[],text,text) TO authenticated")
    # Current manual-move wrapper; helpers were loaded from canonical 0072 source.
    sql = Path("drizzle/migrations/0072_mcp_manual_stage_email_questions_freshness.sql").read_text()
    start = sql.index("CREATE OR REPLACE FUNCTION public.mcp_move_work_item_stage(")
    end = sql.index("END $function$;", start) + len("END $function$;")
    q.execute(sql[start:end])
    q.execute("INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)", (session, u))
    q.execute("INSERT INTO organizations(id,name) VALUES(%s,'local mutation concurrency')", (org,))
    q.execute("INSERT INTO work_items(id,owner_id,organization_id,workflow_type,stage,cgp_phase,cgp_phase_source,updated_at) VALUES(%s,%s,%s,'CGP','RADICADO','FILING','MANUAL',now()-interval '1 hour')", (wi,u,org))
    q.execute("INSERT INTO work_item_email_links(id,user_id,work_item_id,internet_message_id,message_id,subject,link_status,evidence_meta,conflict_flag) VALUES(%s,%s,%s,%s,'synthetic-message','synthetic','SUGGESTED','{}',false),(%s,%s,%s,%s,'synthetic-message','synthetic','SUGGESTED','{}',false)", (a,u,wi,u,b,u,wi,u))
    setup.commit()
    sql = "SELECT mcp_create_work_item('CGP',NULL,NULL,'Concurrent synthetic',NULL,NULL,NULL,NULL,NULL,%s)"
    created = overlap(sql, (keys[0],), (keys[0],))
    check(counts("create_work_item", keys[0]) == (1,1), "same-key creation duplicated audit or idempotency")
    q.execute("SELECT count(*) FROM work_items WHERE owner_id=%s AND title='Concurrent synthetic'", (u,))
    check(q.fetchone()[0] == 1, "same-key creation duplicated matter")
    email = overlap("SELECT mcp_resolve_email_question(%s,%s,%s)", (a,"confirm",keys[1]), (b,"dismiss",keys[2]), ("MCP09", "ALREADY_RESOLVED: no hay sugerencias pendientes"))
    check(email["confirmed_link_id"] == a, "email winner not confirmed")
    q.execute("SELECT id::text,link_status FROM work_item_email_links WHERE user_id=%s ORDER BY id", (u,))
    check(dict(q.fetchall()) == {a:"CONFIRMED", b:"DISMISSED"}, "losing email decision changed winner state")
    check(counts("resolve_email_question",keys[1]) == (1,1) and counts("resolve_email_question",keys[2]) == (0,0), "losing email decision left audit/idempotency")
    q.execute("SELECT updated_at FROM work_items WHERE id=%s", (wi,))
    rev = q.fetchone()[0]
    stage = overlap("SELECT mcp_move_work_item_stage(%s,%s,%s,NULL,%s,%s)", (wi,"ADMISION",rev,keys[3],"explicit move"), (wi,"NOTIFICACION",rev,keys[4],"competing move"), ("MCP09", "STALE_REVISION: el asunto cambió"))
    q.execute("SELECT stage,updated_at,last_stage_change_source FROM work_items WHERE id=%s", (wi,))
    row = q.fetchone()
    check(row[0] == stage["work_item"]["stage"] == "ADMISION" and row[1] != rev and row[2] == "MANUAL_USER", "stage loser changed winning state/version")
    q.execute("SELECT count(*) FROM work_item_stage_audit WHERE work_item_id=%s", (wi,))
    check(q.fetchone()[0] == 1, "stage loser added stage audit")
    check(counts("move_stage", keys[3]) == (1,1) and counts("move_stage", keys[4]) == (0,0), "stage loser left action audit/idempotency")
    print(json.dumps({"suite":"local_overlapping_mutations", "checks":checks, "status":"PASS", "failed":0, "overlap":"observed PostgreSQL Lock wait in all three cases"}))
finally:
    winner.rollback(); loser.rollback()
    winner.close(); loser.close()
    setup.rollback()
    q = setup.cursor()
    # Cleanup only this randomly-scoped local fixture, never hosted data.
    q.execute("DELETE FROM work_item_stage_audit WHERE work_item_id IN (SELECT id FROM work_items WHERE owner_id=%s)", (u,))
    q.execute("DELETE FROM work_item_email_links WHERE user_id=%s", (u,))
    q.execute("DELETE FROM work_item_reminders WHERE owner_id=%s", (u,))
    q.execute("DELETE FROM fixture_enrollment WHERE work_item_id IN (SELECT id FROM work_items WHERE owner_id=%s)", (u,))
    q.execute("DELETE FROM work_items WHERE owner_id=%s", (u,))
    q.execute("DELETE FROM mcp_action_audit WHERE user_id=%s", (u,))
    q.execute("DELETE FROM mcp_idempotency WHERE user_id=%s", (u,))
    q.execute("DELETE FROM auth.sessions WHERE user_id=%s", (u,))
    q.execute("DELETE FROM organizations WHERE id=%s", (org,))
    q.execute("REVOKE EXECUTE ON FUNCTION mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text),mcp_resolve_email_question(uuid,text,text),mcp_move_work_item_stage(uuid,text,timestamptz,text[],text,text) FROM authenticated")
    setup.commit()
    q.execute("SELECT (SELECT count(*) FROM work_items WHERE owner_id=%s)+(SELECT count(*) FROM mcp_action_audit WHERE user_id=%s)+(SELECT count(*) FROM mcp_idempotency WHERE user_id=%s)+(SELECT count(*) FROM auth.sessions WHERE user_id=%s)", (u,u,u,u))
    assert q.fetchone()[0] == 0, "local cleanup left synthetic state"
    setup.close()