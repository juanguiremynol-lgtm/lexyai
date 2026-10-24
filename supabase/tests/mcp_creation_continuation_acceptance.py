"""Rollback-only creation -> radicado continuation on the disposable local cluster.

Uses canonical creation SQL, existing invariant/quota/assignment bodies, and synthetic
authenticated sessions. Enrollment is a fixture stand-in, not provider certification.
"""
import json
from pathlib import Path
import psycopg2

c = psycopg2.connect(host="127.0.0.1", port=55442, user="lovable", dbname="postgres", sslmode="disable")
c.set_client_encoding("UTF8")
q = c.cursor()
uid = "00000000-0000-0000-0000-000000000001"
sid = "00000000-0000-0000-0000-000000000011"
org = "00000000-0000-0000-0000-000000000031"
checks = 0

def check(ok, name):
    global checks
    assert ok, name
    checks += 1

def owner():
    q.execute("RESET ROLE")
    q.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({"sub": uid, "role": "authenticated", "session_id": sid}),))
    q.execute("SET LOCAL ROLE authenticated")

def state(wi):
    q.execute("RESET ROLE")
    q.execute("SELECT to_jsonb(w) FROM work_items w WHERE id=%s", (wi,))
    row = q.fetchone()[0]
    q.execute("SELECT count(*) FROM mcp_action_audit")
    audit = q.fetchone()[0]
    q.execute("SELECT count(*) FROM mcp_idempotency")
    return row, audit, q.fetchone()[0]

def create(reason, key):
    owner()
    q.execute("SELECT mcp_create_work_item('CGP',NULL,NULL,'Synthetic continuation',NULL,NULL,NULL,NULL,%s,%s)", (reason, key))
    return q.fetchone()[0]

def assign(wi, digits, rev, key):
    owner()
    q.execute("SELECT mcp_assign_work_item_radicado(%s,%s,%s::timestamptz,%s)", (wi, digits, rev, key))
    return q.fetchone()[0]

try:
    q.execute("BEGIN")
    # Use the canonical unchanged creation body, not the fixture's reminder shortcut.
    sql = Path("drizzle/migrations/0068_mcp_release_blocker_hardening.sql").read_text()
    start = sql.index("CREATE OR REPLACE FUNCTION public.mcp_create_work_item(")
    end = sql.index("END $function$;", start) + len("END $function$;")
    q.execute(sql[start:end])
    q.execute("GRANT EXECUTE ON FUNCTION mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text),mcp_assign_work_item_radicado(uuid,text,timestamptz,text) TO authenticated")
    q.execute("INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)", (sid, uid))
    q.execute("INSERT INTO organizations(id,name,max_monitored_items) VALUES(%s,'synthetic quota',0)", (org,))
    normal = create(None, "continuation-create-001")
    wi = normal["work_item"]["id"]
    row, _, _ = state(wi)
    check(row["radicado"] is None and row["monitoring_enabled"] is False, "no-radicado creation must be unmonitored")
    check(row["monitoring_disabled_by"] == "SYSTEM" and row["monitoring_disabled_reason"] == "PENDIENTE_DE_RADICACION", "automatic reason was mislabeled USER")
    check(normal["initial_sync_enqueued"] == [], "no-radicado creation claimed queued provider hydration")
    check(create(None, "continuation-create-001")["replayed"] is True, "creation retry did not replay")
    check(state(wi)[1:] == (1, 1), "creation retry duplicated audit or idempotency")
    q.execute("UPDATE work_items SET organization_id=%s WHERE id=%s", (org, wi))
    before = state(wi)
    rev = before[0]["updated_at"]
    owner()
    q.execute("SAVEPOINT quota_denial")
    try:
        assign(wi, "05001400300220990009100", rev, "continuation-assign-001")
    except psycopg2.Error as error:
        q.execute("ROLLBACK TO SAVEPOINT quota_denial")
        check(error.pgcode == "P0429" and error.diag.message_primary.startswith("Monitoring limit reached"), "unexpected quota-denial contract")
    else:
        raise AssertionError("assignment exceeded monitored quota")
    check(state(wi) == before, "quota failure changed identity, audit or idempotency")
    q.execute("UPDATE organizations SET max_monitored_items=1 WHERE id=%s", (org,))
    saved = assign(wi, "05001400300220990009100", rev, "continuation-assign-001")
    row, _, _ = state(wi)
    check(row["radicado"] == "05001400300220990009100", "23-digit identity lost leading zero")
    check(row["monitoring_enabled"] is True and row["monitoring_disabled_by"] is None and row["monitoring_disabled_reason"] is None, "automatic pending state blocked eligible monitoring")
    check(row["stage"] == before[0]["stage"] and row["workflow_type"] == "CGP" and row["cgp_phase"] == "FILING" and row["lifecycle_state"] == "ACTIVE", "assignment changed stage, workflow or lifecycle")
    check(saved["synced"] is False and saved["synchronization"] == "scheduled_pending", "assignment falsely claimed synchronization")
    check(assign(wi, "05001400300220990009100", rev, "continuation-assign-001")["replayed"] is True, "assignment retry did not replay")
    check(state(wi)[1:] == (2, 2), "assignment retry duplicated audit or idempotency")
    q.execute("SELECT radicado FROM fixture_enrollment WHERE work_item_id=%s", (wi,))
    check(q.fetchone()[0] == row["radicado"], "enrollment fixture did not receive saved identity")
    # Explicit native-user suspension is separate from automatic noneligibility.
    paused = create("Cliente pidió pausar", "continuation-paused-001")
    pw = paused["work_item"]["id"]
    row, _, _ = state(pw)
    check(row["monitoring_disabled_by"] == "USER" and row["monitoring_disabled_reason"] == "Cliente pidió pausar", "genuine USER pause not persisted")
    q.execute("UPDATE work_items SET organization_id=%s WHERE id=%s", (org, pw))
    rev = state(pw)[0]["updated_at"]
    assign(pw, "05001400300220990009200", rev, "continuation-paused-assign-001")
    row, _, _ = state(pw)
    check(row["monitoring_enabled"] is False and row["monitoring_disabled_by"] == "USER" and row["monitoring_disabled_reason"] == "Cliente pidió pausar", "assignment erased genuine USER suspension at full quota")
    check(row["radicado"] == "05001400300220990009200", "paused assignment did not save identity")
    check(state(pw)[1:] == (4, 4), "create/assign audit was not exactly once")
    print(json.dumps({"suite_status": "PASS", "checks": checks, "failed": 0, "suite": "creation_continuation", "enrollment": "fixture_only"}))
finally:
    c.rollback()
    c.close()