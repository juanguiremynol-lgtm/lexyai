import { describe, it, expect } from "vitest";
import { evaluateAlerts, newResults, publicResults } from "../../supabase/functions/scheduled-alert-evaluator/evaluate.ts";

// Mock client: no network, records RPC calls. Nobody is notified.
function mockClient(opts: { hearingsErr?: string; tasksErr?: string; tasks?: any[]; rpcErr?: string }) {
  const calls: string[] = [];
  const q = (table: string) => {
    const res = table === "work_item_hearings"
      ? { data: opts.hearingsErr ? null : [], error: opts.hearingsErr ? { message: opts.hearingsErr } : null }
      : { data: opts.tasksErr ? null : (opts.tasks ?? []), error: opts.tasksErr ? { message: opts.tasksErr } : null };
    const b: any = { select: () => b, gt: () => b, lt: () => b, in: () => b, neq: () => b, then: (f: any) => Promise.resolve(res).then(f) };
    return b;
  };
  return {
    calls,
    from: q,
    rpc: async (name: string) => {
      calls.push(name);
      return { data: null, error: name === "insert_notification" && opts.rpcErr ? { message: opts.rpcErr } : null };
    },
  };
}
const task = { id: "t1", owner_id: "o1", assigned_to: "o1", title: "X", due_date: "2026-11-01", work_item_id: "w1", priority: "ALTA" };

describe("scheduled-alert-evaluator counters", () => {
  it("read error without RPC is not a notification failure", async () => {
    const c = mockClient({ hearingsErr: "timeout", tasks: [] });
    const r = await evaluateAlerts(c, newResults());
    expect(c.calls).toEqual([]);
    expect(r.read_errors).toHaveLength(1);
    expect(r.notification_requests_failed).toBe(0);
    expect(r.notification_rpc_errors).toHaveLength(0);
    expect(r.errors).toHaveLength(1); // legacy combined list kept
  });
  it("real RPC error counts as notification failure only", async () => {
    const c = mockClient({ tasks: [task], rpcErr: "cannot delete from scalar" });
    const r = await evaluateAlerts(c, newResults());
    expect(c.calls).toEqual(["insert_notification"]);
    expect(r.notification_requests_failed).toBe(1);
    expect(r.read_errors).toHaveLength(0);
    expect(r.task_alerts_created).toBe(0);
  });
  it("accepted RPC counts as accepted request, labelled not-proven insert", async () => {
    const c = mockClient({ tasks: [task] });
    const r = publicResults(await evaluateAlerts(c, newResults()));
    expect(r.notification_requests_accepted).toBe(1);
    expect(r.task_alerts_created).toBe(1);
    expect(r.alerts_created_semantics).toBe("accepted_requests_not_proven_inserts");
  });
});
