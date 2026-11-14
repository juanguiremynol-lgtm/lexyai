import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, error: "", auth: "", calls: [] as any[], archived: 2 }));
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (tool: unknown) => tool }));
vi.mock("../shared", () => ({
  requireAuth: () => mock.auth || null,
  canonicalWorkflowType: (s: string) => s === "PENAL" ? "PENAL_906" : s,
  resolveWorkItem: async (_sb: unknown, args: any) => ({ item: { id: args.id ?? "matter", radicado: "reference" } }),
  textResult: (_text: string, structuredContent: unknown) => ({ structuredContent }),
  errorResult: (message: string) => ({ isError: true, message }),
  sbForUser: () => ({ from: (table: string) => {
    const filters: ((r: any) => boolean)[] = []; const orders: string[] = []; let limit = Infinity; let head = false;
    const q: any = {
      select: (...args: any[]) => { head = !!args[1]?.head; mock.calls.push([table, "select", ...args]); return q; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      gt: (k: string, v: string) => { filters.push(r => r[k] > v); return q; },
      gte: (k: string, v: string) => { filters.push(r => r[k] >= v); return q; },
      lte: (k: string, v: string) => { filters.push(r => r[k] <= v); return q; },
      order: (k: string, opts: any) => { orders.push(k); mock.calls.push([table, "order", k, opts]); return q; },
      limit: (n: number) => { limit = n; return q; },
      or: (expr: string) => {
        mock.calls.push([table, "or", expr]);
        if (expr === "is_archived.is.null,is_archived.eq.false") filters.push(r => !r.is_archived);
        else {
          const match = expr.match(/^(\w+)\.lt\.([^,]+),and\(\1\.eq\.[^,]+,id\.lt\.([^\)]+)\)/);
          const nullable = expr.match(/^and\((\w+)\.is.null,id\.lt\.([^\)]+)\)$/);
          if (match) filters.push(r => r[match[1]] == null || r[match[1]] < match[2] || r[match[1]] === match[2] && r.id < match[3]);
          else if (nullable) filters.push(r => r[nullable[1]] == null && r.id < nullable[2]);
        } return q;
      },
      maybeSingle: () => Promise.resolve({ data: { full_name: "Fixture" }, error: mock.error ? { message: mock.error } : null }),
      then: (resolve: (v: unknown) => unknown) => {
        const rows = (mock.rows[table] ?? []).filter(r => filters.every(f => f(r))).sort((a, b) => {
          for (const k of orders) {
            if (a[k] === b[k]) continue;
            if (a[k] == null) return 1; if (b[k] == null) return -1;
            const sign = a[k] < b[k] ? 1 : -1;
            return orders.length === 1 ? -sign : sign;
          } return 0;
        });
        return resolve({ data: head ? null : rows.slice(0, limit), count: head ? rows.length : null, error: mock.error ? { message: mock.error } : null });
      },
    }; return q;
  } }),
}));
import summary from "../tools/get-user-context";
import matters from "../tools/list-work-items";
import acts from "../tools/list-actuaciones";
const ctx = { getUserId: () => "owner", getUserEmail: () => null } as never;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeEach(() => { mock.rows = {}; mock.error = ""; mock.auth = ""; mock.calls = []; });
const run = async (tool: any, input = {}) => await tool.handler(input, ctx) as any;
describe("portfolio summary through real handler", () => {
  it("separates 81 ACTIVE from 2 ARCHIVED and excludes deleted rows", async () => {
    mock.rows.work_items = Array.from({ length: 84 }, (_, n) => ({ id: uuid(n), workflow_type: n < 68 ? "CGP" : "CPACA", lifecycle_state: n < 81 ? "ACTIVE" : "ARCHIVED", deleted_at: n === 83 ? "deleted" : null }));
    expect((await run(summary)).structuredContent).toMatchObject({ active_work_items: 81, archived_work_items: 2, by_workflow_type: { CGP: 68, CPACA: 13 } });
  });
  it("counts more than 1000 active matters with workflow totals", async () => {
    mock.rows.work_items = Array.from({ length: 1031 }, (_, n) => ({ id: uuid(n), workflow_type: "CGP", lifecycle_state: "ACTIVE", deleted_at: null }));
    expect((await run(summary)).structuredContent).toMatchObject({ active_work_items: 1031, by_workflow_type: { CGP: 1031 } });
  });
  it("never represents a read failure as zero", async () => { mock.error = "read failed"; expect((await run(summary)).isError).toBe(true); });
});
describe("keyset listings through real handlers", () => {
  it("defaults ACTIVE and returns archived only when explicitly requested", async () => {
    mock.rows.work_items = ["ACTIVE", "ARCHIVED", "PAUSED"].map((state, n) => ({ id: uuid(n), lifecycle_state: state, updated_at: "2026-11-14T12:00:00Z" }));
    expect((await run(matters)).structuredContent.items.map((r: any) => r.lifecycle_state)).toEqual(["ACTIVE"]);
    expect((await run(matters, { lifecycle_state: "ARCHIVED" })).structuredContent.items.map((r: any) => r.lifecycle_state)).toEqual(["ARCHIVED"]);
    expect((await run(matters, { lifecycle_state: "ALL" })).structuredContent.items).toHaveLength(3);
  });
  it("returns all 230 nonarchived acts across tied dates and null dates without duplicates", async () => {
    mock.rows.work_item_acts = Array.from({ length: 231 }, (_, n) => ({ id: uuid(n), work_item_id: "matter", act_date: n < 215 ? "2026-11-14" : null, is_archived: n === 230 }));
    const ids: string[] = []; let cursor: string | null = null;
    do {
      const page: any = (await run(acts, { limit: 100, ...(cursor ? { cursor } : {}) })).structuredContent;
      ids.push(...page.actuaciones.map((r: any) => r.id)); cursor = page.next_cursor;
      expect(page.has_more).toBe(cursor !== null);
    } while (cursor);
    expect(ids).toHaveLength(230); expect(new Set(ids).size).toBe(230);
  });
  it("paginates work-item ties, excludes archived before lookahead, and binds filters", async () => {
    mock.rows.work_items = Array.from({ length: 5 }, (_, n) => ({ id: uuid(n), lifecycle_state: n === 4 ? "ARCHIVED" : "ACTIVE", updated_at: "2026-11-14T12:00:00Z" }));
    const first = (await run(matters, { limit: 2 })).structuredContent;
    const last = (await run(matters, { limit: 2, cursor: first.next_cursor })).structuredContent;
    expect([...first.items, ...last.items].map(r => r.id)).toEqual([3, 2, 1, 0].map(uuid));
    expect(last).toMatchObject({ has_more: false, next_cursor: null });
    expect((await run(matters, { cursor: first.next_cursor, lifecycle_state: "ALL" })).isError).toBe(true);
  });
  it.each([matters, acts])("rejects forged boundaries and propagates read/auth failures", async tool => {
    expect((await run(tool, { cursor: btoa('{"id":"unsafe)"}') })).isError).toBe(true);
    mock.error = "RLS read failed"; expect((await run(tool)).isError).toBe(true);
    mock.error = ""; mock.auth = "No autorizado"; expect((await run(tool)).isError).toBe(true);
  });
  it("applies act date filters before pagination and binds the resolved matter", async () => {
    mock.rows.work_item_acts = [10, 11, 12, 13].map(n => ({ id: uuid(n), work_item_id: "matter", act_date: `2026-11-${n}`, is_archived: false }));
    const page = (await run(acts, { date_from: "2026-11-11", date_to: "2026-11-12", limit: 1 })).structuredContent;
    expect(page.actuaciones[0].act_date).toBe("2026-11-12");
    expect((await run(acts, { id: "other", date_from: "2026-11-11", date_to: "2026-11-12", cursor: page.next_cursor })).isError).toBe(true);
  });
});