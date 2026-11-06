import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { attributeAttemptedProviders, enforceVerifiedOutcome, responseCause } from "./syncTimelineVerdict.ts";

Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-key");
const { withSyncTimeline, recordSyncTimelineEvent } = await import("./syncTimeline.ts");

const WI = "00000000-0000-4000-8000-000000000001";
type Row = Record<string, any>;

async function capture(fn: () => Promise<unknown>): Promise<Row[]> {
  const rows: Row[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/rest/v1/work_item_sync_timeline")) {
      const body = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : "null")));
      rows.push(...(Array.isArray(body) ? body : [body]));
    }
    return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = real; }
  return rows;
}

async function run(body: Record<string, unknown>, httpStatus = 200): Promise<{ rows: Row[]; text: string; original: string }> {
  const original = JSON.stringify(body);
  const h = withSyncTimeline(() => new Response(original, { status: httpStatus, headers: { "content-type": "application/json" } }),
    { function_name: "sync-publicaciones-by-work-item", default_operation: "publicaciones" });
  let text = "";
  const rows = await capture(async () => {
    const res = await h(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ work_item_id: WI }) }));
    text = await res.text();
  });
  return { rows, text, original };
}

function noContradiction(r: Row) {
  if (r.status === "success" || r.status === "empty") {
    assertEquals(r.error_code, null);
    assertEquals(r.providers.some((p: string) => p === "unknown" || p === "none"), false);
  }
}

Deno.test("wrapper: preserves explicit source completeness and distinguishes missing evidence", async () => {
  for (const [body, expected] of [
    [{ ok: true, provider_used: "publicaciones", source_complete: true }, true],
    [{ ok: true, provider_used: "publicaciones", source_complete: false }, false],
    [{ ok: true, provider_used: "publicaciones" }, null],
    [{ ok: true, provider_used: "publicaciones", source_complete: "true" }, null],
  ] as const) {
    const { rows } = await run(body);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].metadata.source_complete, expected);
  }
});

Deno.test("wrapper: a stored read retains the source observation and does not become a new attempt", async () => {
  const observed = '2026-11-06T07:30:00.000Z';
  const { rows } = await run({ok:true,provider_used:'samai_estados',result_code:'SUCCESS_WITH_DATA',
    inserted_count:0,skipped_count:1,source_complete:true,source_observed_at:observed,
    source_query_attempted:false,reused_completed_read:true});
  assertEquals(rows[0].metadata.source_observed_at,observed);
  assertEquals(rows[0].metadata.source_complete,true);
  assertEquals(rows[0].metadata.source_query_attempted,false);
  assertEquals(rows[0].metadata.reused_completed_read,true);
});

Deno.test("wrapper: unknown provider with rows is never success; response unchanged", async () => {
  const { rows, text, original } = await run({ ok: true, inserted_count: 0, skipped_count: 11, result_code: "SUCCESS_WITH_DATA" });
  assertEquals(text, original);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "skipped");
  assertEquals(rows[0].error_code, "PROVIDER_UNRESOLVED");
  assertEquals(rows[0].metadata.unverified_outcome.original_status, "success");
  noContradiction(rows[0]);
});

Deno.test("wrapper: named PP producer success is verified success", async () => {
  const { rows } = await run({ ok: true, provider_used: "publicaciones", inserted_count: 1, skipped_count: 2, result_code: "SUCCESS_WITH_DATA" });
  assertEquals([rows[0].status, rows[0].error_code, rows[0].provider], ["success", null, "publicaciones"]);
});

Deno.test("wrapper: combined PP+SAMAI producer keeps both sources", async () => {
  const { rows } = await run({ ok: true, provider_used: "publicaciones+samai_estados", inserted_count: 0, skipped_count: 3 });
  assertEquals(rows[0].status, "success");
  assertEquals(rows[0].providers, ["publicaciones", "samai_estados"]);
});

