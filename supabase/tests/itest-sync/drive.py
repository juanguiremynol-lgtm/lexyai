"""Isolated integration run of the REAL sync-by-work-item/index.ts against a
local Postgres (production schema-only dump, synthetic data) + local PostgREST.
No hosted services, no production data, no deploy."""
import json, os, subprocess, time, urllib.request, sys, fcntl

T = "/tmp/itest"
lock = open(f"{T}/driver.lock", "a")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit("Another native integration driver already owns /tmp/itest")
WI = "33333333-3333-3333-3333-333333333333"
required = ["public_schema.sql", "svc.jwt", "anon.jwt", "lpsql", "postgrest.conf", "gateway.ts", "runfn.sh"]
missing = [name for name in required if not os.path.isfile(f"{T}/{name}")]
if missing:
    sys.exit("ISOLATED INTEGRATION BLOCKED: missing local artifacts in /tmp/itest: " + ", ".join(missing)
             + ". Run the explicitly local bootstrap described in README.md.")
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
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        return status, json.loads(raw or b"null")
    except json.JSONDecodeError:
        return status, {"non_json_response": raw.decode(errors='replace')}

def start(cmd, log):
    p = subprocess.Popen(cmd, shell=True, stdout=open(log, "w"), stderr=subprocess.STDOUT, env=ENV_CLEAN, start_new_session=True, cwd=T)
    procs.append(p)

def wait_ok(url, body=None, tries=60):
    for _ in range(tries):
        if any(p.poll() is not None for p in procs):
            raise RuntimeError("A local test server exited during startup; inspect /tmp/itest/*.log")
        try:
            status, _ = http(url, body, timeout=3)
            if 200 <= status < 300:
                return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"not up: {url}")

def ctl(**kw):
    return http("http://127.0.0.1:54321/__ctl", kw)[1]

def reset(extra_sql=None):
    r = sh(f"{T}/lpsql -d postgres -c 'drop database if exists sync_run with (force)' -c 'create database sync_run template sync_itest'")
    if r.returncode: raise RuntimeError(r.stderr)
    if extra_sql: sql(extra_sql)
    ctl(faults={"rpcUpsert": 0, "readBack": 0, "readBackMissing": 0, "patchZero": 0, "rpcUpsertOnFp": ""}, resetLog=True)
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

def sync(work_item_id=WI):
    st, body = http("http://127.0.0.1:8000", {"work_item_id": work_item_id, "_scheduled": True, "force_refresh": True},
                    {"Authorization": f"Bearer {SVC}"}, timeout=180)
    return st, body

def acts():
    return sql("select id, hash_fingerprint, raw_data->>'origen_solicitud', raw_data->>'origen_indice', raw_data->>'anotacion', coalesce(jsonb_array_length(documentos),-1), raw_data->'anotacion_reparada' is not null from work_item_acts where work_item_id='%s' and not is_archived order by created_at, id" % WI)

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

def run_native():
    native = subprocess.run(['deno','test','--cached-only','--no-check','--allow-env','--allow-read','--allow-net=127.0.0.1',
      os.path.join(os.environ['ITEST_REPO'],'supabase/tests/itest-sync/native-http.test.ts')],
      capture_output=True,text=True,env=ENV_CLEAN)
    open(f'{T}/native-http-output.log','w').write(native.stdout + native.stderr)
    print(native.stdout, flush=True)
    if native.stderr: print(native.stderr, flush=True)
    check('Native concurrent HTTP and RLS cases', native.returncode == 0)
    return native.returncode

