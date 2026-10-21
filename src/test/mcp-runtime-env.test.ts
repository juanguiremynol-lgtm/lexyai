import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseProjectUrl, supabasePublishableKey } from "@/lib/mcp/shared";

// The MCP runs on the Deno edge runtime: config must resolve from Deno.env and
// the SUPABASE_PUBLISHABLE_KEYS dictionary, not only from process.env.
describe("MCP runtime env", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("reads URL and key from Deno.env when process.env lacks them", () => {
    vi.stubEnv("SUPABASE_URL", ""); vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", ""); vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    const env: Record<string, string> = {
      SUPABASE_URL: "https://ref.supabase.co",
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_abc" }),
    };
    vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });
    expect(supabaseProjectUrl()).toBe("https://ref.supabase.co");
    expect(supabasePublishableKey()).toBe("sb_publishable_abc");
  });

  it("fails explicitly when no key is configured", () => {
    vi.stubEnv("SUPABASE_ANON_KEY", ""); vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", ""); vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    expect(() => supabasePublishableKey()).toThrow(/Clave pública/);
  });
});
