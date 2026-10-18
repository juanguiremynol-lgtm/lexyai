"""Isolated integration run of the REAL sync-by-work-item/index.ts against a
local Postgres (production schema-only dump, synthetic data) + local PostgREST.
No hosted services, no production data, no deploy."""
import json, os, subprocess, time, urllib.request, sys

T = "/tmp/itest"
WI = "33333333-3333-3333-3333-333333333333"
SVC = open(f"{T}/svc.jwt").read().strip()
ENV_CLEAN = {k: v for k, v in os.environ.items() if not k.startswith("PG") and k != "SUPABASE_DB_URL"}
procs = []
OUT = []

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, env=ENV_CLEAN)

def sql(q):
    r = subprocess.run([f"{T}/lpsql", "-d", "sync_run", "-At", "-F", "|", "-c", q], capture_output=True, text=True)
    if r.returncode != 0 or "ERROR" in r.stderr:
        raise RuntimeError(r.stderr)
    return [l.split("|") for l in r.stdout.strip().splitlines() if l]

def http(url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})}, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")

def start(cmd, log):
    p = subprocess.Popen(cmd, shell=True, stdout=open(log, "w"), stderr=subprocess.STDOUT, env=ENV_CLEAN, start_new_session=True)
    procs.append(p)

def wait_ok(url, body=None, tries=60):
    for _ in range(tries):
        try:
            http(url, body, timeout=3); return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"not up: {url}")

def ctl(**kw):
    return http("http://127.0.0.1:54321/__ctl", kw)[1]

def reset(extra_sql=None):
    r = sh(f"{T}/lpsql -d postgres -c 'drop database if exists sync_run with (force)' -c 'create database sync_run template sync_itest'")
    if r.returncode: raise RuntimeError(r.stderr)
    if extra_sql: sql(extra_sql)
    ctl(faults={"rpcUpsert": 0, "readBack": 0, "readBackMissing": 0, "rpcUpsertOnFp": ""}, resetLog=True)
    # A database reset closes pooled connections; readiness means a real row
    # can be read through PostgREST, not merely that the HTTP port is open.
    for _ in range(60):
        try:
            st, data = http(f"http://127.0.0.1:54321/rest/v1/work_items?id=eq.{WI}&select=id",
                            headers={"Authorization": f"Bearer {SVC}"}, timeout=3)
            if st == 200 and isinstance(data, list) and any(row.get("id") == WI for row in data):
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("PostgREST did not read the synthetic work item after database reset")

def sync():
    st, body = http("http://127.0.0.1:8000", {"work_item_id": WI, "_scheduled": True, "force_refresh": True},
                    {"Authorization": f"Bearer {SVC}"}, timeout=180)
    return st, body

def acts():
    return sql("select id, hash_fingerprint, raw_data->>'origen_solicitud', raw_data->>'origen_indice', left(raw_data->>'anotacion',60), coalesce(jsonb_array_length(documentos),-1), raw_data->'anotacion_reparada' is not null from work_item_acts where work_item_id='%s' and not is_archived order by created_at, id" % WI)

def novedades():
    a = sql(f"select count(*) from alert_instances where entity_id='{WI}'")[0][0]
    n = sql("select count(*) from notifications")[0][0]
    return int(a), int(n)

# ── synthetic SAMAI texts (structure of the real feed, invented parties/numbers)
def memorial(sol, hora, anexos, nombre):
    return (f"El Señor(a):{nombre} con vinculación al proceso: ApodDdo - ENTIDAD SINTETICA, a través de la ventanilla virtual, "
            f"radicó la solicitud No. {sol} tipo: Recepción de Memoriales de fecha: 16/10/2026 {hora}, donde solicitó: "
            f"Presentación de memorial o escrito Radicado: 99999233300020260000100 Vinculación: ApodDdo Documentos anexos: {anexos} . "
            f"Se realiza la siguiente gestión: MEMORIAL SINTETICO - {anexos} archivos")
A = memorial("9000001", "16:12:08", 6, "PERSONA SINTETICA UNO")
B = memorial("9000002", "10:46:42", 2, "PERSONA SINTETICA DOS CON NOMBRE MAS LARGO PARA SUPERAR LA LONGITUD DE A")
TITLE = "RECIBE MEMORIALES ONLINE"
def item(text, indice=None, url=None):
    d = {"Fecha Providencia": "2026-10-16T00:00:00.000Z", "Actuación": TITLE, "Docum. a notif.": text,
         "url_descarga": url, "pdf_url": None, "anexos": None}
    if indice is not None: d["indice"] = indice
    return d
