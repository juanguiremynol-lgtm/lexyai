import { strict as assert } from "node:assert";
import { invokeInternal } from "./internalInvoke.ts";

Deno.test("internal invoke sends explicit bearer for opaque keys and surfaces 401", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const oldUrl = Deno.env.get("SUPABASE_URL");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_synthetic");
  Deno.env.set("SUPABASE_URL", "http://localhost");
  let captured: Request | undefined;
  let status = 200;
  globalThis.fetch = async (input, init) => {
    captured = new Request(input, init);
    return new Response(JSON.stringify(status === 200 ? { ok: true } : { code: "UNAUTHORIZED" }), { status });
  };
  try {
    const ok = await invokeInternal("sync-by-work-item", { work_item_id: "w", _scheduled: true }, "atenia-ai-supervisor", { taskId: "t1" });
    assert.equal(ok.error, null);
    assert.equal(captured!.headers.get("authorization"), "Bearer sb_secret_synthetic");
    assert.equal(captured!.headers.get("x-invoker-function"), "atenia-ai-supervisor");
    assert.equal(captured!.headers.get("x-retry-task-id"), "t1");
    status = 401;
    const denied = await invokeInternal("sync-by-work-item", { work_item_id: "w", _scheduled: true }, "x");
    assert.equal(denied.status, 401);
    assert.ok(denied.error);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", oldUrl);
  }
});
