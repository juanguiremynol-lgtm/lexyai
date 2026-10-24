import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import { MANAGE_REQUIRED, requireWriteScope, rpcErrorText } from "@/lib/mcp/shared";

function ctx(authenticated = true) {
  return {
    isAuthenticated: () => authenticated,
    getToken: () => "token",
    getClaims: () => ({ scope: "read_write" }),
  } as never;
}

describe("MCP manage guard (fail-closed)", () => {
  it("denies a read-level OAuth connection even when the token claims read_write", async () => {
    vi.stubGlobal("Deno", { env: { get: (k: string) => ({ SUPABASE_URL: "https://x.invalid", SUPABASE_ANON_KEY: "k" } as Record<string, string>)[k] } });
    rpc.mockResolvedValueOnce({ data: "read", error: null });
    expect(await requireWriteScope(ctx())).toBe(MANAGE_REQUIRED);
  });

  it("allows only the database-decided manage level", async () => {
    rpc.mockResolvedValueOnce({ data: "manage", error: null });
    expect(await requireWriteScope(ctx())).toBeNull();
  });

  it("denies when the permission check itself fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await requireWriteScope(ctx())).toMatch(/No se pudo verificar/);
  });

  it("maps the database grant error to the enable-instructions text", () => {
    expect(rpcErrorText({ code: "MCP01", message: "x" })).toBe(MANAGE_REQUIRED);
    expect(rpcErrorText({ code: "MCP09", message: "STALE_REVISION" })).toMatch(/nada se modificó/);
  });
});
