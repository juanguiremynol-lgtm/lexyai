/**
 * deadline-review-state — per-user presentation state for deadlines awaiting
 * manual review. Acknowledging or snoozing never changes the deadline's
 * procedural status; it only records that this user has seen the notice.
 */
import { supabase } from "@/integrations/supabase/client";

export async function updateDeadlineReviewState(
  ids: string[],
  action: "acknowledge" | "snooze",
  until?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("acknowledge_deadline_reviews", {
    _ids: ids,
    _action: action,
    _until: until ?? null,
  });
  if (error) throw error;
  // The RPC must confirm every requested row; a partial write is a failure.
  if (!data || data.length !== ids.length) {
    throw new Error("No se confirmaron todos los términos");
  }
}

/** Next day at 07:00 Bogotá (UTC-5), the hour the daily sync summary lands. */
export function nextMorningCOT(from: Date = new Date()): string {
  const cot = new Date(from.getTime() - 5 * 60 * 60 * 1000);
  const next = new Date(Date.UTC(cot.getUTCFullYear(), cot.getUTCMonth(), cot.getUTCDate() + 1, 12, 0, 0));
  return next.toISOString();
}
