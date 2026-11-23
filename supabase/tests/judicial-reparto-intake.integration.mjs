// From the repository root: deno run --no-lock --allow-read --allow-env supabase/tests/judicial-reparto-intake.integration.mjs
// The authorization fixture and migration run in an in-memory local database.
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import assert from "node:assert/strict";

const db = new PGlite();
const owner = "00000000-0000-0000-0000-000000000101";
const stranger = "00000000-0000-0000-0000-000000000102";
const session = "00000000-0000-0000-0000-000000000201";
const otherSession = "00000000-0000-0000-0000-000000000202";
const assigned = "05001311000220260047100";
const otherInstance = "05001311000220260047101";
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const file = (path) => Deno.readTextFile(path);
const actor = async (uid, sid, role = "authenticated") => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: uid, session_id: sid, role })]);
  await db.exec("SET ROLE " + role);
};
const stage = async (key, { detected = null, pdf = null, stored = true } = {}) => {
  await db.exec("RESET ROLE");
  const id = crypto.randomUUID();
  return scalar("INSERT INTO judicial_reparto_imports(id,owner_id,source,source_key,detected_process_id,message_id,pdf_sha256,pdf_path,pdf_stored_at) VALUES($1,$2,'OUTLOOK',$3,$4,'fixture-message',$5,$6,$7) RETURNING id",
    [id, owner, key, detected, pdf, pdf ? owner + "/" + id + "/" + pdf + ".pdf" : null, pdf && stored ? new Date().toISOString() : null]);
};
const confirm = (proof, target, kind, reference, radicado = null, authority = null, confirmed = true) => scalar(
  "SELECT confirm_judicial_reparto($1,$2,$3,$4,$5,$6,$7,((now() AT TIME ZONE 'America/Bogota')::date - 1),'CGP','Expediente sintético',NULL,NULL,NULL)",
  [proof, target, confirmed, kind, reference, radicado, authority],
);

