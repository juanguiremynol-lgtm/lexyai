"""Run independent feed SQL locally, exposing its JSON before rollback."""
import json
from pathlib import Path
import psycopg2

c = psycopg2.connect(host="127.0.0.1", port=55442, user="lovable", dbname="postgres", sslmode="disable")
c.set_client_encoding("UTF8")
try:
    q = c.cursor()
    sql = Path("supabase/tests/feed-acceptance.sql").read_text()
    q.execute(sql[:sql.rindex("\nROLLBACK;")])
    result = q.fetchone()[0]
    print(json.dumps(result, ensure_ascii=False))
    assert result['failed'] == 0 and result['status'] == 'PASS', 'feed acceptance failed'
finally:
    c.rollback()
    c.close()