import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (definition: unknown) => definition }));
import notifications from "@/lib/mcp/tools/list-notifications";
import assign from "@/lib/mcp/tools/assign-work-item-radicado";
import questions from "@/lib/mcp/tools/list-email-questions";
const ctx = { isAuthenticated: () => true, getToken: () => "synthetic-local-token" } as never;
const args = { work_item_id: "00000000-0000-0000-0000-000000000001", radicado: "05001-40-03-002-2025-01054-00", expected_updated_at: "2026-10-24T19:59:00Z", idempotency_key: "assign-test-001" };
beforeEach(() => {
  rpc.mockReset();
  vi.stubGlobal("Deno", { env: { get: (key: string) => ({ SUPABASE_URL: "https://local.invalid", SUPABASE_ANON_KEY: "synthetic-key" } as Record<string, string>)[key] } });
});
describe("MCP operational action contracts", () => {
  it("forwards notification pagination to state-filtered RPC and retains continuation", async () => {
    const data = { notifications: [{ id: "older-unread", read_at: null }], next_cursor: "next", has_more: true };
    rpc.mockResolvedValue({ data, error: null });
    const result = await notifications.handler({ limit: 30, include_dismissed: false, cursor: "prior" }, ctx);
    expect(rpc).toHaveBeenCalledWith("mcp_list_notifications", { p_limit: 30, p_include_dismissed: false, p_cursor: "prior" });
    expect(result.structuredContent).toEqual(data);
  });
  it("propagates state-query errors without returning an empty successful list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "personal state unavailable" } });
    const result = await notifications.handler({ limit: undefined, include_dismissed: undefined, cursor: undefined }, ctx);
    expect(result.isError).toBe(true);
    const block = result.content[0];
    expect(block?.type === "text" ? block.text : "").toContain("personal state unavailable");
  });
  it("normalizes exactly 23 digits as a string with the leading zero preserved", async () => {
    rpc.mockResolvedValueOnce({ data: "manage", error: null }).mockResolvedValueOnce({ data: { synced: false, synchronization: "scheduled_pending" }, error: null });
    const result = await assign.handler(args, ctx);
    expect(rpc).toHaveBeenLastCalledWith("mcp_assign_work_item_radicado", { p_work_item_id: args.work_item_id, p_radicado: "05001400300220250105400", p_expected_updated_at: args.expected_updated_at, p_idempotency_key: args.idempotency_key });
    expect(result.structuredContent?.synced).toBe(false);
  });
  it.each(["0500140030022025010540", "050014003002202501054000"])('rejects non-23-digit radicado %s before a write', async (radicado) => {
    rpc.mockResolvedValueOnce({ data: "manage", error: null });
    expect((await assign.handler({ ...args, radicado }, ctx)).isError).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects read-only grant without attempting assignment", async () => {
    rpc.mockResolvedValueOnce({ data: "read", error: null });
    expect((await assign.handler(args, ctx)).isError).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("global email questions use bounded RPC metadata rather than message bodies", async () => {
    rpc.mockResolvedValueOnce({ data: { questions: [], has_more: false }, error: null });
    await questions.handler({ cursor: "prior", limit: 20 }, ctx);
    expect(rpc).toHaveBeenCalledWith("mcp_list_email_questions", { p_cursor: "prior", p_limit: 20 });
  });
});