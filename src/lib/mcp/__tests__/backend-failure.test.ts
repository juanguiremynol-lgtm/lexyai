import { describe, expect, it, vi, beforeEach } from "vitest";
import { classifyBackendFailure, worstFailure, backendFailureResult, settleQuery } from "../backend-failure";

// Mock only the SDK client factory so the real sbForUser/requireWriteScope run.
let factory: () => unknown = () => { throw new Error("client not configured"); };
vi.mock("@supabase/supabase-js", () => ({ createClient: () => factory() }));
process.env.SUPABASE_URL = "https://example.invalid";
process.env.SUPABASE_ANON_KEY = "public-test-key";
import * as shared from "../shared";
import getCapabilities from "../tools/get-capabilities";
import getUserContext from "../tools/get-user-context";

type Res = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] };
const handler = (t: unknown) => (t as { handler: (a: unknown, c: unknown) => Promise<Res> }).handler;
const ctx = () => ({ isAuthenticated: () => true, getToken: () => "t", getUserId: () => "u", getUserEmail: () => "e" }) as never;

const REAL_PGRST202 = { code: "PGRST202", message: "Could not find the function public.mcp_access_level without parameters in the schema cache", hint: null, details: "Searched for the function public.mcp_access_level" };
const REAL_PGRST002 = { code: "PGRST002", message: "Could not query the database for the schema cache. Retrying.", hint: null, details: null };

describe("classifyBackendFailure", () => {
  it.each([
    [{ code: "PGRST000", message: "Could not connect with the database" }, 503, "BACKEND_UNAVAILABLE", "PGRST000"],
    [{ code: "PGRST001", message: "Could not connect due to internal error" }, 503, "BACKEND_UNAVAILABLE", "PGRST001"],
    [REAL_PGRST002, 503, "BACKEND_UNAVAILABLE", "PGRST002"],
    [{ code: "PGRST003", message: "Timed out acquiring connection from connection pool." }, 504, "BACKEND_UNAVAILABLE", "PGRST003"],
    [REAL_PGRST202, 404, "EXECUTION_UNAVAILABLE", "PGRST202"],
    [{ message: "" }, 500, "BACKEND_UNAVAILABLE", "HTTP_500"],
    [{ message: "" }, 502, "BACKEND_UNAVAILABLE", "HTTP_502"],
    [{ message: "" }, 504, "BACKEND_UNAVAILABLE", "HTTP_504"],
    [{ message: "" }, 521, "BACKEND_UNAVAILABLE", "HTTP_521"],
    [{ message: "" }, 522, "BACKEND_UNAVAILABLE", "HTTP_522"],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, 500, "BACKEND_UNAVAILABLE", "57014"],
    [{ code: "PGRST301", message: "JWT expired" }, 401, "AUTH_REQUIRED", "PGRST301"],
    [{ message: "" }, 401, "AUTH_REQUIRED", "HTTP_401"],
    [{ code: "42501", message: "permission denied for function mcp_access_level" }, 403, "EXECUTION_UNAVAILABLE", "42501"],
  ])("%o status %s -> %s/%s", (err, status, kind, signal) => {
    expect(classifyBackendFailure(err, status)).toEqual({ kind, signal });
  });

  it("transport throws need transport evidence", () => {
    expect(classifyBackendFailure(new TypeError("fetch failed")).kind).toBe("BACKEND_UNAVAILABLE");
    expect(classifyBackendFailure(Object.assign(new Error("x"), { name: "AbortError" })).signal).toBe("TIMEOUT");
    expect(classifyBackendFailure(new TypeError("x", { cause: { code: "ENOTFOUND" } })).signal).toBe("NETWORK");
    // A programming TypeError is not a network outage.
    expect(classifyBackendFailure(new TypeError("Cannot read properties of undefined (reading 'rpc')"))).toEqual({ kind: "SESSION_UNVERIFIED", signal: "INTERNAL" });
  });

  it("signal never copies arbitrary codes or messages", () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
    for (const code of [secret, "abc def", "PGRST12", "<script>", "1234567"]) {
      const f = classifyBackendFailure({ code, message: `private ${secret}` }, null);
      expect(f.signal).toBe("UNKNOWN");
      expect(JSON.stringify(backendFailureResult(f))).not.toContain(secret);
    }
  });

  it("outage outranks credential symptoms", () => {
    expect(worstFailure([{ kind: "AUTH_REQUIRED", signal: "HTTP_401" }, { kind: "BACKEND_UNAVAILABLE", signal: "HTTP_522" }])?.kind).toBe("BACKEND_UNAVAILABLE");
  });

  it("outage result never recommends reconnecting, grants nothing, does not assert universal facts", () => {
    const r = backendFailureResult({ kind: "BACKEND_UNAVAILABLE", signal: "PGRST002" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ can_manage: false, access_verified: false, reconnect_recommended: false, retryable: true });
    expect(r.content[0].text).not.toMatch(/Vuelve a conectar|no es tu cuenta|temporal/i);
  });

  it("settleQuery catches synchronous construction throws", async () => {
    const r = await settleQuery(() => { throw new TypeError("fetch failed"); });
    expect(r).toEqual({ ok: false, failure: { kind: "BACKEND_UNAVAILABLE", signal: "NETWORK" } });
  });
});