Deno.test("wrapper: empty unattributed is not empty", async () => {
  const { rows } = await run({ ok: true, inserted_count: 0, skipped_count: 0 });
  assertEquals([rows[0].status, rows[0].error_code], ["skipped", "PROVIDER_UNRESOLVED"]);
});

Deno.test("wrapper: pending, partial and dedup semantics preserved", async () => {
  const p = await run({ ok: false, provider_used: "samai_estados", result_code: "PENDING_UPSTREAM", pending_upstream: true });
  assertEquals([p.rows[0].status, p.rows[0].error_code], ["pending_upstream", "PENDING_UPSTREAM"]);
  const scoped = await run({ ok:false,provider_used:"publicaciones",result_code:"PENDING_UPSTREAM",
    pending_upstream:true,error_code:"PP_DAILY_WINDOW_NOT_CERTIFIED" });
  assertEquals([scoped.rows[0].status,scoped.rows[0].error_code], ["pending_upstream","PP_DAILY_WINDOW_NOT_CERTIFIED"]);
  const part = await run({ ok: true, provider_used: "publicaciones", partial: true, inserted_count: 1 });
  assertEquals(part.rows[0].status, "partial");
  const d = await run({ ok: true, status: "DAILY_LIMIT", reason: "DAILY_UPDATE_ALREADY_STARTED" });
  assertEquals(d.rows[0].status, "deduplicated");
  noContradiction(d.rows[0]);
  const stored = await run({ ok:false,status:"DAILY_LIMIT",provider_used:"publicaciones",
    error_code:"PP_STORED_READ_INCOMPLETE",source_complete:false,
    stored_result_read:{reason:"PP_RUN_PARCIAL: ESTADO_SIN_DOCUMENTO"} });
  assertEquals([stored.rows[0].status,stored.rows[0].provider,stored.rows[0].error_code],
    ["deduplicated","publicaciones","PP_STORED_READ_INCOMPLETE"]);
  assertEquals(stored.rows[0].metadata.stored_result_read.reason,"PP_RUN_PARCIAL: ESTADO_SIN_DOCUMENTO");
});

Deno.test("wrapper: failure keeps the real reason, not a success code", async () => {
  const { rows } = await run({ ok: false, provider_used: "publicaciones", result_code: "ERROR", reason: "PORTAL_TIMEOUT" });
  assertEquals([rows[0].status, rows[0].error_code], ["error", "ERROR"]);
  assertEquals(responseCause({ result_code: "SUCCESS_WITH_DATA", reason: "PORTAL_TIMEOUT" }), "PORTAL_TIMEOUT");
  assertEquals(responseCause({ errors: [{ code: "OCR_PAGINAS_INCOMPLETAS" }] }), "OCR_PAGINAS_INCOMPLETAS");
});

Deno.test("wrapper: unauthenticated caller writes nothing", async () => {
  const { rows, text, original } = await run({ ok: false, code: "UNAUTHORIZED" }, 401);
  assertEquals(rows.length, 0);
  assertEquals(text, original);
});

Deno.test("recorder: known provider + PROVIDER_UNRESOLVED success is persisted as partial", async () => {
  const rows = await capture(() => recordSyncTimelineEvent({ work_item_id: WI, provider: "cpnu", operation: "acts",
    status: "success", error_code: "PROVIDER_UNRESOLVED" }));
  assertEquals([rows[0].status, rows[0].error_code], ["partial", "PROVIDER_UNRESOLVED"]);
  noContradiction(rows[0]);
});

Deno.test("pure: attribution names only attempted sources", () => {
  assertEquals(attributeAttemptedProviders({}), undefined);
  assertEquals(attributeAttemptedProviders({ publicaciones: true }), "publicaciones");
  assertEquals(attributeAttemptedProviders({ samai_estados: true }), "samai_estados");
  assertEquals(attributeAttemptedProviders({ publicaciones: true, samai_estados: true }), "publicaciones+samai_estados");
  assertEquals(enforceVerifiedOutcome({ status: "empty", providers: ["none"], error_code: null }).status, "skipped");
});

