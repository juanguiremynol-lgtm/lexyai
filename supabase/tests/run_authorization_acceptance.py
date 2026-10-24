"""Run the whole reviewed SQL in one local connection and read JSON before ROLLBACK."""
import json
from pathlib import Path
import psycopg2

c = psycopg2.connect(host="127.0.0.1", port=55442, user="lovable", dbname="postgres", sslmode="disable")
c.set_client_encoding("UTF8")
q = c.cursor()
gates = """SELECT p.oid::regprocedure::text,has_function_privilege('authenticated',p.oid,'EXECUTE')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
('mcp_create_work_item','mcp_work_item_lifecycle','mcp_move_work_item_stage','mcp_resolve_stage_suggestion',
'mcp_resolve_alert','mcp_set_notification_state','mcp_resolve_email_question','mcp_add_email_association',
'mcp_resolve_detected_process','mcp_assign_work_item_radicado','mcp_update_work_item') ORDER BY 1"""
try:
    q.execute(gates)
    before = q.fetchall()
    assert len(before) == 11 and all(not open_gate for _, open_gate in before), "release gate is not closed"
    # psycopg2 exposes the final statement only: issue the final ROLLBACK separately,
    # in the SAME connection, after reading the exact final JSON SELECT.
    sql = Path("supabase/tests/authorization-acceptance.sql").read_text()
    end = sql.rindex("\nROLLBACK;")
    q.execute(sql[:end])
    result = q.fetchone()[0]
    print(json.dumps(result, ensure_ascii=False))
    c.rollback()
    q.execute(gates)
    assert q.fetchall() == before, "rollback did not restore all eleven gates"
    assert result["suite_status"] == "PASS" and result["failed"] == 0, "authorization assertions failed"
    print(f"PASS {result['checks']} independent assertions; JSON emitted before ROLLBACK; eleven gates restored")
finally:
    c.rollback()
    c.close()