def run_inventory():
    """Optional private saved observations; actual function/HTTP/RPC, no downloads.

    The two synthetic work-item lifecycles are isolated by a database reset. The
    source act rows and descriptors come from the reviewed snapshot, including
    the six memorials with missing inventories. Nothing reaches hosted services.
    """
    from pathlib import Path
    evidence = Path(os.environ['ITEST_INVENTORY_EVIDENCE'])
    matrix = json.loads((evidence/'inventory-matrix.json').read_text())
    result = []
    target_indices = {'05001233300020260142400': [25, 26], '05001233300020240115300': [108, 109, 115, 116]}
    for radicado, memorial_indices in target_indices.items():
        expected = [m for m in matrix if m['radicado'] == radicado]
        source = json.loads((evidence/'original'/f'{radicado}-raw.json').read_text())['actuaciones']
        indices = {m['indice'] for m in expected} | set(memorial_indices)
        selected = [a for a in source if a['indice'] in indices]
        # Preserve source associations but omit ephemeral, sensitive origin tokens.
        selected = json.loads(json.dumps(selected))
        for act in selected:
            for document in act.get('anexos_documentos') or []:
                for key in ['urlDescargaOriginal', 'tokenDocumento']:
                    document.pop(key, None)
        reset(f"UPDATE work_items SET radicado='{radicado}' WHERE id='{WI}'")
        feed(*selected)
        status, response = sync()
        check(f'Inventories {radicado}: real function persists snapshot', status == 200 and not response.get('errors'), str(response.get('errors')))
        def snapshot():
            return json.loads(sql(f"select coalesce(jsonb_agg(jsonb_build_object('id',id,'fingerprint',hash_fingerprint,'indice',raw_data->>'origen_indice','solicitud',raw_data->>'origen_solicitud','docs',documentos,'raw_docs',raw_data->'documentos') order by id),'[]') from work_item_acts where work_item_id='{WI}'")[0][0])
        rows = snapshot()
        def effect_snapshot():
            return json.loads(sql("""select jsonb_build_object(
              'notifications',(select jsonb_agg(to_jsonb(n) order by id) from notifications n),
              'alerts',(select jsonb_agg(to_jsonb(a) order by id) from alert_instances a),
              'deadlines',(select jsonb_agg(to_jsonb(d) order by id) from work_item_deadlines d),
              'hearings',(select jsonb_agg(to_jsonb(h) order by id) from work_item_hearings h))""")[0][0])
        def effect_changes(before, after):
            changes = []
            for table in before:
                old = {r['id']:r for r in before[table] or []}
                new = {r['id']:r for r in after[table] or []}
                for key in old.keys() | new.keys():
                    fields = sorted(k for k in set(old.get(key,{})) | set(new.get(key,{})) if old.get(key,{}).get(k) != new.get(key,{}).get(k))
                    if fields: changes.append({'table':table,'id':key,'changed_fields':fields,'inserted':key not in old,'deleted':key not in new})
            return changes
        def effects_preserved(before, after):
            # The existing deadline RPC appends corroboration audit entries on
            # every sync. Those audit timestamps are not a new judicial term.
            # All row identities, substantive fields and existing audit entries
            # must survive; no other table gets an exception.
            left, right = json.loads(json.dumps(before)), json.loads(json.dumps(after))
            old = {r['id']:r for r in left['deadlines'] or []}
            new = {r['id']:r for r in right['deadlines'] or []}
            if old.keys() != new.keys(): return False
            for key in old:
                for row in (old[key],new[key]): row.pop('updated_at',None)
                old_meta, new_meta = old[key].get('calculation_meta') or {}, new[key].get('calculation_meta') or {}
                old_audit, new_audit = old_meta.pop('corroborations',[]), new_meta.pop('corroborations',[])
                if new_audit[:len(old_audit)] != old_audit: return False
            return left == right
        effects_before = effect_snapshot()
        for inventory in expected:
            matched = [a for a in rows if a['indice'] == str(inventory['indice'])]
            observed = matched[0]['docs'] if len(matched) == 1 else []
            expected_urls = sorted(d['url'] for d in inventory['documents'])
            actual_urls = sorted(d.get('url') for d in observed or [])
            expected_pairs = sorted((d['url'],d['description']) for d in inventory['documents'])
            actual_pairs = sorted((d.get('url'),d.get('descripcion') or d.get('nombre')) for d in observed or [])
            preserved = len(matched) == 1 and actual_pairs == expected_pairs and matched[0]['raw_docs'] == observed
            check(f"Inventory {radicado}/{inventory['indice']}: exact own descriptors at RPC read-back", preserved)
            result.append({'radicado':radicado,'indice':inventory['indice'],'source_act_id':inventory['source_act_id'],
              'original_24':inventory['original_24'],'expected_documents':len(expected_urls),'actual_documents':len(actual_urls),
              'association_preserved':preserved,'application_act_id':matched[0]['id'] if matched else None})
        for indice in memorial_indices:
            matched = [a for a in rows if a['indice'] == str(indice)]
            check(f'Memorial {radicado}/{indice}: no unrelated document assigned', len(matched) == 1 and not matched[0]['docs'])
        status, response = sync()
        OUT.append({'inventory_case':radicado,'phase':'repeat','effect_changes':effect_changes(effects_before,effect_snapshot())})
        check(f'Inventories {radicado}: replay keeps identities/documents/substantive effects', status == 200 and snapshot() == rows and effects_preserved(effects_before,effect_snapshot()))
        for act in selected:
            act['anexos_documentos'] = None
        feed(*selected)
        status, response = sync()
        OUT.append({'inventory_case':radicado,'phase':'omitted_inventory','effect_changes':effect_changes(effects_before,effect_snapshot())})
        check(f'Inventories {radicado}: later omitted inventory cannot erase documents', status == 200 and snapshot() == rows and effects_preserved(effects_before,effect_snapshot()))
    output = {'execution':'real local function, PostgREST and PostgreSQL public schema; saved source observations; no new downloads or production writes',
      'inventories':result,'original_24':sum(r['original_24'] for r in result),'other_inventories':sum(not r['original_24'] for r in result)}
    Path(T+'/inventory-rpc-results.json').write_text(json.dumps(output,indent=2))

