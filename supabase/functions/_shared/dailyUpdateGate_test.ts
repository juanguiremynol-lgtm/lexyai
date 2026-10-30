import { assertEquals } from "jsr:@std/assert@1";
import { admitDailyUpdate, dailyDuplicateBody, rememberAdmission, secondsUntil, takeAdmission, dailyChannelStatus } from "./dailyUpdateGate.ts";
import { retryOutcome } from "./retryOutcome.ts";

const req = () => new Request("http://x", { headers: { "x-invoker-function": "process-retry-queue", "x-retry-task-id": "r1" } });

Deno.test("admission fails closed when the durable barrier is unavailable", async () => {
  const db = { rpc: async () => ({ data: null, error: { message: "down" } }) };
  const a = await admitDailyUpdate(db, "wi", "acts", req(), "t");
  assertEquals(a.admitted, false);
  assertEquals(dailyDuplicateBody("wi", "t", a).code, "DAILY_ADMISSION_UNAVAILABLE");
});

Deno.test("admission forwards caller identity, never a client-chosen day or owner", async () => {
  let args: any;
  const db = { rpc: async (_n: string, p: any) => { args = p; return { data: { admitted: true, mode: "new" }, error: null }; } };
  await admitDailyUpdate(db, "wi", "pubs", req(), "t");
  assertEquals(Object.keys(args).sort(), ["_channel", "_continuation", "_invoker", "_retry_task_id", "_trace_id", "_work_item_id"]);
  assertEquals(args._invoker, "process-retry-queue");
});

Deno.test("duplicate reply is never success nor a consumed retry outcome", () => {
  const body = dailyDuplicateBody("wi", "t", { admitted: false, reason: "DAILY_UPDATE_ALREADY_STARTED", next_eligible_at: "2026-10-30T05:00:00Z" });
  assertEquals(body.status, "DAILY_LIMIT");
  assertEquals(retryOutcome(200, body as any).outcome === "SUCCESS", false);
});

Deno.test("deferral lasts until the next Bogotá day", () => {
  const next = new Date(Date.now() + 3600_000).toISOString();
  const s = secondsUntil(next);
  assertEquals(s >= 3600 && s <= 3700, true);
});

Deno.test("only a newly admitted channel is sealed, once", () => {
  const r = req();
  rememberAdmission(r, { admitted: true, mode: "continuation", token: "x" });
  assertEquals(takeAdmission(r), undefined);
  rememberAdmission(r, { admitted: true, mode: "new", token: "x", run_date: "2026-10-29", channel: "acts" });
  assertEquals(takeAdmission(r)?.token, "x");
  assertEquals(takeAdmission(r), undefined);
  assertEquals(dailyChannelStatus("pending_upstream"), "PENDING_UPSTREAM");
  assertEquals(dailyChannelStatus("partial"), "PARTIAL");
});
