import { FOLLOWUP_SLOTS, followupSlots } from "./index.ts";
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("followup mode has only follow-up slots (no extraction channels)", () => {
  const s = followupSlots(FOLLOWUP_SLOTS);
  if (s.length !== FOLLOWUP_SLOTS || s.some(([k, m]) => k !== "PUB_RETRY" || m !== "pp_poll")) throw new Error("extraction slot leaked");
});
Deno.test("pp_poll slots claim only via the follow-up RPC and stop when none is due", () => {
  if (!/initial === "pp_poll"\s*\n?\s*\? await db\.rpc\("claim_sync_retry_pp_poll"/.test(src)) throw new Error("pp_poll must use follow-up claim");
  if (!src.includes("if (followupOnly) break;")) throw new Error("must exit cheaply when nothing is due");
});
