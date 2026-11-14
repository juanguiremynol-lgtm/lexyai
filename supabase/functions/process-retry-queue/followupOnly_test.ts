import { FOLLOWUP_SLOTS, followupSlots, resolveRetryTargets, retrySlots } from "./slots.ts";
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("followup mode has only follow-up slots (no extraction channels)", () => {
  const s = followupSlots(FOLLOWUP_SLOTS);
  if (s.length !== FOLLOWUP_SLOTS || s.some(([k, m]) => k !== "PUB_RETRY" || m !== "pp_poll")) throw new Error("extraction slot leaked");
});
Deno.test("pp_poll slots claim only via the follow-up RPC and stop when none is due", () => {
  if (!/initial === "pp_poll"\s*\n?\s*\? await db\.rpc\("claim_sync_retry_pp_poll"/.test(src)) throw new Error("pp_poll must use follow-up claim");
  if (!src.includes("if (followupOnly) break;")) throw new Error("must exit cheaply when nothing is due");
});

const ACT_ID = "123e4567-e89b-42d3-a456-426614174000";
const PP_ID = "123e4567-e89b-42d3-a456-426614174001";

Deno.test("an exact ACT target has one ACT slot and no PP slot", () => {
  const selection = resolveRetryTargets({ act_retry_task_id: ACT_ID });
  if (!selection.ok) throw new Error("valid ACT target rejected");
  const slots = retrySlots(selection.targets, false);
  if (slots.length !== 1 || slots[0][0] !== "ACT_SCRAPE_RETRY" || slots[0][1] !== false) {
    throw new Error("ACT target must claim exactly one ordinary ACT slot");
  }
  if (!src.includes('db.rpc("claim_sync_retry_act_task", { p_task_id: actTaskId })')) {
    throw new Error("ACT target must use its fenced task RPC");
  }
});

Deno.test("invalid, null and combined targets fail closed without fallback slots", () => {
  const invalid = [
    { act_retry_task_id: "not-a-uuid" },
    { act_retry_task_id: null },
    { pp_poll_task_id: "not-a-uuid" },
    { pp_poll_task_id: null },
    { act_retry_task_id: ACT_ID, pp_poll_task_id: PP_ID },
  ];
  for (const body of invalid) {
    if (resolveRetryTargets(body).ok) throw new Error(`invalid target accepted: ${JSON.stringify(body)}`);
  }
  if (!src.includes('error: "INVALID_RETRY_TARGET" }, 400')) throw new Error("invalid targets must return HTTP 400");
});

Deno.test("an exact PP target still has only one follow-up slot", () => {
  const selection = resolveRetryTargets({ pp_poll_task_id: PP_ID });
  if (!selection.ok) throw new Error("valid PP target rejected");
  const slots = retrySlots(selection.targets, false);
  if (slots.length !== 1 || slots[0][0] !== "PUB_RETRY" || slots[0][1] !== "pp_poll") {
    throw new Error("PP target contract changed");
  }
});

Deno.test("acts reach fenced stored-read recovery while publication duplicates stay deferred", () => {
  if (!src.includes('initial !== "pp_poll" && kind !== "ACT_SCRAPE_RETRY"')) {
    throw new Error("the queue must not suppress the callee's acts stored-read continuation");
  }
  if (!src.includes('_channel: "pubs"')) throw new Error("publication duplicate peek must remain in force");
});