try {
  await db.exec(await file("supabase/tests/fixtures/mcp_authorization_schema.sql"));
  const creation = await file("drizzle/migrations/0069_mcp_create_reminders_org_scoped.sql");
  await db.exec(creation.slice(creation.indexOf("CREATE OR REPLACE FUNCTION public.mcp_create_work_item"), creation.indexOf("END $function$;") + "END $function$;".length));
  await db.exec([
    "ALTER TABLE detected_processes ADD PRIMARY KEY (id), ADD COLUMN user_id uuid, ADD COLUMN radicado text, ADD COLUMN status text, ADD COLUMN created_work_item_id uuid",
    "CREATE SCHEMA storage",
    "CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit int, allowed_mime_types text[])",
    "CREATE TABLE storage.objects (bucket_id text, name text)",
    "ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY",
    "GRANT USAGE ON SCHEMA storage TO authenticated",
    "GRANT SELECT ON storage.objects TO authenticated",
    "CREATE FUNCTION storage.foldername(n text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[split_part(n,'/',1)] $$",
    "CREATE FUNCTION storage.filename(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(n,'/',3) $$",
  ].join(";"));
  await db.exec(await file("supabase/migrations/20261123223000_judicial_reparto_intake.sql"));
  await db.query("INSERT INTO auth.users (id) VALUES ($1),($2)", [owner, stranger]);
  await db.query("INSERT INTO auth.sessions (id,user_id) VALUES ($1,$2),($3,$4)", [session, owner, otherSession, stranger]);
  const detection = await scalar("INSERT INTO detected_processes VALUES (gen_random_uuid(),$1,$2,'PENDING',NULL) RETURNING id", [owner, assigned]);
  const receipt = await stage("mail:" + "a".repeat(64));
  const repartition = await stage("pdf:" + "b".repeat(64), { detected: detection, pdf: "b".repeat(64), stored: false });
  const storagePath = owner + "/" + repartition + "/" + "b".repeat(64) + ".pdf";
  await assert.rejects(stage("pdf:" + "b".repeat(64), { pdf: "b".repeat(64) }), { code: "23505" });
  await db.query("INSERT INTO storage.objects VALUES ('judicial-reparto',$1)", [storagePath]);

  await actor(owner, session);
  assert.equal(await scalar("SELECT public.mcp_access_level()"), "first_party");
  assert.equal(await scalar("SELECT count(*)::int FROM storage.objects"), 0);
  await assert.rejects(confirm(repartition, null, "REPARTO", "VJE-444", assigned), { code: "22023" });
  await db.exec("RESET ROLE");
  await db.query("UPDATE judicial_reparto_imports SET pdf_stored_at=now() WHERE id=$1", [repartition]);
  await actor(owner, session);
  assert.equal(await scalar("SELECT count(*)::int FROM storage.objects"), 1);
  await assert.rejects(db.query("UPDATE judicial_reparto_imports SET kind='REPARTO'"), { code: "42501" });
  await assert.rejects(confirm(receipt, null, "RECEPCION", "VJE-444", null, null, false), { code: "22023" });
  const first = await confirm(receipt, null, "RECEPCION", "VJE-444");
  assert.equal(first.created, true);
  assert.equal(await scalar("SELECT monitoring_disabled_reason FROM work_items WHERE id=$1", [first.work_item_id]), "PENDIENTE_DE_RADICACION");
  assert.equal(await scalar("SELECT filing_date FROM work_items WHERE id=$1", [first.work_item_id]), null);
  assert.deepEqual(await confirm(receipt, null, "RECEPCION", "VJE-444"),
    { work_item_id: first.work_item_id, created: false, replayed: true });
  assert.equal(await scalar("SELECT id FROM find_judicial_reparto_matches(NULL,'vje-444')"), first.work_item_id);
  await assert.rejects(confirm(repartition, null, "REPARTO", "VJE-444", assigned, "Despacho 02"), { code: "23505" });
  assert.equal(await scalar("SELECT count(*)::int FROM work_items"), 1);

  const linked = await confirm(repartition, first.work_item_id, "REPARTO", "VJE-444", assigned, "Despacho 02");
  assert.equal(linked.work_item_id, first.work_item_id);
  assert.equal(await scalar("SELECT radicado FROM work_items WHERE id=$1", [first.work_item_id]), assigned);
  assert.equal(await scalar("SELECT authority_name FROM work_items WHERE id=$1", [first.work_item_id]), "Despacho 02");
  assert.equal(await scalar("SELECT monitoring_enabled FROM work_items WHERE id=$1", [first.work_item_id]), true);
  assert.equal(await scalar("SELECT count(*)::int FROM judicial_reparto_imports WHERE work_item_id=$1", [first.work_item_id]), 2);
  await db.exec("RESET ROLE");
  assert.equal(await scalar("SELECT created_work_item_id FROM detected_processes WHERE id=$1", [detection]), first.work_item_id);

  const mismatched = await stage("mail:" + "c".repeat(64));
  await actor(owner, session);
  await assert.rejects(confirm(mismatched, first.work_item_id, "REPARTO", "VJE-444", otherInstance), { code: "22023" });
  assert.equal(await scalar("SELECT radicado FROM work_items WHERE id=$1", [first.work_item_id]), assigned);
  const ownProof = await stage("mail:" + "d".repeat(64));
  await actor(stranger, otherSession);
  assert.equal(await scalar("SELECT count(*)::int FROM storage.objects"), 0);
  assert.equal(await scalar("SELECT count(*)::int FROM judicial_reparto_imports"), 0);
  await assert.rejects(confirm(ownProof, null, "RECEPCION", "VJE-555"), { code: "42501" });
  await actor(owner, session, "anon");
  await assert.rejects(confirm(ownProof, null, "RECEPCION", "VJE-555"), { code: "42501" });

  await db.exec("RESET ROLE");
  await db.exec("CREATE FUNCTION fixture_fail_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '" +
    ownProof + "' THEN RAISE EXCEPTION 'fixture forced failure'; END IF; RETURN NEW; END $$");
  await db.exec("CREATE TRIGGER fixture_fail_evidence BEFORE UPDATE ON judicial_reparto_imports FOR EACH ROW EXECUTE FUNCTION fixture_fail_evidence()");
  await actor(owner, session);
  await assert.rejects(confirm(ownProof, null, "RECEPCION", "VJE-555"), /fixture forced failure/);
  assert.equal(await scalar("SELECT count(*)::int FROM work_items"), 1);
  assert.equal(await scalar("SELECT work_item_id FROM judicial_reparto_imports WHERE id=$1", [ownProof]), null);
  await assert.rejects(db.query("SELECT * FROM judicial_reparto_pdf_purges"), { code: "42501" });
  await db.exec("RESET ROLE");
  await db.exec("DROP TRIGGER fixture_fail_evidence ON judicial_reparto_imports");
  await db.query("DELETE FROM work_items WHERE id=$1", [first.work_item_id]);
  assert.equal(await scalar("SELECT count(*)::int FROM judicial_reparto_imports WHERE work_item_id=$1", [first.work_item_id]), 0);
  assert.equal(await scalar("SELECT pdf_path FROM judicial_reparto_pdf_purges WHERE work_item_id=$1", [first.work_item_id]), storagePath);
  assert.notEqual(await stage("pdf:" + "b".repeat(64), { pdf: "b".repeat(64) }), repartition);
  assert.equal(await scalar("SELECT count(*)::int FROM judicial_reparto_imports WHERE pdf_path=$1", [storagePath]), 0);
  console.log("Reparto SQL checks passed: ownership, pending upload, deduplication, radicado, atomic rollback, purge receipt, and unique paths across reimport.");
} finally {
  await db.close();
}
