"""Local-only synthetic MCP acceptance. No ambient PG credentials or external providers.

Run after preparing a disposable fixture on loopback port 55441:
python3 supabase/tests/mcp_operational_acceptance.py
Every assertion runs inside BEGIN/ROLLBACK. Unexpected SQL errors fail the run.
"""
import json
import psycopg2

c = psycopg2.connect(host="127.0.0.1", port=55441, user="lovable", dbname="postgres", sslmode="disable")
c.set_client_encoding("UTF8")
q = c.cursor()
uid = "00000000-0000-0000-0000-000000000001"
other = "00000000-0000-0000-0000-000000000002"
sid = "00000000-0000-0000-0000-000000000011"
wi = "00000000-0000-0000-0000-000000000021"
org = "00000000-0000-0000-0000-000000000031"
checks = 0

def check(value, message):
    global checks
    assert value, message
    checks += 1

def caller(user=uid, session=sid, client=None):
    claims = {"sub": user, "role": "authenticated", "session_id": session}
    if client:
        claims["client_id"] = client
    q.execute("RESET ROLE")
    q.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps(claims),))
    q.execute("SET LOCAL ROLE authenticated")

def assign(radicado="05001-40-03-002-2099-00001-00", rev="2026-10-24T19:59:00Z", key="assign-test-0001"):
    q.execute("SELECT public.mcp_assign_work_item_radicado(%s,%s,%s::timestamptz,%s)", (wi, radicado, rev, key))
    return q.fetchone()[0]

def snapshot():
    q.execute("RESET ROLE")
    q.execute("SELECT to_jsonb(w) FROM work_items w WHERE id=%s", (wi,))
    row = q.fetchone()[0]
    q.execute("SELECT count(*) FROM mcp_action_audit")
    audit = q.fetchone()[0]
    q.execute("SELECT count(*) FROM mcp_idempotency")
    idem = q.fetchone()[0]
    return row, audit, idem

def deny(state, prefix, action):
    before = snapshot()
    q.execute("SET LOCAL ROLE authenticated")
    q.execute("SAVEPOINT denial")
    try:
        action()
    except psycopg2.Error as error:
        q.execute("ROLLBACK TO SAVEPOINT denial")
        check(error.pgcode == state and error.diag.message_primary.startswith(prefix), f"expected {state}/{prefix}, got {error.pgcode}/{error.diag.message_primary}")
    else:
        raise AssertionError("denied call succeeded")
    check(snapshot() == before, "denial mutated matter, audit or idempotency")

