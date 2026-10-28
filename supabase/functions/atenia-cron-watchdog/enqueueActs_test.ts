import { enqueueMissingActs, mergeCoverageCandidates, type WatchCandidate } from "./enqueueActs.ts";
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
}
const now = "2026-10-28T12:00:00Z";
const item: WatchCandidate = { id: "a", organization_id: "org", radicado: "05001333301020240013900",
  workflow_type: "CPACA", monitoring_enabled: true, deleted_at: null, status: "ACTIVE" };
const samai = { work_item_id: "a", provider_key: "samai", enabled: true };

Deno.test("stuck convergence and coverage gaps use a single deduplicated durable candidate", () => {
  equal(mergeCoverageCandidates(["a", "a"], ["a", "b"], ["b", "c"]), ["a", "b", "c"]);
});

Deno.test("repeated watchdog pass preserves task backoff and counts only actual inserts", async () => {
  const tasks = new Map<string, any>();
  const writer = async (task: any): Promise<"inserted" | "existing"> => {
    if (tasks.has(task.work_item_id)) return "existing";
    tasks.set(task.work_item_id, task); return "inserted";
  };
  const first = await enqueueMissingActs([item, item], [samai], new Set(), writer, now);
  tasks.get("a").attempt = 2;
  tasks.get("a").next_run_at = "2026-10-29T12:00:00Z";
  const second = await enqueueMissingActs([item], [samai], new Set(), writer, now);
  equal([first.inserted, second.inserted, second.existing, tasks.size], [1, 0, 1, 1]);
  equal([tasks.get("a").attempt, tasks.get("a").next_run_at], [2, "2026-10-29T12:00:00Z"]);
});

Deno.test("disabled alternatives do not block an enabled source; absent sources and recent exhaustion do not dispatch", async () => {
  let calls = 0;
  let selected = "";
  const writer = async (task: any): Promise<"inserted"> => { calls++; selected = task.provider; return "inserted"; };
  const allowed = await enqueueMissingActs([item], [samai, { ...samai, provider_key: "cpnu", enabled: false }], new Set(), writer, now);
  const blocked = await enqueueMissingActs([item], [{ ...samai, enabled: false }], new Set(), writer, now);
  const alternateOnly = await enqueueMissingActs([item], [{ ...samai, enabled: false }, { ...samai, provider_key: "cpnu" }], new Set(), writer, now);
  const absent = await enqueueMissingActs([item], [], new Set(), writer, now);
  const exhausted = await enqueueMissingActs([item], [samai], new Set(["a"]), writer, now);
  equal([calls, selected, allowed.inserted, blocked.source_blocked, alternateOnly.source_blocked, absent.source_blocked, exhausted.recently_finished], [1, "samai", 1, 1, 1, 1, 1]);
});

Deno.test("write errors remain visible and do not inflate inserted count", async () => {
  const result = await enqueueMissingActs([item], [samai], new Set(), async () => { throw new Error("db unavailable"); }, now);
  equal([result.inserted, result.write_errors], [0, 1]);
});

Deno.test("an existing legacy ACT retry is not duplicated in the durable queue", async () => {
  let calls = 0;
  const result = await enqueueMissingActs([item], [samai], new Set(), async () => { calls++; return "inserted"; }, now, new Set(["a"]));
  equal([result.legacy_pending, result.inserted, calls], [1, 0, 0]);
});

Deno.test("invalid identifiers and disabled vigilance do not enter queue", async () => {
  const invalid = { ...item, id: "b", radicado: "123" };
  const disabled = { ...item, id: "c", monitoring_enabled: false };
  let calls = 0;
  const result = await enqueueMissingActs([invalid, disabled], [], new Set(), async () => { calls++; return "inserted"; }, now);
  equal([result.ineligible, calls], [2, 0]);
});
