/** Follow-up-only drains claim at most this many admitted runs per call. */
export const FOLLOWUP_SLOTS = 8;
export function followupSlots(n: number) {
  return Array.from({ length: n }, () => ["PUB_RETRY", "pp_poll"] as const);
}