Deno.test("wrapper: ok:true + known provider + PROVIDER_UNRESOLVED keeps the code and seals daily NOT DONE", async () => {
  const { rememberAdmission } = await import("./dailyUpdateGate.ts");
  const original = JSON.stringify({ ok: true, provider_used: "publicaciones", inserted_count: 3, error_code: "PROVIDER_UNRESOLVED" });
  const h = withSyncTimeline((req) => {
    rememberAdmission(req, { admitted: true, mode: "new", token: "tok-1", run_date: "2026-11-05", channel: "pubs" } as any);
    return new Response(original, { status: 200, headers: { "content-type": "application/json" } });
  }, { function_name: "sync-publicaciones-by-work-item", default_operation: "publicaciones" });
  const seals: Row[] = [];
  let text = "";
  const real = globalThis.fetch;
  const rows: Row[] = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = String(init?.body ?? (input instanceof Request ? await input.text() : "null"));
    if (url.includes("/rest/v1/work_item_sync_timeline")) rows.push(JSON.parse(raw));
    if (url.includes("/rpc/finish_daily_update")) seals.push(JSON.parse(raw));
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const res = await h(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ work_item_id: WI }) }));
    text = await res.text();
  } finally { globalThis.fetch = real; }
  assertEquals(text, original);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "partial");
  assertEquals(rows[0].error_code, "PROVIDER_UNRESOLVED");
  noContradiction(rows[0]);
  assertEquals(seals.length, 1);
  assertEquals(seals[0]._status, "PARTIAL");
  assertEquals(seals[0]._error_code, "PROVIDER_UNRESOLVED");
});

Deno.test("pure: empty-string error code is not null (SQL IS NULL parity)", () => {
  assertEquals(enforceVerifiedOutcome({ status: "success", providers: ["publicaciones"], error_code: "" }).status, "partial");
});

Deno.test("actual wrapper: EMPTY producer names only real PP/SAMAI attempts and retains errors", async () => {
  for (const [attempts, provider] of [
    [{ publicaciones: true }, "publicaciones"],
    [{ samai_estados: true }, "samai_estados"],
    [{ publicaciones: true, samai_estados: true }, "publicaciones+samai_estados"],
    [{}, undefined],
  ] as const) {
    const body = { ok: true, status: "EMPTY", inserted_count: 0, skipped_count: 0,
      result_code: "SUCCESS_EMPTY", provider_used: attributeAttemptedProviders(attempts) };
    const { rows, text, original } = await run(body);
    assertEquals(text, original);
    assertEquals(rows[0].provider, provider ?? "unknown");
    assertEquals(rows[0].status, provider ? "empty" : "skipped");
    noContradiction(rows[0]);
    if (provider) {
      const failed = await run({ ...body, error_code: "SOURCE_CERTIFICATE_FAILED" });
      assertEquals([failed.rows[0].status, failed.rows[0].error_code], ["partial", "SOURCE_CERTIFICATE_FAILED"]);
    }
  }
});

Deno.test("actual wrapper: GET-only follow-up without origin token never seals a guessed daily cycle (repeat-safe)", async () => {
  const seals: unknown[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/rpc/finish_daily_update")) seals.push(init?.body);
    return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const body = JSON.stringify({ ok: true, provider_used: "publicaciones", inserted_count: 0, skipped_count: 2,
    rescrape_decision: { triggered: false, reason: "follow_admitted_run", backendRunId: "00000000-0000-4000-8000-000000000002" } });
  const h = withSyncTimeline(() => new Response(body, { headers: { "content-type": "application/json" } }),
    { function_name: "sync-publicaciones-by-work-item", default_operation: "publicaciones" });
  try {
    for (let n = 0; n < 2; n++) {
      const response = await h(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ work_item_id: WI }) }));
      assertEquals(await response.text(), body);
    }
  } finally { globalThis.fetch = previous; }
  assertEquals(seals.length, 0);
});
