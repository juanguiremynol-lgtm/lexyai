import { strict as assert } from "node:assert";
import { dispatchRetry } from "./retryDispatch.ts";
import { requirePrivilegedCaller } from "./privilegedCaller.ts";

Deno.test("explicit retry identity and privileged endpoint acceptance/rejection", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-test-service");
  let captured: Request | undefined;
  globalThis.fetch = async (input, init) => {
    captured = new Request(input, init);
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  };
  try {
    const response = await dispatchRetry("http://localhost", "synthetic-test-service", "sync-by-work-item", "test-item", "task-1", "trace-1");
    await response.text();
    assert.ok(captured);
    assert.equal(captured.headers.get("authorization"), "Bearer synthetic-test-service");
    assert.equal(captured.headers.get("x-invoker-function"), "process-retry-queue");
    assert.equal(captured.headers.get("x-retry-task-id"), "task-1");
    assert.equal((await captured.json())._scheduled, true);
    assert.equal((await requirePrivilegedCaller(new Request("http://localhost", { headers: { authorization: "Bearer synthetic-test-service" } }))).ok, true);
    const denied = await requirePrivilegedCaller(new Request("http://localhost"));
    assert.equal(denied.ok, false);
    assert.equal(denied.response?.status, 401);
    await denied.response?.text();
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
  }
});