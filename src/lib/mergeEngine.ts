/**
 * mergeEngine.ts — Frontend-compatible merge logic (mirrors Deno _shared/mergeEngine.ts).
 * Used for preview/display purposes in the Super Admin UI.
 */

export type MergeMode = "UNION" | "UNION_PREFER_PRIMARY" | "VERIFY_ONLY";

export interface MergePolicy {
  strategy: "SELECT" | "MERGE";
  merge_mode: MergeMode;
  merge_budget_max_providers: number;
  merge_budget_max_ms: number;
  allow_merge_on_empty: boolean;
}

export const DEFAULT_MERGE_POLICY: MergePolicy = {
  strategy: "SELECT",
  merge_mode: "UNION_PREFER_PRIMARY",
  merge_budget_max_providers: 2,
  merge_budget_max_ms: 15000,
  allow_merge_on_empty: false,
};

export function buildActDedupeKey(act: { act_date?: string | null; normalized_text?: string; description?: string }): string {
  const date = (act.act_date || "unknown").trim();
  const desc = (act.normalized_text || act.description || "").trim().slice(0, 200).toLowerCase();
  return `act|${date}|${desc}`;
}

export function buildPubDedupeKey(pub: { pub_date?: string | null; tipo_publicacion?: string | null; description?: string }): string {
  const date = (pub.pub_date || "unknown").trim();
  const tipo = (pub.tipo_publicacion || "").trim().toLowerCase();
  const desc = (pub.description || "").trim().slice(0, 200).toLowerCase();
  return `pub|${date}|${tipo}|${desc}`;
}