const sbFor = (impl: Record<string, unknown>) => { factory = () => impl; };
beforeEach(() => { factory = () => { throw new Error("client not configured"); }; });

describe("get_capabilities", () => {
  const run = handler(getCapabilities);
  const rpcs = (fn: (n: string) => unknown) => sbFor({ rpc: fn });
  it("real PGRST002 -> BACKEND_UNAVAILABLE, no reconnect, no manage", async () => {
    rpcs(async () => ({ data: null, error: REAL_PGRST002, status: 503 }));
    const r = await run({}, ctx());
    expect(r.structuredContent).toMatchObject({ reason: "BACKEND_UNAVAILABLE", can_manage: false, reconnect_recommended: false });
    expect(r.structuredContent).not.toHaveProperty("manage_tools");
    expect(r.content[0].text).not.toMatch(/Vuelve a conectar/);
  });
  it("real PGRST202 -> EXECUTION_UNAVAILABLE", async () => {
    rpcs(async () => ({ data: null, error: REAL_PGRST202, status: 404 }));
    expect((await run({}, ctx())).structuredContent?.reason).toBe("EXECUTION_UNAVAILABLE");
  });
  it("rejected promise -> BACKEND_UNAVAILABLE", async () => {
    rpcs(async () => { throw new TypeError("fetch failed"); });
    expect((await run({}, ctx())).structuredContent?.reason).toBe("BACKEND_UNAVAILABLE");
  });
  it("synchronous rpc throw is fail-closed", async () => {
    rpcs(() => { throw new Error("boom"); });
    const r = await run({}, ctx());
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ reason: "SESSION_UNVERIFIED", signal: "INTERNAL", can_manage: false });
  });
  it("sbForUser throw is fail-closed", async () => {
    factory = () => { throw new Error("no key"); };
    let r: Res | undefined; let thrown: unknown;
    try { r = await run({}, ctx()); } catch (e) { thrown = e; }
    expect(thrown).toBeUndefined();
    expect(r?.structuredContent).toMatchObject({ reason: "SESSION_UNVERIFIED", signal: "INTERNAL", can_manage: false });
  });
  it("mixed 401 + 522 -> outage wins", async () => {
    rpcs(async (n) => n === "mcp_access_level"
      ? { data: null, error: { code: "PGRST301", message: "JWT" }, status: 401 }
      : { data: null, error: { message: "" }, status: 522 });
    expect((await run({}, ctx())).structuredContent?.reason).toBe("BACKEND_UNAVAILABLE");
  });
  it("genuine 401 -> AUTH_REQUIRED recommends reconnect", async () => {
    rpcs(async () => ({ data: null, error: { code: "PGRST301", message: "JWT expired" }, status: 401 }));
    expect((await run({}, ctx())).structuredContent).toMatchObject({ reason: "AUTH_REQUIRED", reconnect_recommended: true });
  });
  it("healthy manage grant still lists tools", async () => {
    rpcs(async (n) => ({ error: null, status: 200, data:
      n === "mcp_access_level" ? "manage"
      : n === "mcp_caller_context" ? { authenticated: true, surface: "oauth" }
      : { verified: true, tools: { add_note: { available: true } } } }));
    const r = await run({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.manage_tools).toEqual(["add_note"]);
  });
});

