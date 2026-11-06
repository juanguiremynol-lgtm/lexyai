import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown[] | null; error: { message: string } | null }>,
  denied: null as string | null,
}));
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (value: unknown) => value }));
vi.mock("../shared", () => ({
  requirePlatformAdmin: async () => ({ error: mock.denied, sb: { from: (table: string) => {
    const q: Record<string, any> = {};
    for (const method of ["select", "order", "limit"]) q[method] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => resolve(mock.results[table] ?? { data: [], error: null });
    return q;
  } } }),
  errorResult: (message: string) => ({ isError: true, message }),
  textResult: (text: string, data: unknown) => ({ text, structuredContent: data }),
}));
import overview from "../tools/atenia-health-overview";
import providers from "../tools/atenia-provider-status";
const ctx = {} as never;
beforeEach(() => { mock.results = {}; mock.denied = null; });

describe("Atenia health evidence through the actual MCP handlers", () => {
  it("marks an absent preflight and heartbeats unknown instead of implying health", async () => {
    const result = await overview.handler({} as never, ctx) as any;
    expect(result.structuredContent).toMatchObject({ ultimo_preflight: null,
      estado_preflight: "DESCONOCIDO_SIN_PREFLIGHT", estado_latidos: "DESCONOCIDO_SIN_LATIDOS" });
    expect(result.text).toContain("no acreditan cobertura");
    expect(result.text).not.toContain("0 servicio(s) degradado(s)");
  });
  it.each(["atenia_preflight_checks", "system_health_heartbeat", "atenia_cron_runs"])("fails closed when %s cannot be read", async (table) => {
    mock.results[table] = { data: null, error: { message: "read failed" } };
    const result = await overview.handler({} as never, ctx) as any;
    expect(result.isError).toBe(true);
    expect(result.message).toContain("no es posible concluir");
  });
  it("labels a missing preflight or empty provider results unknown", async () => {
    let result = await providers.handler({} as never, ctx) as any;
    expect(result.structuredContent.estado).toBe("DESCONOCIDO_SIN_PREFLIGHT");
    mock.results.atenia_preflight_checks = { data: [{ overall_status: "OK", providers_tested: 4, results: [] }], error: null };
    result = await providers.handler({} as never, ctx) as any;
    expect(result.structuredContent.estado).toBe("DESCONOCIDO_SIN_RESULTADOS");
    expect(result.text).not.toContain("4 proveedores OK");
  });
  it("preserves recorded provider details without claiming recent coverage", async () => {
    mock.results.atenia_preflight_checks = { data: [{ started_at: "2026-01-01", overall_status: "OK", providers_passed: 1, providers_tested: 1, results: [{ status: "OK" }] }], error: null };
    const result = await providers.handler({} as never, ctx) as any;
    expect(result.structuredContent.estado).toBe("REGISTRADO_FRESCURA_NO_EVALUADA");
    expect(result.structuredContent.proveedores).toHaveLength(1);
  });
  it("does not disclose health to non-admins", async () => {
    mock.denied = "Not authorized";
    for (const tool of [overview, providers]) expect(((await tool.handler({} as never, ctx)) as any).isError).toBe(true);
  });
});
