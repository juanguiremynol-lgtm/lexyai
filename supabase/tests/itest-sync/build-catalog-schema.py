#!/usr/bin/env python3
"""Rebuild a schema-only SQL snapshot from read-only PostgreSQL catalog exports.

Catalog JSON is private evidence under ITEST_DIR, never production rows or keys.
The exports must come from one reviewed schema snapshot. auth/cron extension
fixtures are supplied by prelude.sql; every public function/table/trigger/policy
is emitted exactly from catalog definitions rather than application substitutes.
"""
import json
import os
import csv
from collections import defaultdict
from pathlib import Path

root = Path(os.environ.get("ITEST_DIR", "/tmp/itest"))

def rows(name):
    return json.loads((root / f"catalog-{name}.json").read_text())["rows"]

def ident(value):
    return '"' + value.replace('"', '""') + '"'

def literal(value):
    return "'" + value.replace("'", "''") + "'"

sql = ["SET check_function_bodies = false;", "SET search_path = public, extensions;"]
for enum in rows("enums"):
    labels = enum['labels']
    if isinstance(labels, str):
        labels = next(csv.reader([labels.strip('{}')]))
    sql.append(f"CREATE TYPE public.{ident(enum['typname'])} AS ENUM (" + ",".join(map(literal, labels)) + ");")
for seq in rows("sequences"):
    sql.append(f"CREATE SEQUENCE public.{ident(seq['sequencename'])} START {seq['start_value']} INCREMENT {seq['increment_by']} MINVALUE {seq['min_value']} MAXVALUE {seq['max_value']} CACHE {seq['cache_size']} " + ("CYCLE" if seq['cycle'] else "NO CYCLE") + ";")
tables = defaultdict(list)
for col in rows("columns"):
    tables[col["relname"]].append(col)
for name, cols in tables.items():
    definitions = []
    for c in cols:
        value = ident(c['attname']) + " " + c['type']
        if c['attgenerated']:
            value += " GENERATED ALWAYS AS (" + c['default_expr'] + ") STORED"
        if c['attnotnull']:
            value += " NOT NULL"
        definitions.append(value)
    sql.append(f"CREATE TABLE public.{ident(name)} (" + ",\n".join(definitions) + ");")
functions = []
for path in sorted(root.glob("catalog-functions-*.json")):
    functions.extend(json.loads(path.read_text())["rows"])
for fn in functions:
    if 'REDACTED_PRODUCTION_JWT' in fn['definition']:
        raise SystemExit("A function contains a redacted credential: review before local schema recreation")
    sql.append(fn['definition'].rstrip().rstrip(';') + ';')
for name, cols in tables.items():
    for c in cols:
        if c['default_expr'] is not None and not c['attgenerated']:
            sql.append(f"ALTER TABLE public.{ident(name)} ALTER COLUMN {ident(c['attname'])} SET DEFAULT {c['default_expr']};")
constraints = rows("constraints")
for con in sorted(constraints, key=lambda c: c['contype'] == 'f'):
    sql.append(f"ALTER TABLE public.{ident(con['table_name'].removeprefix('public.'))} ADD CONSTRAINT {ident(con['conname'])} {con['definition']};")
constraint_indexes = {c['conname'] for c in constraints if c['contype'] in ('p', 'u', 'x')}
for idx in rows("indexes"):
    if idx['indexname'] not in constraint_indexes:
        sql.append(idx['indexdef'] + ';')
for trigger in rows("triggers"):
    sql.append(trigger['definition'] + ';')
    if trigger['tgenabled'] == 'D':
        sql.append(f"ALTER TABLE public.{ident(trigger['table_name'])} DISABLE TRIGGER {ident(trigger['tgname'])};")
for policy in rows("policies"):
    role_names = policy['roles']
    if isinstance(role_names, str):
        role_names = role_names.strip('{}').split(',')
    stmt = f"CREATE POLICY {ident(policy['policyname'])} ON public.{ident(policy['tablename'])} AS {policy['permissive']} FOR {policy['cmd']} TO " + ','.join(ident(r) for r in role_names)
    if policy['qual']:
        stmt += " USING (" + policy['qual'] + ")"
    if policy['with_check']:
        stmt += " WITH CHECK (" + policy['with_check'] + ")"
    sql.append(stmt + ';')
for table in rows("tables"):
    if table['relrowsecurity']:
        sql.append(f"ALTER TABLE public.{ident(table['relname'])} ENABLE ROW LEVEL SECURITY;")
    if table['relforcerowsecurity']:
        sql.append(f"ALTER TABLE public.{ident(table['relname'])} FORCE ROW LEVEL SECURITY;")
sql.append("GRANT USAGE ON SCHEMA public, extensions, auth TO anon, authenticated, service_role;")
sql.append("GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;")
sql.append("GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;")
sql.append("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;")
# Client permissions reproduce table ACL grants; policies still govern row access.
for table in rows('tables'):
    acl = table.get('relacl') or []
    if isinstance(acl, str):
        acl = acl.strip('{}').split(',')
    for grant in acl:
        role, rest = grant.split('=', 1)
        if role not in ('anon', 'authenticated'):
            continue
        flags = rest.split('/', 1)[0]
        privileges = [label for flag,label in [('r','SELECT'),('a','INSERT'),('w','UPDATE'),('d','DELETE'),('D','TRUNCATE'),('x','REFERENCES'),('t','TRIGGER')] if flag in flags]
        if privileges:
            sql.append(f"GRANT {','.join(privileges)} ON public.{ident(table['relname'])} TO {ident(role)};")
out = root / 'public_schema.sql'
out.write_text('\n\n'.join(sql) + '\n')
out.chmod(0o600)
# Views can depend on one another: bootstrap loads them in dependency order.
(root / 'catalog-view-statements.json').write_text(json.dumps([f"CREATE VIEW public.{ident(v['relname'])} AS {v['definition']}" for v in rows('views')]))
print(f"Wrote {len(tables)} tables, {len(functions)} functions, {len(rows('triggers'))} triggers, {len(rows('policies'))} policies to {out}")
