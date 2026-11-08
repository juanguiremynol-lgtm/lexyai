import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { assessDailySyncChain } from "../../supabase/functions/_shared/dailySyncChainEvidence.ts";

const complete = {
  status: "SUCCESS", chain_id: "chain-a", is_continuation: false,
  finished_at: "2026-11-08T12:03:16.000Z", expected_total_items: 2,
  items_succeeded: 2, items_failed: 0, items_skipped: 0,
  dead_letter_count: 0, timeout_count: 0,
  metadata: { items_dispatched: 0, dead_lettered_excluded: 0 },
};

describe("daily sync chain evidence", () => {
  it("does not turn today's empty successful continuation into a complete chain", () => {
    const result = assessDailySyncChain([
      { ...complete, status: "PARTIAL", expected_total_items: 17, items_succeeded: 3,
        items_failed: 3, metadata: { items_dispatched: 11, dead_lettered_excluded: 71 } },
      { ...complete, is_continuation: true, expected_total_items: 0, items_succeeded: 0 },
    ]);
    assert.equal(result.supported, false);
    assert.ok(result.reasons.includes("FAILED_ITEMS"));
    assert.ok(result.reasons.includes("DISPATCHED_NOT_RECONCILED"));
    assert.ok(result.reasons.includes("DEAD_LETTER_TRACKERS_EXCLUDED"));
    assert.equal(result.scope, "SELECTED_ACTUACIONES_ONLY");
  });

  it("accepts a finished selection only when every selected act has a counted success", () => {
    assert.deepEqual(assessDailySyncChain([complete]), {
      supported: true, scope: "SELECTED_ACTUACIONES_ONLY", reasons: [], explanations: [],
      dispatched_attempts: 0, excluded_tracker_entries: 0,
    });
    const incomplete = assessDailySyncChain([{ ...complete, items_succeeded: 1 }]);
    assert.equal(incomplete.supported, false);
    assert.ok(incomplete.reasons.includes("TARGET_NOT_ACCOUNTED_FOR"));
  });

  it("does not infer a completed read from a dispatched item or excluded tracker", () => {
    for (const metadata of [
      { items_dispatched: 1, dead_lettered_excluded: 0 },
      { items_dispatched: 0, dead_lettered_excluded: 1 },
      {},
    ]) assert.equal(assessDailySyncChain([{ ...complete, metadata }]).supported, false);
  });

  it("rejects missing, contradictory or unrelated ledger evidence", () => {
    assert.equal(assessDailySyncChain([]).supported, false);
    assert.equal(assessDailySyncChain([{ ...complete, items_failed: null }]).supported, false);
    assert.equal(assessDailySyncChain([{ ...complete, finished_at: null }]).supported, false);
    assert.equal(assessDailySyncChain([{ ...complete, expected_total_items: 0, items_succeeded: 0 }]).supported, false);
    assert.equal(assessDailySyncChain([complete, { ...complete, chain_id: "another", is_continuation: true }]).supported, false);
    assert.equal(assessDailySyncChain([{ ...complete, status: "FAILED" }]).supported, false);
  });

  it("does not treat timeouts, skips or new dead letters as a verified chain", () => {
    for (const row of [
      { ...complete, timeout_count: 1 },
      { ...complete, items_skipped: 1 },
      { ...complete, dead_letter_count: 1 },
    ]) assert.equal(assessDailySyncChain([row]).supported, false);
  });
});

// Exercise both real readers with mocked database responses. The functions
// themselves are extracted so the surrounding Deno server is never started.
function loadReader(path: string, name: string, endMarker: string) {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Cannot locate ${name}`);
  const js = stripTypeScriptTypes(source.slice(start, end), { mode: "strip" });
  return new Function("assessDailySyncChain", "todayCOT", `${js}\nreturn ${name};`)(
    assessDailySyncChain, () => "2026-11-08",
  );
}

function database(rows: unknown[]) {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        order: async () => ({ data: rows }),
        limit: async () => ({ data: table === "sync_item_failure_tracker" ? [] : rows }),
      };
      return q;
    },
  };
}

describe("daily KPI readers", () => {
  const report = loadReader("supabase/functions/atenia-daily-report/index.ts", "toolPerOrgKPIs", "async function toolRecentActions");
  const supervisor = loadReader("supabase/functions/atenia-ai-supervisor/index.ts", "computeDailySyncKPIs", "// ─── Platform-wide Sync KPIs");
  const stage = { ...complete, organization_id: "org", started_at: "2026-11-08T12:00:00.000Z" };

  it("both readers report the observed partial chain as unverified", async () => {
    const rows = [
      { ...stage, status: "PARTIAL", expected_total_items: 17, items_succeeded: 3,
        items_failed: 3, metadata: { items_dispatched: 11, dead_lettered_excluded: 71 } },
      { ...stage, is_continuation: true, expected_total_items: 0, items_succeeded: 0 },
    ];
    const reportResult = await report(database(rows));
    const supervisorResult = await supervisor(database(rows), "org", "2026-11-08");
    for (const result of [reportResult.orgs[0], supervisorResult]) {
      assert.equal(result.fully_synced, false);
      assert.equal(result.total_failed, 3);
      assert.equal(result.convergence_seconds, null);
      assert.ok(result.unverified_reasons.includes("DISPATCHED_NOT_RECONCILED"));
      assert.equal(result.dispatched_attempts, 11);
      assert.equal(result.excluded_tracker_entries, 71);
      assert.ok(result.unverified_explanations.some((message: string) => message.includes("no se concilia")));
      assert.equal(result.evidence_scope, "SELECTED_ACTUACIONES_ONLY");
    }
  });

  it("both readers retain a complete, clearly scoped selection", async () => {
    const reportResult = await report(database([stage]));
    const supervisorResult = await supervisor(database([stage]), "org", "2026-11-08");
    for (const result of [reportResult.orgs[0], supervisorResult]) {
      assert.equal(result.fully_synced, true);
      assert.equal(result.evidence_scope, "SELECTED_ACTUACIONES_ONLY");
      assert.deepEqual(result.unverified_reasons, []);
    }
  });
});
