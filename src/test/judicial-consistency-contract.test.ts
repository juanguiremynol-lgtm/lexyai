import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractHearingsFromAct, buildBogotaTimestamptz } from "../../supabase/functions/_shared/hearingExtractor";
import { hasUsableRadicado, resolveActsEmptyState, judicialQueryState } from "@/lib/monitoring-reason";
const { client, query, insert, update, rpc } = vi.hoisted(() => {
  const query: Record<string, any> = {};
  const insert = vi.fn(); const update = vi.fn(); const rpc = vi.fn();
  const client = { from: vi.fn(() => query), rpc };
  return { client, query, insert, update, rpc };
});
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (d: unknown) => d }));
vi.mock("@/lib/mcp/shared", () => ({
  requireWriteScope: async () => null, requireAuth: () => null,
  sbForUser: () => client, callerOrganizationId: async () => "org",
  resolveWorkItem: async () => ({ item: { id: "wi", radicado: "05001333301020230019900" } }),
  errorResult: (message: string) => ({ isError: true, message }), rpcErrorText: (e: { message: string }) => e.message,
  textResult: (text: string, data: unknown) => ({ text, structuredContent: data }),
  workItemTitle: () => "matter", IDEMPOTENCY_KEY_DESCRIPTION: "key",
}));
import hearing from "@/lib/mcp/tools/add-hearing";
import task from "@/lib/mcp/tools/manage-task";
import listTasks from "@/lib/mcp/tools/list-tasks";
import edit from "@/lib/mcp/tools/update-work-item";
const ctx = { getUserId: () => "user" } as never;
beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ["select", "eq", "order", "limit"]) query[name] = vi.fn(() => query);
  query.insert = insert.mockReturnValue(query); query.update = update.mockReturnValue(query);
  query.maybeSingle = vi.fn(async () => ({ data: { id: "saved" }, error: null }));
  query.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  rpc.mockResolvedValue({ data: { work_item: { id: "wi", authority_email: null } }, error: null });
});
describe("deployed judicial contracts", () => {
  it.each([undefined, "HIGH", "URGENT", "LOW", "MEDIA"])("task priority %s maps to SQL values", async (priority) => {
    await task.handler({ action: "create", title: "Review", priority } as never, ctx);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ priority: priority === "LOW" ? "BAJA" : priority === "HIGH" || priority === "URGENT" ? "ALTA" : "MEDIA", status: "PENDIENTE" }));
  });
  it.each([["complete", "COMPLETADA"], ["reopen", "PENDIENTE"]])("task %s uses canonical status", async (action, status) => {
    await task.handler({ action, task_id: "task" } as never, ctx);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status }));
  });
  it("default task listing filters pending before reading", async () => {
    await listTasks.handler({} as never, ctx);
    expect(query.eq).toHaveBeenCalledWith("status", "PENDIENTE");
  });
  it.each([[undefined, "presencial"], ["https://meeting.test", "virtual"]])("hearing modality matches live SQL", async (location, modality) => {
    await hearing.handler({ date: "2026-11-30T08:30:00-05:00", description: "Pruebas", location } as never, ctx);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled", modality, scheduled_at: "2026-11-30T13:30:00.000Z" }));
  });
  it("rejects ambiguous local timestamps before mutation", async () => {
    const result = await hearing.handler({ date: "2026-11-30T08:30:00", description: "Pruebas" } as never, ctx);
    expect(result.isError).toBe(true); expect(insert).not.toHaveBeenCalled();
  });
  it("correction requires revision and reason before mutation", async () => {
    const result = await hearing.handler({ hearing_id: "h", date: "2026-11-30T08:30:00-05:00", description: "Pruebas" } as never, ctx);
    expect(result.isError).toBe(true); expect(rpc).not.toHaveBeenCalled();
  });
  it("explicit null email uses existing atomic audited RPC", async () => {
    await edit.handler({ id: "wi", authority_email: null } as never, ctx);
    expect(rpc).toHaveBeenCalledWith("mcp_update_work_item", expect.objectContaining({ p_patch: { authority_email: null } }));
  });
  it("rejects combined reclassification and metadata before any RPC", async () => {
    const result = await edit.handler({ id: "wi", workflow_type: "EJECUTIVO", stage: "SEGUIR_ADELANTE", title: "Changed" } as never, ctx);
    expect(result.isError).toBe(true); expect(rpc).not.toHaveBeenCalled();
  });
  it("requires a target stage, reason and revision for reclassification", async () => {
    const result = await edit.handler({ id: "wi", workflow_type: "EJECUTIVO" } as never, ctx);
    expect(result.isError).toBe(true); expect(rpc).not.toHaveBeenCalled();
  });
});
describe("source dates and identifiers", () => {
  it.each([[undefined, "PENDIENTE"], ["RUNNING", "EN_EJECUCION"], ["SUCCESS_EMPTY", "SIN_NOVEDADES"], ["ERROR", "FALLIDA"], ["RESTRICTED", "RESTRINGIDA"]])("actual query %s has truthful state", (status, expected) => {
    expect(judicialQueryState({ compatible: true, status })).toBe(expected);
  });
  it("successful query with records is distinct from empty and pending", () => {
    expect(judicialQueryState({ compatible: true, status: "success", count: 2 })).toBe("CON_RESULTADOS");
    expect(judicialQueryState({ compatible: false, status: "success", count: 2 })).toBe("IDENTIFICADOR_INCOMPATIBLE");
  });
  it("extracts both timed Cardenas sessions separately", () => {
    const sessions = extractHearingsFromAct({ act_type: "Acta audiencia de pruebas", description: "30 de noviembre de 2026 a las 8:30 am. 1º de diciembre de 2026 a las 8:30 am" });
    expect(sessions.map(s => s.starts_at_iso)).toEqual(["2026-11-30T13:30:00.000Z", "2026-12-01T13:30:00.000Z"]);
    expect(sessions.every(s => !s.time_inferred)).toBe(true);
  });
  it("keeps both shared-year dates for review without claiming a source time", () => {
    const rows = extractHearingsFromAct({ act_type: "Audiencia publica", description: "FIJA FECHA PARA AUDIENCIA DE PRUEBAS EL 30 DE NOVIEMBRE Y 1 DE DICIEMBRE DE 2026. LINK EN EL ACTA" });
    expect(rows.map(r => r.local_date)).toEqual(["2026-11-30", "2026-12-01"]);
    expect(rows.every(r => r.time_inferred)).toBe(true);
  });
  it("does not borrow time across sessions", () => {
    expect(extractHearingsFromAct({ act_type: "audiencia de pruebas", description: "30 de noviembre de 2026 sin hora; 1 de diciembre de 2026 a las 8:30 am" }).map(s => s.local_date)).toEqual(["2026-12-01"]);
  });
  it("rejects impossible civil dates", () => {
    expect(extractHearingsFromAct({ act_type: "audiencia inicial", description: "31 de noviembre de 2026 a las 8:30 am" })).toEqual([]);
  });
  it("preserves explicit rescheduling instead of relabelling as an initial schedule", () => {
    const rows = extractHearingsFromAct({ act_type: "Reprograma audiencia", description: "Nueva fecha 30 de noviembre de 2026 a las 8:30 am" });
    expect(rows[0]?.action).toBe("reschedule");
  });
  it("converts Bogota 08:30 to UTC 13:30", () => expect(buildBogotaTimestamptz(2026, 11, 30, 8, 30)).toBe("2026-11-30T13:30:00.000Z"));
  it("never treats 21-digit SPOA as provider-compatible 23 digits", () => {
    expect(hasUsableRadicado("050013333010202300199")).toBe(false);
    expect(hasUsableRadicado("05001333301020230019900")).toBe(true);
  });
  it("no effective query is not a successful empty query", () => {
    expect(resolveActsEmptyState({ workflowType: "CGP", radicado: "05001333301020230019900", monitoringEnabled: true }).kind).toBe("NUNCA_CONSULTADO");
  });
});