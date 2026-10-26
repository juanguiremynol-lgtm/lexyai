import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, resolve } = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn() }));
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (value: unknown) => value }));
vi.mock("@/lib/mcp/shared", () => ({
  requireAuth: () => null, requireWriteScope: async () => null, sbForUser: () => ({ rpc }), resolveWorkItem: resolve,
  textResult: (text: string, data: unknown) => ({ content: [{ type: "text", text }], structuredContent: data }),
  errorResult: (text: string) => ({ isError: true, content: [{ type: "text", text }] }), rpcErrorText: (e: { message: string }) => e.message,
  workItemTitle: () => "Synthetic", IDEMPOTENCY_KEY_DESCRIPTION: "Synthetic key",
}));
import update from "@/lib/mcp/tools/update-work-item";
import capabilities from "@/lib/mcp/tools/get-capabilities";
beforeEach(() => { vi.resetAllMocks(); resolve.mockResolvedValue({ item: { id: "00000000-0000-0000-0000-000000000021" } }); });
const ctx = {} as never;
const updateArgs = {
  radicado: undefined, id: "00000000-0000-0000-0000-000000000021", title: "Updated", description: undefined,
  demandantes: undefined, demandados: undefined, authority_name: undefined, authority_email: undefined, authority_city: undefined,
  expediente_url: undefined, client_id: "00000000-0000-0000-0000-000000000099", is_flagged: undefined,
  monitoring_enabled: false, monitoring_off_reason: "Explicit pause", email_linking_enabled: undefined, idempotency_key: undefined,
  workflow_type: undefined, stage: undefined, expected_updated_at: undefined, reason: undefined,
};
describe("final MCP discrepancies", () => {
  it("composes invalid-client plus pause into one atomic call, never a prior monitoring mutation", async () => {
    rpc.mockResolvedValue({ error: { message: "NOT_FOUND: cliente no encontrado" }, data: null });
    expect((await update.handler(updateArgs, ctx)).isError).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("mcp_update_work_item", expect.objectContaining({ p_monitoring_enabled: false, p_patch: { title: "Updated", client_id: updateArgs.client_id }, p_idempotency_key: null }));
  });
  it("returns actual false monitoring after resume of an unmonitorable matter", async () => {
    rpc.mockResolvedValue({ error: null, data: { work_item: { monitoring_enabled: false }, idempotency_key: "saved-key" } });
    const result = await update.handler({ ...updateArgs, client_id: undefined, monitoring_enabled: true }, ctx);
    const changes = result.structuredContent?.cambios as Record<string, unknown> | undefined;
    expect(changes?.monitoring_enabled).toBe(false);
  });
  it("rejects a missing pause reason before the atomic mutation", async () => {
    expect((await update.handler({ ...updateArgs, monitoring_off_reason: undefined }, ctx)).isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not advertise gated updates despite a manage grant", async () => {
    rpc.mockImplementation(async (name) => ({ data: name === "mcp_access_level" ? "manage" : name === "mcp_caller_context" ? { authenticated: true } : { verified: true, tools: { update_work_item: { execution_available: false, available: false } } }, error: null }));
    const result = await capabilities.handler({}, ctx);
    expect(result.structuredContent?.can_manage).toBe(false);
    expect(result.structuredContent?.reason).toBe("EXECUTION_UNAVAILABLE");
    expect(result.structuredContent?.manage_tools).toEqual([]);
  });
  it("distinguishes unverified none from read-only", async () => {
    rpc.mockImplementation(async (name) => ({ data: name === "mcp_access_level" ? "none" : name === "mcp_caller_context" ? { authenticated: false } : { verified: true, tools: {} }, error: null }));
    const result = await capabilities.handler({}, ctx);
    expect(result.structuredContent?.reason).toBe("SESSION_UNVERIFIED");
    expect(result.structuredContent?.can_manage).toBe(false);
  });
  it("advertises only runtime available management actions", async () => {
    rpc.mockImplementation(async (name) => ({ data: name === "mcp_access_level" ? "manage" : name === "mcp_caller_context" ? { authenticated: true } : { verified: true, tools: { update_work_item: { execution_available: true, available: true } } }, error: null }));
    const result = await capabilities.handler({}, ctx);
    expect(result.structuredContent?.manage_tools).toEqual(["update_work_item"]);
    expect(result.structuredContent?.can_manage).toBe(true);
  });
});