def feed(*items): ctl(samai={"actuaciones": list(items)})

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f" :: {detail}" if detail else ""), flush=True)

try:
    start("nix run nixpkgs#postgrest -- postgrest.conf", f"{T}/postgrest.log")
    start(f"deno run -A {T}/gateway.ts", f"{T}/gateway.log")
    wait_ok("http://127.0.0.1:54321/__ctl")
    reset()
    start(f"{T}/runfn.sh", f"{T}/fn.log")
    wait_ok("http://127.0.0.1:8000", {"health_check": True})
    time.sleep(2)

    # S1 — two solicitudes, same day, same title
    reset(); feed(item(A), item(B))
    st, r = sync(); rows = acts(); nv1 = novedades()
    print("S1 resp", st, {k: r.get(k) for k in ("ok", "inserted_count", "skipped_count", "errors", "code", "message")} if isinstance(r, dict) else r)
    sols = sorted(x[2] for x in rows)
    check("S1 two acts, one per solicitud", len(rows) == 2 and sols == ["9000001", "9000002"], str(rows))
    check("S1 no text mixing", all((x[2] == "9000001") == ("9000001" in x[4] or "UNO" in x[4]) for x in rows), str([x[4] for x in rows]))
    print("S1 novedades (alerts, notifications):", nv1)

    # S2 — repeat the same batch
    st, r = sync(); rows2 = acts(); nv2 = novedades()
    check("S2 repeat → no new rows", len(rows2) == 2 and [x[1] for x in rows2] == [x[1] for x in rows], str(r.get("inserted_count")))
    check("S2 repeat → no new novedades", nv2 == nv1, f"{nv1}->{nv2}")

    # S3 — indice appears later; fingerprints unchanged
    feed(item(A, indice=133), item(B, indice=132))
    st, r = sync(); rows3 = acts(); nv3 = novedades()
    check("S3 indice later → same 2 rows, fingerprints kept", len(rows3) == 2 and [x[1] for x in rows3] == [x[1] for x in rows], str(rows3))
    check("S3 indice recorded on matched rows", sorted(x[3] for x in rows3) == ["132", "133"], str([x[3] for x in rows3]))
    check("S3 no new novedades", nv3 == nv1, f"{nv1}->{nv3}")

    # S4 — enrichment within one batch (A linkless then A with URL) + no degradation later
    URL = "https://storage.googleapis.com/andromeda-cpnu-documentos-2026/itest/a.pdf"
    reset(); feed(item(A), item(A, url=URL), item(B))
    st, r = sync(); rows4 = acts(); log = ctl()["log"]
    a4 = [x for x in rows4 if x[2] == "9000001"]
    check("S4 repeated act in batch → single row", len(a4) == 1 and len(rows4) == 2, str(rows4))
    check("S4 documentos enriched on REAL row", a4 and a4[0][5] == "1", str(a4))
    check("S4 no update to pending:* ids / no errors", not any("pending:" in json.dumps(e) for e in (r.get("errors") or [])) and not r.get("errors"), str(r.get("errors")))
    feed(item(A), item(B))
    st, r = sync(); a4b = [x for x in acts() if x[2] == "9000001"]
    check("S4 later linkless run does not degrade documentos", a4b and a4b[0][5] == "1", str(a4b))

    # S5a — transport failure of the first upsert, then same act repeated in batch
    reset(); feed(item(A), item(A), item(B))
    ctl(faults={"rpcUpsert": 1})
    st, r = sync(); rows5 = acts(); nv5 = novedades()
    print("S5a resp", {k: r.get(k) for k in ("inserted_count", "skipped_count", "errors")})
    check("S5a failed write reported as error", any("injected upsert failure" in str(e) for e in (r.get("errors") or [])), str(r.get("errors")))
    check("S5a no duplicate, repeat retried as insert", len(rows5) == 2, str(rows5))
    # S5b — DB-level exception inside the RPC → savepoint rollback, not counted
    reset("create function itest_boom() returns trigger language plpgsql as $$ begin if new.raw_data->>'anotacion' like '%9000002%' then raise exception 'itest forced failure'; end if; return new; end $$; create trigger itest_boom before insert on work_item_acts for each row execute function itest_boom();")
    feed(item(A), item(B))
    st, r = sync(); rows5b = acts(); nv5b = novedades()
    print("S5b resp", {k: r.get(k) for k in ("inserted_count", "skipped_count", "errors")})
    check("S5b failing row rolled back (no partial row)", [x[2] for x in rows5b] == ["9000001"], str(rows5b))
    check("S5b failure not counted as success/skip", r.get("inserted_count") == 1 and any("9000002" in str(e) or "not persisted" in str(e).lower() or "itest forced" in str(e) for e in (r.get("errors") or [])), f"ins={r.get('inserted_count')} skip={r.get('skipped_count')} err={r.get('errors')}")
    sql("drop trigger itest_boom on work_item_acts")
    st, r = sync(); rows5c = acts()
    check("S5c next run inserts the previously failed act once", sorted(x[2] for x in rows5c) == ["9000001", "9000002"], str(rows5c))

    # S6 — actual A write commits, read-back fails/misses, then distinct B.
    # Assert the RPC count, not just row count: the structural index could
    # otherwise hide an erroneous attempt to persist B with A's fingerprint.
    for fault in ("readBack", "readBackMissing"):
        reset(); feed(item(A), item(B))
        ctl(faults={fault: 1})
        st, r = sync(); rows6 = acts(); log6 = ctl()["log"]
        rpc6 = [entry for entry in log6 if entry.startswith("POST /rpc/rpc_upsert_work_item_acts ")]
        check(f"S6 {fault}: A committed, B not written", len(rows6) == 1 and rows6[0][2] == "9000001", str(rows6))
        check(f"S6 {fault}: abort before B RPC", rpc6 == ["POST /rpc/rpc_upsert_work_item_acts 200"], str(log6))
        check(f"S6 {fault}: failed response names read-back", st == 500 and "read-back" in json.dumps(r).lower(), str(r))
        OUT.append({"S6_fault": fault, "response": r, "rows": rows6, "gateway_log": log6})
        # The next run must load A's real UUID and preserve its fingerprint.
        st, r = sync(); recovered = acts()
        check(f"S6 {fault}: next run retains A UUID/fingerprint", st == 200 and any(x[:2] == rows6[0][:2] for x in recovered), str(recovered))

    # S7 — pagination: target row on page 2 (>1000 existing acts)
    reset()
    sql(f"""insert into work_item_acts (id, work_item_id, owner_id, organization_id, act_date, description, hash_fingerprint, source, raw_data)
        select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '{WI}', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
               date '2020-01-01' + g, 'ACTO SINTETICO ' || g, 'itest_fp_' || g, 'samai', jsonb_build_object('anotacion', 'x')
        from generate_series(1, 1050) g""")
    feed(item(A))
    st, r = sync(); before = len(acts())
    st, r = sync(); after = len(acts())
    check("S7 >1000 existing acts: resync does not duplicate", after == before == 1051, f"{before}->{after}")
    log = ctl()["log"]

    # S8 — contaminated historical row is NOT repaired; omitted solicitud inserted → novedad
    reset()
    sql(f"""insert into work_item_acts (id, work_item_id, owner_id, organization_id, act_date, description, event_summary, hash_fingerprint, source, raw_data)
        values ('ffffffff-0000-0000-0000-000000000001', '{WI}', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        '2026-10-16', $${TITLE} - {A}$$, left($${TITLE} - {B}$$, 500), 'PLACEHOLDER', jsonb_build_object('actuacion', '{TITLE}', 'anotacion', $${B}$$))""")
    # fingerprint as production v1 would compute it: take it from a clean run's first row
    base_nv = novedades()
    feed(item(A), item(B))
    st, r = sync(); rows8 = acts(); nv8 = novedades()
    print("S8 rows", rows8, "novedades", base_nv, "->", nv8)
    contaminated = [x for x in rows8 if x[0] == "ffffffff-0000-0000-0000-000000000001"]
    check("S8 contaminated row text untouched (no repair)", contaminated and "DOS" in contaminated[0][4] and contaminated[0][6] == "f", str(contaminated))
    OUT.append({"S8_rows": rows8, "S8_novedades": [base_nv, nv8], "S8_resp": {k: r.get(k) for k in ("inserted_count", "skipped_count", "errors")}})
finally:
    for p in procs:
        try: os.killpg(p.pid, 15)
        except Exception: pass
    json.dump({"results": results, "extra": OUT}, open(f"{T}/results.json", "w"), indent=1, default=str)
    print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed")
