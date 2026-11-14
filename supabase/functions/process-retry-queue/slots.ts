/** Follow-up-only drains claim at most this many admitted runs per call. */
export const FOLLOWUP_SLOTS = 8;

export type RetryTargets = {
  ppTaskId: string | null;
  actTaskId: string | null;
};

export type RetrySlot = readonly ["ACT_SCRAPE_RETRY" | "PUB_RETRY", boolean | "pp_poll"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveRetryTargets(body: Record<string, unknown>):
  { ok: true; targets: RetryTargets } | { ok: false } {
  const pp = body.pp_poll_task_id;
  const act = body.act_retry_task_id;
  if (pp !== undefined && act !== undefined) return { ok: false };
  if (pp !== undefined && (typeof pp !== "string" || !UUID_RE.test(pp))) return { ok: false };
  if (act !== undefined && (typeof act !== "string" || !UUID_RE.test(act))) return { ok: false };
  return {
    ok: true,
    targets: {
      ppTaskId: typeof pp === "string" ? pp : null,
      actTaskId: typeof act === "string" ? act : null,
    },
  };
}

export function followupSlots(n: number): readonly RetrySlot[] {
  return Array.from({ length: n }, () => ["PUB_RETRY", "pp_poll"] as const);
}

export function retrySlots(targets: RetryTargets, followupOnly: boolean): readonly RetrySlot[] {
  if (targets.actTaskId) return [["ACT_SCRAPE_RETRY", false]];
  if (targets.ppTaskId) return [["PUB_RETRY", "pp_poll"]];
  if (followupOnly) return followupSlots(FOLLOWUP_SLOTS);
  return [
    ["PUB_RETRY", "pp_poll"], ["PUB_RETRY", "pp_poll"],
    ["ACT_SCRAPE_RETRY", true], ["PUB_RETRY", true],
    ["ACT_SCRAPE_RETRY", false], ["PUB_RETRY", false],
  ];
}
