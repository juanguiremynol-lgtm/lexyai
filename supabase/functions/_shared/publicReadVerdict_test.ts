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
