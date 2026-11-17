import { describe, expect, it, vi } from "vitest";
import { classifyBackendFailure, worstFailure, backendFailureResult } from "../backend-failure";

vi.mock("../shared", async (orig) => {
  const real = await orig<typeof import("../shared")>();
  return { ...real, sbForUser: vi.fn() };
});
import * as shared from "../shared";
import getCapabilities from "../tools/get-capabilities";

describe("classifyBackendFailure", () => {
  it.each([
    [{ code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." }, 503, "BACKEND_UNAVAILABLE"],
    [{ message: "" }, 500, "BACKEND_UNAVAILABLE"],
    [{ message: "" }, 502, "BACKEND_UNAVAILABLE"],
    [{ message: "" }, 504, "BACKEND_UNAVAILABLE"],
    [{ message: "" }, 521, "BACKEND_UNAVAILABLE"],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, 500, "BACKEND_UNAVAILABLE"],
    [{ code: "PGRST301", message: "JWT expired" }, 401, "AUTH_REQUIRED"],
    [{ message: "" }, 401, "AUTH_REQUIRED"],
    [{ code: "42501", message: "permission denied for function" }, 403, "EXECUTION_UNAVAILABLE"],
    [{ code: "PGRST202", message: "not found" }, 404, "EXECUTION_UNAVAILABLE"],
  ])("%o status %s -> %s", (err, status, kind) => {
    expect(classifyBackendFailure(err, status).kind).toBe(kind);
  });
  it("thrown transport errors are outages", () => {
    expect(classifyBackendFailure(new TypeError("fetch failed")).kind).toBe("BACKEND_UNAVAILABLE");
    expect(classifyBackendFailure(Object.assign(new Error("x"), { name: "AbortError" })).signal).toBe("TIMEOUT");
    expect(classifyBackendFailure(new Error("getaddrinfo ENOTFOUND host")).kind).toBe("BACKEND_UNAVAILABLE");
  });
  it("outage outranks credential symptoms", () => {
    expect(worstFailure([{ kind: "AUTH_REQUIRED", signal: "HTTP_401" }, { kind: "BACKEND_UNAVAILABLE", signal: "HTTP_522" }])?.kind).toBe("BACKEND_UNAVAILABLE");
  });
  it("outage result never recommends reconnecting nor grants manage", () => {
    const r = backendFailureResult({ kind: "BACKEND_UNAVAILABLE", signal: "PGRST002" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ can_manage: false, access_verified: false, reconnect_recommended: false, retryable: true });
    expect(r.content[0].text).not.toMatch(/Vuelve a conectar/);
  });
});

function ctx() {
  return { isAuthenticated: () => true, getToken: () => "t", getUserId: () => "u" } as never;
}
function sbWith(rpc: (name: string) => Promise<unknown>) {
  vi.mocked(shared.sbForUser).mockReturnValue({ rpc } as never);
}
const run = (getCapabilities as unknown as { handler: (a: unknown, c: unknown) => Promise<{ isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] }> }).handler;

describe("get_capabilities failure handling", () => {
  it("schema-cache RPC error -> BACKEND_UNAVAILABLE, no reconnect, no manage", async () => {
    sbWith(async () => ({ data: null, error: { code: "PGRST002", message: "schema cache" }, status: 503 }));
    const r = await run({}, ctx());
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.reason).toBe("BACKEND_UNAVAILABLE");
    expect(r.structuredContent?.can_manage).toBe(false);
    expect(r.content[0].text).not.toMatch(/Vuelve a conectar/);
  });
  it("thrown fetch -> BACKEND_UNAVAILABLE", async () => {
    sbWith(async () => { throw new TypeError("fetch failed"); });
    const r = await run({}, ctx());
    expect(r.structuredContent?.reason).toBe("BACKEND_UNAVAILABLE");
  });
  it("mixed 401 + 522 -> outage wins", async () => {
    sbWith(async (n) => n === "mcp_access_level"
      ? { data: null, error: { code: "PGRST301", message: "JWT" }, status: 401 }
      : { data: null, error: { message: "" }, status: 522 });
    expect((await run({}, ctx())).structuredContent?.reason).toBe("BACKEND_UNAVAILABLE");
  });
  it("genuine 401 -> AUTH_REQUIRED recommends reconnect", async () => {
    sbWith(async () => ({ data: null, error: { code: "PGRST301", message: "JWT expired" }, status: 401 }));
    const r = await run({}, ctx());
    expect(r.structuredContent?.reason).toBe("AUTH_REQUIRED");
    expect(r.structuredContent?.reconnect_recommended).toBe(true);
  });
  it("permission denied on RPC -> EXECUTION_UNAVAILABLE", async () => {
    sbWith(async () => ({ data: null, error: { code: "42501", message: "denied" }, status: 403 }));
    expect((await run({}, ctx())).structuredContent?.reason).toBe("EXECUTION_UNAVAILABLE");
  });
  it("healthy manage grant still lists tools", async () => {
    sbWith(async (n) => ({ error: null, status: 200, data:
      n === "mcp_access_level" ? "manage"
      : n === "mcp_caller_context" ? { authenticated: true, surface: "oauth" }
      : { verified: true, tools: { add_note: { available: true } } } }));
    const r = await run({}, ctx());
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.manage_tools).toEqual(["add_note"]);
  });
});
