import { publicReadVerdict } from "./publicReadVerdict.ts";
function assert(value: unknown, message = "assertion failed") { if (!value) throw new Error(message); }
Deno.test("deferred, stale, partial and initiated reads cannot become successes", () => {
  for (const code of ["PENDING_UPSTREAM","STALE_SNAPSHOT","PARTIAL","SCRAPING_INITIATED","CONTRACT_MISMATCH"]) {
    const result = publicReadVerdict(true, { ok: true, result_code: code });
    assert(!result.success && result.retryable, code);
  }
  assert(!publicReadVerdict(true, {ok:true,cpnu_buscar_deferred:true}).success);
  assert(!publicReadVerdict(true, {ok:true,snapshot_stale:true}).success);
  assert(!publicReadVerdict(true, {ok:true,status:"not_applicable"}).success);
});
Deno.test("known source absence/access is not blindly retried or reclassified", () => {
  for (const status of [401,403,404]) {
    const result = publicReadVerdict(false, {ok:false}, status);
    assert(!result.success && !result.retryable);
  }
  assert(publicReadVerdict(false, {ok:false}, 429).retryable);
  assert(publicReadVerdict(false, {ok:false}, 503).retryable);
});
Deno.test("completed empty read and pending attachments are independent", () => {
  assert(publicReadVerdict(true,{ok:true,result_code:"SUCCESS_EMPTY"}).success);
  assert(publicReadVerdict(true,{ok:true,result_code:"SUCCESS_WITH_DATA",documentos_pendientes:6}).success);
});
Deno.test("SAMAI SUCCESS_EMPTY with legacy NO_DATA is a completed read", () => {
  const real = { ok: true, result_code: "SUCCESS_EMPTY", status: "NO_DATA", errors: [],
    samai_estados_summary: { called: true, http_status: 200, status: "EMPTY", raw_count: 0 } };
  const v = publicReadVerdict(true, real);
  assertEquals(v.success, true); assertEquals(v.retryable, false);
  for (const extra of [{ consulta_completa: false }, { stale: true }, { snapshot_stale: true }, { run_status: "PENDING" }]) {
    assertEquals(publicReadVerdict(true, { ...real, ...extra }).success, false);
  }
  assertEquals(publicReadVerdict(true, { ok: true, status: "NO_DATA" }).success, false);
});
