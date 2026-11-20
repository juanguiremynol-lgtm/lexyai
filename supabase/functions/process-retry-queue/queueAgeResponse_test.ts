import { strict as assert } from "node:assert";
import { AuthClient } from "npm:@supabase/supabase-js@2";

Deno.test("ordinary retry drain reports queue age independently of source observations and coverage", async () => {
  const previousUrl = Deno.env.get("SUPABASE_URL");
  const previousKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const originalRefresh = AuthClient.prototype.startAutoRefresh;
  let handler!: (request: Request) => Promise<Response>;
  try {
    Deno.env.set("SUPABASE_URL", "https://retry.unit.invalid");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "retry-test-service");
    // No user session or expiring token is involved in the synthetic service request.
    AuthClient.prototype.startAutoRefresh = async () => {};
    Deno.serve = ((fn: typeof handler) => { handler = fn; }) as unknown as typeof Deno.serve;
    await import("./index.ts");

    for (const count of [5, 0, null]) {
      let countQueries = 0;
      globalThis.fetch = async (input, init) => {
        const req = new Request(input, init);
        const url = new URL(req.url);
        assert.equal(url.host, "retry.unit.invalid");
        if (url.pathname.endsWith("/rpc/claim_sync_retry") || url.pathname.endsWith("/rpc/claim_sync_retry_pp_poll")) {
          return Response.json([]);
        }
        assert.equal(url.pathname, "/rest/v1/sync_retry_queue");
        assert.equal(req.method, "HEAD");
        assert.equal(url.searchParams.get("attempt"), "eq.0");
        assert.equal(url.searchParams.has("next_run_at"), false);
        const cutoff = url.searchParams.get("created_at")!;
        assert.ok(cutoff.startsWith("lt."));
        assert.ok(Math.abs(Date.now() - Date.parse(cutoff.slice(3)) - 48 * 3600_000) < 5000);
        countQueries++;
        return new Response(null, { headers: count === null ? {} : { "content-range": "*/" + count } });
      };
      const body = await (await handler(new Request("https://handler.unit.invalid", {
        method: "POST", headers: { authorization: "Bearer retry-test-service" }, body: "{}",
      }))).json();
      assert.equal(body.ok, true);
      assert.equal(countQueries, 1);
      assert.deepEqual(body.queue_age, {
        target_hours: 48, open_tasks_with_zero_counted_attempts_over_target: count,
        target_met: count === null ? null : count === 0, includes_deferred_tasks: true,
      });
      assert.equal(body.sla_scope, "QUEUE_AGE_ONLY");
      assert.equal(body.first_query_target_hours, 48);
      assert.equal(body.overdue_initial_queries, count);
      assert.equal(body.sla_met, count === 0);
      assert.equal(body.source_first_query_sla, "NOT_EVALUATED");
      assert.equal(body.source_daily_coverage, "NOT_EVALUATED");
    }
  } finally {
    AuthClient.prototype.startAutoRefresh = originalRefresh;
    globalThis.fetch = originalFetch;
    Deno.serve = originalServe;
    if (previousUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", previousUrl);
    if (previousKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousKey);
  }
});