try:
    q.execute("BEGIN")
    q.execute("INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)", (sid, uid))
    q.execute("INSERT INTO organizations(id,max_monitored_items) VALUES(%s,1)", (org,))
    q.execute("INSERT INTO work_items(id,owner_id,organization_id,workflow_type,stage,lifecycle_state,status,updated_at,monitoring_disabled_reason,monitoring_disabled_by) VALUES(%s,%s,%s,'CGP','DRAFTED','ACTIVE','ACTIVE','2026-10-24T19:59:00Z','PENDIENTE_DE_RADICACION','USER')", (wi, uid, org))
    q.execute("GRANT EXECUTE ON FUNCTION mcp_assign_work_item_radicado(uuid,text,timestamptz,text) TO authenticated")
    caller()
    deny("MCP22", "el radicado debe tener exactamente", lambda: assign("123"))
    deny("MCP09", "STALE_REVISION", lambda: assign(rev="2026-10-23T00:00:00Z"))
    caller(other)
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("INSERT INTO auth.sessions(id,user_id) VALUES('00000000-0000-0000-0000-000000000012',%s)", (other,))
    caller(other, "00000000-0000-0000-0000-000000000012")
    deny("MCP04", "NOT_FOUND", lambda: assign())
    caller(session="00000000-0000-0000-0000-000000000099")
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("UPDATE auth.sessions SET not_after=now()-interval '1 day' WHERE id=%s", (sid,))
    caller()
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("UPDATE auth.sessions SET not_after=NULL WHERE id=%s", (sid,))
    caller(client="00000000-0000-0000-0000-000000000041")
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    # Real 0071 client/consent-generation logic, not a fake app grant override.
    oc = "00000000-0000-0000-0000-000000000041"
    osid = "00000000-0000-0000-0000-000000000051"
    consent = "00000000-0000-0000-0000-000000000061"
    q.execute("RESET ROLE")
    q.execute("INSERT INTO auth.oauth_clients(id) VALUES(%s)", (oc,))
    q.execute("INSERT INTO auth.sessions(id,user_id,oauth_client_id,scopes) VALUES(%s,%s,%s,'openid')", (osid, uid, oc))
    q.execute("INSERT INTO auth.oauth_consents(id,user_id,client_id,granted_at) VALUES(%s,%s,%s,now())", (consent, uid, oc))
    caller(session=osid, client=oc)
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("INSERT INTO mcp_client_grants(user_id,oauth_client_id,consent_id,consent_granted_at,access_level) VALUES(%s,%s,%s,now(),'manage')", (uid, oc, consent))
    q.execute("UPDATE auth.sessions SET scopes='openid andromeda:read' WHERE id=%s", (osid,))
    caller(session=osid, client=oc)
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("UPDATE auth.sessions SET scopes='openid' WHERE id=%s", (osid,))
    q.execute("UPDATE auth.oauth_clients SET deleted_at=now() WHERE id=%s", (oc,))
    caller(session=osid, client=oc)
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("UPDATE auth.oauth_clients SET deleted_at=NULL WHERE id=%s", (oc,))
    q.execute("UPDATE mcp_client_grants SET revoked_at=now() WHERE oauth_client_id=%s", (oc,))
    caller(session=osid, client=oc)
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("UPDATE mcp_client_grants SET revoked_at=NULL WHERE oauth_client_id=%s", (oc,))
    q.execute("UPDATE auth.oauth_consents SET granted_at=now()+interval '1 second' WHERE id=%s", (consent,))
    caller(session=osid, client=oc)
    deny("MCP01", "MCP_MANAGE_GRANT_REQUIRED", lambda: assign())
    for lifecycle in ("ARCHIVED", "DELETED"):
        q.execute("RESET ROLE")
        q.execute("UPDATE work_items SET lifecycle_state=%s WHERE id=%s", (lifecycle, wi))
        caller()
        deny("MCP09", "ACTIVE_REQUIRED", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("UPDATE work_items SET lifecycle_state='ACTIVE' WHERE id=%s", (wi,))
    q.execute("INSERT INTO work_items(id,owner_id,workflow_type,stage,lifecycle_state,radicado,deleted_at) VALUES('00000000-0000-0000-0000-000000000022',%s,'CGP','DRAFTED','DELETED','05001400300220990000100',now())", (uid,))
    caller()
    deny("MCP09", "DUPLICATE_IN_TRASH", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("UPDATE work_items SET radicado='05001400300220990000200',lifecycle_state='ACTIVE',deleted_at=NULL,organization_id=%s WHERE id='00000000-0000-0000-0000-000000000022'", (org,))
    caller()
    deny("P0429", "Monitoring limit reached", lambda: assign())
    q.execute("RESET ROLE")
    q.execute("UPDATE organizations SET max_monitored_items=2 WHERE id=%s", (org,))
    caller()
    saved = assign()
    check(saved["work_item"]["radicado"] == "05001400300220990000100", "leading zero lost")
    check(saved["synced"] is False and saved["synchronization"] == "scheduled_pending", "falsely synchronized")
    check(saved["work_item"]["stage"] == "DRAFTED" and saved["work_item"]["workflow_type"] == "CGP" and saved["work_item"]["lifecycle_state"] == "ACTIVE", "stage/workflow/lifecycle changed")
    check(saved["work_item"]["radicado_verified"] is False and saved["work_item"]["scrape_status"] == "NOT_ATTEMPTED" and saved["work_item"]["consecutive_404_count"] == 0, "telemetry not reset")
    check(saved["work_item"]["monitoring_enabled"] is True, "missing-identity sentinel blocked monitoring")
    replay = assign()
    check(replay["replayed"] is True, "retry was not replayed")
    check(snapshot()[1:] == (1, 1), "retry duplicated audit or idempotency")
    q.execute("SELECT radicado FROM fixture_enrollment WHERE work_item_id=%s", (wi,))
    check(q.fetchone()[0] == "05001400300220990000100", "existing enrollment trigger did not run")
    caller()
    deny("MCP09", "IDEMPOTENCY_KEY_REUSED", lambda: assign(key="assign-test-0001", radicado="05001400300220990000300"))
    caller()
    deny("MCP09", "RADICADO_ALREADY_SET", lambda: assign(key="assign-test-0002"))
    # 30 newest dismissed + 32 older outstanding. State of another user must never join.
    q.execute("RESET ROLE")
    q.execute("INSERT INTO notifications(id,user_id,title,created_at) SELECT gen_random_uuid(),%s,'new-dismissed-'||g,now()+g*interval '1 second' FROM generate_series(1,30) g RETURNING id", (uid,))
    ids = [r[0] for r in q.fetchall()]
    q.executemany("INSERT INTO notification_user_state(notification_id,user_id,dismissed_at) VALUES(%s,%s,now())", [(n, uid) for n in ids])
    q.execute("INSERT INTO notifications(id,user_id,title,created_at) SELECT gen_random_uuid(),%s,'older-unread-'||g,now()-interval '1 day' FROM generate_series(1,32) g RETURNING id", (uid,))
    older = [r[0] for r in q.fetchall()]
    q.executemany("INSERT INTO notification_user_state(notification_id,user_id,dismissed_at,read_at) VALUES(%s,%s,now(),now())", [(n, other) for n in older])
    caller()
    q.execute("SELECT mcp_list_notifications(30,false,NULL)")
    first = q.fetchone()[0]
    check(len(first["notifications"]) == 30 and first["has_more"] is True, "dismissed newest hid outstanding")
    check(all(n["read_at"] is None and n["dismissed_at"] is None for n in first["notifications"]), "foreign state leaked")
    q.execute("SELECT mcp_list_notifications(30,false,%s)", (first["next_cursor"],))
    second = q.fetchone()[0]
    check(len(second["notifications"]) == 2 and second["has_more"] is False and second["next_cursor"] is None, "equal timestamp continuation lost rows")
    check(not {n["id"] for n in first["notifications"]} & {n["id"] for n in second["notifications"]}, "duplicate page rows")
    q.execute("SELECT mcp_list_notifications(30,true,NULL)")
    check(all(n["title"].startswith("new-dismissed") for n in q.fetchone()[0]["notifications"]), "include dismissed compatibility")
    caller()
    deny("MCP22", "CURSOR_INVALID", lambda: q.execute("SELECT mcp_list_notifications(30,true,%s)", (first["next_cursor"],)))
    caller(other, "00000000-0000-0000-0000-000000000012")
    deny("MCP22", "CURSOR_INVALID", lambda: q.execute("SELECT mcp_list_notifications(30,false,%s)", (first["next_cursor"],)))
    caller()
    q.execute("RESET ROLE")
    q.execute("REVOKE SELECT ON notification_user_state FROM authenticated")
    q.execute("SET LOCAL ROLE authenticated")
    deny("42501", "permission denied", lambda: q.execute("SELECT mcp_list_notifications(30,false,NULL)"))
    print(f"PASS {checks} concrete checks; synthetic local fixtures; rolled back")
finally:
    c.rollback()
    c.close()