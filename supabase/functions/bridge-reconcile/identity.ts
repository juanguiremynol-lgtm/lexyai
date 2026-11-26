import { canonicalPubIdentityFromRow, pubArticleIdFromRow } from "../_shared/canonicalPublicacionMapper.ts";
import { canonicalActIdentityFromRow } from "../_shared/canonicalActMapper.ts";

/** Identity helpers for bridge-reconcile (side-effect free; testable). */
function blank(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

export function norm(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s && s !== "null" && s !== "undefined" ? s.toLowerCase() : null;
}

export function providerIdentities(
  kind: "ACT" | "PUB",
  row: Record<string, any>,
  workItemId: string,
): string[] {
  const raw = (row.raw_data ?? {}) as Record<string, any>;
  const ids = [
    norm(row.hash_fingerprint),
    norm(row.asset_id ?? raw.asset_id ?? raw.id),
    norm(row.key ?? raw.key),
    norm(raw?.estado?.article_id),
  ];
  if (kind === "PUB") {
    ids.push(norm(canonicalPubIdentityFromRow({
      // Blank fijación is UNKNOWN, never a date; the canonical published_at
      // (portal date) carried by the adapter then anchors identity exactly as
      // in the writer. Legacy adapters without published_at keep raw fallback.
      source: row.source ?? null,
      fecha_fijacion: blank(row.fecha_fijacion),
      published_at: blank(row.published_at) ?? (blank(row.fecha_fijacion) ? null : blank(raw.fecha_publicacion)),
      tipo_publicacion: row.tipo_publicacion ?? null,
      title: row.title ?? raw.titulo ?? null,
      raw_data: raw,
    }, workItemId)));
  } else {
    ids.push(norm(canonicalActIdentityFromRow({
      act_date: row.fecha_actuacion ?? row.act_date ?? null,
      description: row.actuacion ?? row.description ?? null,
      raw_data: raw,
    }, workItemId)));
  }
  return ids.filter((x): x is string => Boolean(x));
}

export function localIdentities(kind: "ACT" | "PUB", row: Record<string, any>, workItemId: string): string[] {
  const raw = (row.raw_data ?? {}) as Record<string, any>;
  const ids = [
    norm(row.hash_fingerprint),
    norm(raw.asset_id ?? raw.id),
    norm(raw.key),
  ];
  // ITERATION 26 — the article id is read from an explicit field by the shared
  // helper (legacy composite-key rows still resolve, but the convention is no
  // longer inlined here).
  if (kind === "PUB") ids.push(norm(pubArticleIdFromRow(row)));
  if (kind === "PUB") {
    ids.push(norm(canonicalPubIdentityFromRow(row as any, workItemId)));
  } else {
    ids.push(norm(canonicalActIdentityFromRow(row as any, workItemId)));
  }
  return ids.filter((x): x is string => Boolean(x));
}

/** Legal identity is the normalized juridical fact, not a transported hash. */
export function legalIdentity(kind: "ACT" | "PUB", row: Record<string, any>, workItemId: string): string {
  if (kind === "PUB") return canonicalPubIdentityFromRow(row as any, workItemId);
  return canonicalActIdentityFromRow({
    act_date: row.fecha_actuacion ?? row.act_date ?? null,
    description: row.actuacion ?? row.description ?? null,
    raw_data: row.raw_data ?? {},
  }, workItemId);
}

/** Real provider-row grouping used by the reconciler (dedupe by legal identity). */
export function groupProviderRows(
  kind: "ACT" | "PUB",
  rows: Record<string, any>[],
  workItemId: string,
): Map<string, { ids: string[]; row: Record<string, any> }> {
  const out = new Map<string, { ids: string[]; row: Record<string, any> }>();
  for (const r of rows) {
    const ids = providerIdentities(kind, r, workItemId);
    if (ids.length === 0) continue;
    const key = norm(legalIdentity(kind, r, workItemId)) ?? ids[0];
    if (!out.has(key)) out.set(key, { ids, row: r });
  }
  return out;
}
