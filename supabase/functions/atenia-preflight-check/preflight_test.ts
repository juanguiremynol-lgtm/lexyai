import { strict as assert } from "node:assert";

Deno.test({ name: "preflight verifies sample shape, distinguishes warnings, and requires a durable result", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const originalServe = Deno.serve;
  const originalFetch = globalThis.fetch;
  const env = {
    SUPABASE_URL: "https://preflight-db.invalid", SUPABASE_ANON_KEY: "test-anon",
    CRON_SERVICE_KEY: "test-cron", SUPABASE_SERVICE_ROLE_KEY: "test-service", EXTERNAL_X_API_KEY: "test-upstream",
    CPNU_BASE_URL: "https://cpnu.invalid", PUBLICACIONES_BASE_URL: "https://pp.invalid",
    SAMAI_ESTADOS_BASE_URL: "https://estados.invalid",
  };
  const prior = Object.keys(env).map(k => [k, Deno.env.get(k)] as const);
  let handler!: (req: Request) => Promise<Response>;
  let rejectInsert = false, malformed = true, logged = 0;
  let wrongPpCase = false;
  let admission = "RUN";
  const writes: Array<Record<string, unknown>> = [];
  const routes: string[] = [];
  try {
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    Deno.serve = ((fn: typeof handler) => { handler = fn; }) as unknown as typeof Deno.serve;
    await import("./index.ts");
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const { hostname, pathname } = new URL(request.url);
      if (hostname === "preflight-db.invalid") {
        if (pathname.endsWith("/rpc/claim_atenia_daily_preflight")) return Response.json(admission);
        if (pathname.endsWith("/atenia_preflight_checks") && request.method === "GET") return Response.json({ overall_status:"PARTIAL", decision:"PROCEED_DEGRADED", results:[], started_at:new Date().toISOString() });
        if (pathname === "/auth/v1/user") return Response.json({ id: "test-user" });
        if (pathname.endsWith("/provider_connectors")) return Response.json([]);
        if (pathname.endsWith("/atenia_ai_actions")) { logged++; return Response.json({ id: "test-log" }); }
        if (pathname.endsWith("/atenia_preflight_checks")) {
          if (rejectInsert) return Response.json({ code: "23514", message: "simulated rejection" }, { status: 400 });
          writes.push(await request.json());
          return Response.json(null, { status: 201 });
        }
        throw new Error("unexpected database route: " + pathname);
      }
      routes.push(pathname);
      if (hostname === "pp.invalid") {
        return malformed ? Response.json({ detail: "Not found" }, { status: 404 })
          : Response.json({ radicado_completo: wrongPpCase ? "05001400301520240193001" : pathname.split("/").at(-1),
            radicado_corto: "2024-01930", proceso: { año: "2024", consecutivo: "01930" } });
      }
      if (hostname === "cpnu.invalid") return Response.json(malformed ? { error: "application error" } : { data: { actuaciones: [] } });
      if (hostname === "estados.invalid") return Response.json({ result: { estados: [] } });
      if (hostname === "samai-read-api-11974381924.us-central1.run.app") return Response.json({ result: { feedCombinado: [] } });
      throw new Error("unrecognized provider in offline test");
    };
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
    // Real auth SDK delegates HS256 verification to the locally intercepted user endpoint.
    const claims = { sub: "test-user", role: "service_role", exp: Math.floor(Date.now()/1000) + 600 };
    const bearer = [encode({ alg: "HS256", typ: "JWT" }), encode(claims), encode("fixture")].join(".");
    const invoke = () => handler(new Request("https://handler.invalid", {
      method: "POST", headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "MANUAL" }),
    }));
    const partial = await invoke();
    const first = await partial.json();
    assert.equal(partial.status, 200, JSON.stringify(first));
    assert.equal(first.overall, "PARTIAL");
    assert.equal(first.decision, "PROCEED_DEGRADED");
    assert.equal(writes[0].providers_passed, 2);
    assert.equal(writes[0].providers_failed, 0);
    assert.ok(routes.some(p => p.startsWith("/info/")));
    malformed = false;
    const complete = await (await invoke()).json();
    assert.equal(complete.overall, "ALL_PASS");
    wrongPpCase = true;
    const mismatch = await (await invoke()).json();
    assert.equal(mismatch.overall, "PARTIAL");
    assert.equal(mismatch.results.find((r: { provider: string }) => r.provider === "PUBLICACIONES").checks.data_shape.ok, false);
    wrongPpCase = false;
    rejectInsert = true;
    const rejected = await invoke();
    assert.equal(rejected.status, 500);
    assert.equal((await rejected.json()).ok, false);
    assert.equal(logged, 3);
    assert.ok(routes.some(path => path.startsWith("/persistido/")));
    rejectInsert = false;
    const probe = (headers: Record<string,string>, trigger: string) => handler(new Request("https://handler.invalid", {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ trigger }),
    }));
    const routeCount = routes.length;
    admission = "CACHED";
    const cached = await probe({authorization:"Bearer test-service"}, "PRE_DAILY_SYNC");
    assert.equal((await cached.json()).cached, true);
    admission = "DEFERRED";
    assert.equal((await probe({"x-cron-key":"test-cron"}, "CONTROLLED_DAILY_PREFLIGHT")).status, 202);
    assert.equal((await probe({"x-cron-key":"test-cron"}, "MANUAL")).status, 403);
    assert.equal(routes.length, routeCount);
    assert.equal(logged, 3);
  } finally {
    Deno.serve = originalServe;
    globalThis.fetch = originalFetch;
    for (const [k,v] of prior) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k,v); }
  }
}});