/** Minimal chainable PostgREST builder mock; resolves per table/call. */
function fromMock(resolve: (table: string, call: number, head: boolean) => unknown) {
  const calls: Record<string, number> = {};
  return {
    from(table: string) {
      let head = false;
      const b: Record<string, unknown> = {};
      const chain = () => b;
      Object.assign(b, {
        select: (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return b; },
        eq: chain, is: chain, order: chain, limit: chain, gt: chain,
        maybeSingle: () => b,
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          calls[table] = (calls[table] ?? 0) + 1;
          return Promise.resolve().then(() => resolve(table, calls[table], head)).then(ok, ko);
        },
      });
      return b;
    },
  };
}

describe("get_user_context", () => {
  const run = handler(getUserContext);
  const okProfile = { data: { full_name: "A" }, error: null, status: 200 };
  const okArchived = { data: null, error: null, status: 200, count: 2 };
  it("profile 401 + archived 522 -> outage, not reconnect", async () => {
    sbFor(fromMock((t, _c, head) => t === "profiles"
      ? { data: null, error: { code: "PGRST301", message: "JWT" }, status: 401 }
      : head ? { data: null, error: { message: "" }, status: 522 } : { data: [], error: null }));
    const r = await run({}, ctx());
    expect(r.structuredContent).toMatchObject({ reason: "BACKEND_UNAVAILABLE", reconnect_recommended: false });
  });
  it("real PGRST002 on profile -> BACKEND_UNAVAILABLE", async () => {
    sbFor(fromMock((t, _c, head) => t === "profiles" ? { data: null, error: REAL_PGRST002, status: 503 } : head ? okArchived : { data: [], error: null }));
    expect((await run({}, ctx())).structuredContent?.reason).toBe("BACKEND_UNAVAILABLE");
  });
  it("failure on a later page returns no partial count", async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => ({ id: `id${i}`, workflow_type: "CGP" }));
    sbFor(fromMock((t, call, head) => {
      if (t === "profiles") return okProfile;
      if (head) return okArchived;
      // work_items: call 1 = archived head, 2 = page 1, 3 = page 2 fails.
      return call === 2 ? { data: page1, error: null, status: 200 } : { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" }, status: 500 };
    }));
    const r = await run({}, ctx());
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.reason).toBe("BACKEND_UNAVAILABLE");
    expect(r.structuredContent).not.toHaveProperty("active_work_items");
  });
  it("sync throw building a query is fail-closed", async () => {
    sbFor({ from: () => { throw new Error("boom"); } });
    expect((await run({}, ctx())).isError).toBe(true);
  });
  it("healthy path counts all pages", async () => {
    sbFor(fromMock((t, call, head) => t === "profiles" ? okProfile : head ? okArchived
      : call === 2 ? { data: [{ id: "a", workflow_type: "CGP" }, { id: "b", workflow_type: "PETICION" }], error: null } : { data: [], error: null }));
    const r = await run({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ active_work_items: 2, archived_work_items: 2 });
  });
});

describe("requireWriteScope", () => {
  it("outage text does not ask to reconnect", async () => {
    sbFor({ rpc: async () => ({ data: null, error: { message: "" }, status: 522 }) });
    const t = await shared.requireWriteScope(ctx());
    expect(t).toBeTruthy();
    expect(t).not.toMatch(/Vuelve a conectar/);
  });
  it("sync throw is fail-closed", async () => {
    sbFor({ rpc: () => { throw new Error("boom"); } });
    expect(await shared.requireWriteScope(ctx())).toBeTruthy();
  });
  it("manage grant passes; read is blocked", async () => {
    sbFor({ rpc: async () => ({ data: "manage", error: null, status: 200 }) });
    expect(await shared.requireWriteScope(ctx())).toBeNull();
    sbFor({ rpc: async () => ({ data: "read", error: null, status: 200 }) });
    expect(await shared.requireWriteScope(ctx())).toBe(shared.MANAGE_REQUIRED);
  });
});
