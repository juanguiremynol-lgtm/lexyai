import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Exercise the actual production page loop with provider calls replaced by
// deterministic acknowledgements. No database or provider is contacted.
const source = readFileSync("supabase/functions/scheduled-daily-sync/index.ts", "utf8");
const begin = source.indexOf("for (const item of pageItems) {", source.indexOf("async function syncOrganization("));
const end = source.indexOf("// ── Fix #2: Intra-round retry", begin);
if (begin < 0 || end < 0) throw new Error("Daily sync page loop could not be located");
const pageLoop = source.slice(begin, end).replace("catch (err: any)", "catch (err)");

const harness = `
  return (async () => {
    const pageItems = input.items;
    const supabase = {}, orgId = "org", runId = "run";
    const globalStart = Date.now(), HARD_BUDGET_MS = input.stop ? 0 : 1000000, ACK_WINDOW_MS = 0;
    const MAX_ITEM_ATTEMPTS_PER_CHAIN = 2;
    const buscarBudget = { used: 0, cap: 10 };
    const itemAttemptCounts = { ...(input.attemptCounts || {}) };
    const itemTimeoutCounts = { ...(input.timeoutCounts || {}) };
    const timeoutItems = [], dispatchedItems = [], errorSummary = [], roundFailures = [], skipped = [];
    let cursorLastId = null, processedCount = 0, itemsSkipped = 0, itemsDispatched = 0;
    let itemsSucceeded = 0, itemsFailed = 0, timeoutCount = 0, deadLetterCount = 0, failureReason = null;
    const recordSkip = (radicado, reason) => skipped.push({ radicado, reason });
    const syncSingleItemWithAck = async (_db, item) => input.acks[item.id];
    const markNeedsCpnuRefresh = async () => {};
    const resetItemFailures = async () => {};
    const trackItemFailure = async () => false;
    ${pageLoop}
    return { cursorLastId, processedCount, itemsSkipped, itemsDispatched, itemsSucceeded,
      itemsFailed, timeoutCount, failureReason, dispatchedItems, skipped };
  })();
`;
const runPage = new Function("input", harness) as (input: unknown) => Promise<any>;

const item = (id: string) => ({ id, radicado: `radicado-${id}` });

describe("daily sync cursor progression", () => {
  it("advances past every dispatched item without marking it successful", async () => {
    const result = await runPage({
      items: [item("a"), item("b"), item("c")],
      acks: { a: { kind: "dispatched" }, b: { kind: "dispatched" }, c: { kind: "dispatched" } },
    });
    expect(result).toMatchObject({ cursorLastId: "c", processedCount: 3, itemsDispatched: 3, itemsSucceeded: 0 });
  });

  it("advances across a skipped item, an exhausted timeout, a success and a dispatch", async () => {
    const result = await runPage({
      items: [item("a"), item("b"), item("c"), item("d")],
      attemptCounts: { a: 2 }, timeoutCounts: { b: 2 },
      acks: {
        b: { kind: "error", error: new Error("ITEM_TIMEOUT") },
        c: { kind: "completed", response: {} }, d: { kind: "dispatched" },
      },
    });
    expect(result).toMatchObject({ cursorLastId: "d", processedCount: 4, itemsSkipped: 1,
      itemsFailed: 1, timeoutCount: 1, itemsSucceeded: 1, itemsDispatched: 1 });
  });

  it("does not advance over items never started when the budget is exhausted", async () => {
    const result = await runPage({ items: [item("a"), item("b")], acks: {}, stop: true });
    expect(result).toMatchObject({ cursorLastId: null, processedCount: 0, itemsSkipped: 2,
      itemsDispatched: 0, itemsSucceeded: 0, failureReason: "BUDGET_EXHAUSTED" });
  });
});