try:
    start("postgrest postgrest.conf", f"{T}/postgrest.log")
    start(f"deno run --cached-only --allow-net=127.0.0.1 {T}/gateway.ts", f"{T}/gateway.log")
    wait_ok("http://127.0.0.1:54321/__ctl")
    reset()
    start(f"{T}/runfn.sh", f"{T}/fn.log")
    wait_ok("http://127.0.0.1:8000", {"health_check": True})
    time.sleep(2)
    if '--native-only' in sys.argv:
        reset()
        sys.exit(run_native())
    if '--inventory-only' in sys.argv:
        run_inventory()
        if not all(r[1] for r in results): sys.exit(1)
        sys.exit(0)

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
        '2026-10-16', $${TITLE} - {A}$$, left($${TITLE} - {B}$$, 500), 'PLACEHOLDER', 'samai', jsonb_build_object('actuacion', '{TITLE}', 'anotacion', $${B}$$))""")
    # fingerprint as production v1 would compute it: take it from a clean run's first row
    base_nv = novedades()
    feed(item(A), item(B))
    st, r = sync(); rows8 = acts(); nv8 = novedades()
    print("S8 rows", rows8, "novedades", base_nv, "->", nv8)
    contaminated = [x for x in rows8 if x[0] == "ffffffff-0000-0000-0000-000000000001"]
    check("S8 contaminated row text untouched (no repair)", contaminated and "DOS" in contaminated[0][4] and contaminated[0][6] == "f", str(contaminated))
    OUT.append({"S8_rows": rows8, "S8_novedades": [base_nv, nv8], "S8_resp": {k: r.get(k) for k in ("inserted_count", "skipped_count", "errors")}})

    # S9 — all three conditional PATCH attempts return zero rows. The sync
    # must report the failed enrichment and keep every downstream table intact.
    reset(); feed(item(A)); sync()
    snapshot_query = f"""select jsonb_build_object(
      'acts',(select jsonb_agg(jsonb_build_object('id',id,'raw',raw_data,'docs',documentos)) from work_item_acts where work_item_id='{WI}'),
      'notifications',(select jsonb_agg(to_jsonb(n)) from notifications n),
      'alerts',(select jsonb_agg(to_jsonb(a)) from alert_instances a),
      'deadlines',(select jsonb_agg(to_jsonb(d)) from work_item_deadlines d),
      'hearings',(select jsonb_agg(to_jsonb(h)) from work_item_hearings h))"""
    before9 = sql(snapshot_query)
    timestamps9 = sql(f"select last_successful_sync_at,last_synced_at from work_items where id='{WI}'")
    feed(item(A + ' SE FIJA AUDIENCIA INICIAL PARA EL 20 DE NOVIEMBRE DE 2026 A LAS 09:00.', url=URL))
    ctl(faults={"patchZero": 3}, resetLog=True)
    st, r = sync(); log9 = ctl()['log']
    check('S9 zero-row PATCH stays visible and uncounted', st == 500 and not r.get('ok') and 'zero rows' in json.dumps(r).lower() and not r.get('inserted_count'), str(r))
    check('S9 three fresh-read attempts, no success', log9.count('FAULT zero-row PATCH') == 3, str(log9))
    check('S9 zero-row PATCH causes no act/downstream changes', sql(snapshot_query) == before9)
    check('S9 failed enrichment cannot advance successful-sync timestamps',sql(f"select last_successful_sync_at,last_synced_at from work_items where id='{WI}'")==timestamps9)

    # S10 — the real function and notification/deadline triggers process a
    # traslado, without manufacturing a granted-cautelar alert or unanchored date.
    reset()
    feed({'Fecha Providencia':'2026-10-16T00:00:00.000Z', 'Actuación':'Auto traslado de 5 dias',
          'Docum. a notif.':'SE CORRE TRASLADO A LA PARTE DEMANDADA DE LA MEDIDA CAUTELAR SOLICITADA CON LA DEMANDA POR CINCO DIAS.',
          'indice': 12})
    st, r = sync()
    check('S10 traslado persists through real sync', st == 200 and len(acts()) == 1, str(r))
    check('S10 traslado never asserts cautelar granted', sql("select count(*) from alert_instances where title ~* 'medida.*cautelar.*(ordenada|decretada|concedida)'")[0][0] == '0')
    check('S10 real notification trigger emitted a notification', int(sql('select count(*) from notifications')[0][0]) > 0)
    check('S10 no provisional dated deadline without an anchor', sql('select count(*) from work_item_deadlines where deadline_date is not null')[0][0] == '0')

    if os.environ.get('ITEST_INVENTORY_EVIDENCE'):
        run_inventory()

    # Independent concurrent HTTP clients share the native database and exercise
    # origin guards, actual optimistic conflicts and authenticated RLS.
    reset()
    run_native()
finally:
    for p in procs:
        try: os.killpg(p.pid, 15)
        except Exception: pass
    json.dump({"results": results, "extra": OUT}, open(f"{T}/results.json", "w"), indent=1, default=str)
    print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed")

if not results or not all(r[1] for r in results):
    sys.exit(1)
