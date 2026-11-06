import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  results: {} as Record<string, { data: Record<string, unknown>[] | null; error: { message: string } | null }>,
  queries: {} as Record<string, Record<string, any>>,
  rpc: vi.fn(), radicado: "12345678901234567890101",
}));
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (value: unknown) => value }));
vi.mock("../shared", () => ({
  requireAuth: () => null,
  resolveWorkItem: async () => ({ item: { id: "synthetic-matter", radicado: mock.radicado } }),
  sbForUser: () => ({ rpc: mock.rpc, from: (table: string) => {
    const q: Record<string, any> = {};
    for (const method of ["select", "eq", "or", "order", "limit", "range", "gte", "lt", "in", "is"]) q[method] = vi.fn(() => q);
    q.then = (resolve: (v: unknown) => unknown) => resolve(mock.results[table] ?? { data: [], error: null });
    mock.queries[table] = q;
    return q;
  } }),
  errorResult: (message: string) => ({ isError: true, message }),
  textResult: (text: string, data: unknown) => ({ text, structuredContent: data }),
  bogotaDayStartUTC: (day: string, plus = 0) => `${day}:${plus}`,
  bogotaToday: () => "2026-11-05",
}));
import list from "../tools/list-publicaciones";
import detail from "../tools/get-work-item";
import recent from "../tools/list-recent-estados";
import today from "../tools/get-estados-hoy";
import { publicationAssociation } from "../publication-association";
const ctx = {} as never;
const flag = { causa: "private third-party narrative", fuente: "official check", articulo: "123",
  sha256_original_providencia: "a".repeat(64), texto_auto: "private body" };
beforeEach(() => {
  vi.clearAllMocks(); mock.results = {}; mock.queries = {};
  mock.rpc.mockResolvedValue({ data: [], error: null });
});
describe("publication association through real MCP handlers", () => {
  it.each([list, detail, recent, today])("exposes flagged history without promoting normal rows or leaking flag bodies", async (tool) => {
    mock.results.work_item_publicaciones = { data: [
      { id: "flagged", fecha_fijacion: "2026-10-15", association_flag: flag },
      { id: "normal", fecha_fijacion: "2026-10-14", association_flag: null },
    ], error: null };
    const result = await tool.handler({ id: "synthetic-matter" } as never, ctx) as any;
    const payload = result.structuredContent;
    const rows = payload.publicaciones ?? payload.recent_estados ?? payload.estados;
    expect(rows.map((r: any) => r.calidad_asociacion.acreditada)).toEqual([false, null]);
    expect(rows[0].calidad_asociacion.sha256_original_providencia).toBe("a".repeat(64));
    expect(payload.resumen_publicaciones).toMatchObject({ registros_crudos: 2, asociacion_no_acreditada: 1, ultimo_estado_acreditado: null });
    if (tool === detail) expect(payload.cobertura_historica.estado).toBe("NO_EVALUADA_EN_ESTA_CONSULTA");
    expect(JSON.stringify(payload)).not.toContain("private");
    const selection = mock.queries.work_item_publicaciones.select.mock.calls[0][0];
    expect(selection).toContain("association_flag:raw_data->asociacion_no_acreditada");
    expect(selection.split(",").map((s: string) => s.trim())).not.toContain("raw_data");
  });
  it("keeps legitimate 00/01 streams; suffix mismatch is not a quality flag", async () => {
    mock.results.work_item_publicaciones = { data: [
      { id: "stream00", association_flag: null, source: "publicaciones" },
      { id: "stream01", association_flag: null, source: "publicaciones" },
    ], error: null };
    const result = await list.handler({ id: "synthetic-matter" } as never, ctx) as any;
    expect(result.structuredContent.publicaciones.map((r: any) => r.id)).toEqual(["stream00", "stream01"]);
    expect(result.structuredContent.publicaciones.every((r: any) => !r.asociacion_no_acreditada)).toBe(true);
    expect(mock.queries.work_item_publicaciones.eq.mock.calls).toEqual([["work_item_id", "synthetic-matter"]]);
    for (const suffix of ["00", "01"]) expect(publicationAssociation({ association_flag: null }, mock.radicado.slice(0, 21) + suffix).calidad_asociacion.acreditada).toBeNull();
  });
  it("bounds page before header RPC, exposes continuation and never filters flagged rows after pagination", async () => {
    mock.results.work_item_publicaciones = { data: [
      { id: "a", association_flag: flag }, { id: "b", association_flag: null }, { id: "lookahead", association_flag: flag },
    ], error: null };
    const result = await list.handler({ id: "synthetic-matter", limit: 2, offset: 4 } as never, ctx) as any;
    expect(mock.queries.work_item_publicaciones.range).toHaveBeenCalledWith(4, 6);
    expect(result.structuredContent).toMatchObject({ has_more: true, next_offset: 6 });
    expect(result.structuredContent.publicaciones.map((r: any) => r.id)).toEqual(["a", "b"]);
    expect(mock.rpc).toHaveBeenCalledWith("publicacion_auto_text_prefix", { p_ids: ["a", "b"] });
  });
  it("marks the final page, including empty pages, without fabricating totals", async () => {
    const result = await list.handler({ id: "synthetic-matter", limit: 1, offset: 10 } as never, ctx) as any;
    expect(result.structuredContent).toMatchObject({ has_more: false, next_offset: null, resumen_publicaciones: { registros_crudos: 0, alcance: "pagina_devuelta" } });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([list, detail, recent, today])("returns publication read errors instead of empty/accredited history", async (tool) => {
    mock.results.work_item_publicaciones = { data: null, error: { message: "synthetic read failure" } };
    const result = await tool.handler({ id: "synthetic-matter" } as never, ctx) as any;
    expect(result.isError).toBe(true); expect(result.message).toContain("synthetic read failure");
    expect(result.structuredContent).toBeUndefined();
  });
  it.each([recent, today])("does not hide matter enrichment errors", async (tool) => {
    mock.results.work_item_publicaciones = { data: [{ id: "a", work_item_id: "synthetic-matter", association_flag: flag }], error: null };
    mock.results.work_items = { data: null, error: { message: "synthetic identity read error" } };
    const result = await tool.handler({} as never, ctx) as any;
    expect(result.isError).toBe(true); expect(result.message).toContain("synthetic identity read error");
  });
  it("preserves flag despite date-prefix failure and reports date not verifiable", async () => {
    mock.results.work_item_publicaciones = { data: [{ id: "a", association_flag: flag }], error: null };
    mock.rpc.mockResolvedValue({ data: null, error: { message: "synthetic prefix error" } });
    const result = await list.handler({ id: "synthetic-matter" } as never, ctx) as any;
    expect(result.structuredContent.publicaciones[0]).toMatchObject({ asociacion_no_acreditada: true, fecha_auto_encabezado_estado: "no_verificable" });
  });
});
