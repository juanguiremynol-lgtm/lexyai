/**
 * mergeEngine.ts — Shared merge logic for multi-provider ingestion.
 *
 * Handles deduplication, conflict detection, and provenance tracking
 * when MERGE strategy is active.
 *
 * Merge modes:
 *   UNION: union all records, enrich missing fields
 *   UNION_PREFER_PRIMARY: primary wins on conflicts, log diff
 *   VERIFY_ONLY: never modify canonical fields, only record provenance
 */

// ────────────────────── Types ──────────────────────

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

export interface NormalizedAct {
  hash_fingerprint: string;
  work_item_id: string;
  owner_id: string;
  organization_id: string;
  description: string;
  raw_text: string;
  normalized_text: string;
  act_date: string | null;
  act_date_raw: string | null;
  act_time: string | null;
  fecha_registro: string | null;
  estado: string | null;
  source: string;
  source_url: string | null;
  provider_instance_id: string;
  provider_case_id: string;
  [key: string]: unknown;
}

export interface NormalizedPub {
  hash_fingerprint: string;
  work_item_id: string;
  owner_id: string;
  organization_id: string;
  description: string;
  raw_text: string;
  pub_date: string | null;
  pub_date_raw: string | null;
  despacho: string | null;
  tipo_publicacion: string | null;
  source: string;
  source_url: string | null;
  provider_instance_id: string;
  provider_case_id: string;
  [key: string]: unknown;
}

export interface ProvenanceOp {
  table: "act_provenance" | "pub_provenance";
  record_id_field: "work_item_act_id" | "work_item_pub_id";
  dedupe_key: string;
  provider_instance_id: string;
  provider_event_id?: string;
}

export interface MergeConflict {
  work_item_id: string;
  organization_id: string;
  scope: "ACTS" | "PUBS";
  dedupe_key: string;
  field_name: string;
  primary_value: string | null;
  secondary_value: string | null;
  primary_provider_instance_id: string;
  secondary_provider_instance_id: string;
}

export interface MergeResult<T> {
  merged: T[];
  provenance: ProvenanceOp[];
  conflicts: MergeConflict[];
  stats: {
    total_primary: number;
    total_secondary: number;
    added_from_secondary: number;
    deduped: number;
    conflicts_detected: number;
  };
}

// ────────────────────── Dedupe Keys ──────────────────────

/**
 * Build a stable dedupe key for actuaciones.
 * Based on date + first 200 chars of normalized description.
 */
export function buildActDedupeKey(act: { act_date?: string | null; normalized_text?: string; description?: string }): string {
  const date = (act.act_date || "unknown").trim();
  const desc = (act.normalized_text || act.description || "").trim().slice(0, 200).toLowerCase();
  return `act|${date}|${desc}`;
}

/**
 * Build a stable dedupe key for publicaciones.
 * Based on date + tipo + first 200 chars of description.
 */
export function buildPubDedupeKey(pub: { pub_date?: string | null; tipo_publicacion?: string | null; description?: string }): string {
  const date = (pub.pub_date || "unknown").trim();
  const tipo = (pub.tipo_publicacion || "").trim().toLowerCase();
  const desc = (pub.description || "").trim().slice(0, 200).toLowerCase();
  return `pub|${date}|${tipo}|${desc}`;
}

// ────────────────────── Merge Logic ──────────────────────

/** Fields to compare for conflict detection */
const ACT_COMPARE_FIELDS = ["description", "estado", "act_time", "fecha_registro"] as const;
const PUB_COMPARE_FIELDS = ["description", "despacho", "tipo_publicacion", "fecha_fijacion", "fecha_desfijacion"] as const;

/**
 * Merge actuaciones from primary and secondary providers.
 */
export function mergeActs(
  primaryActs: NormalizedAct[],
  secondaryActs: NormalizedAct[],
  mergeMode: MergeMode,
  workItemId: string,
  organizationId: string,
): MergeResult<NormalizedAct> {
  const keyMap = new Map<string, NormalizedAct>();
  const provenance: ProvenanceOp[] = [];
  const conflicts: MergeConflict[] = [];
  let added = 0;
  let deduped = 0;

  // Index primary acts
  for (const act of primaryActs) {
    const key = buildActDedupeKey(act);
    keyMap.set(key, act);
    provenance.push({
      table: "act_provenance",
      record_id_field: "work_item_act_id",
      dedupe_key: key,
      provider_instance_id: act.provider_instance_id,
    });
  }

  // Process secondary acts
  for (const act of secondaryActs) {
    const key = buildActDedupeKey(act);
    const existing = keyMap.get(key);

    if (!existing) {
      // New record from secondary
      if (mergeMode === "VERIFY_ONLY") {
        // Don't add to canonical, only record provenance
        provenance.push({
          table: "act_provenance",
          record_id_field: "work_item_act_id",
          dedupe_key: key,
          provider_instance_id: act.provider_instance_id,
        });
      } else {
        // UNION / UNION_PREFER_PRIMARY: add new record
        keyMap.set(key, act);
        added++;
        provenance.push({
          table: "act_provenance",
          record_id_field: "work_item_act_id",
          dedupe_key: key,
          provider_instance_id: act.provider_instance_id,
        });
      }
    } else {
      // Duplicate found
      deduped++;
      provenance.push({
        table: "act_provenance",
        record_id_field: "work_item_act_id",
        dedupe_key: key,
        provider_instance_id: act.provider_instance_id,
      });

      if (mergeMode === "UNION") {
        // Enrich: fill null fields from secondary
        for (const field of ACT_COMPARE_FIELDS) {
          if (existing[field] == null && act[field] != null) {
            (existing as any)[field] = act[field];
          }
        }
      } else if (mergeMode === "UNION_PREFER_PRIMARY") {
        // Primary wins, but detect conflicts
        for (const field of ACT_COMPARE_FIELDS) {
          const pv = existing[field];
          const sv = act[field];
          if (pv != null && sv != null && String(pv) !== String(sv)) {
            conflicts.push({
              work_item_id: workItemId,
              organization_id: organizationId,
              scope: "ACTS",
              dedupe_key: key,
              field_name: field,
              primary_value: String(pv),
              secondary_value: String(sv),
              primary_provider_instance_id: existing.provider_instance_id,
              secondary_provider_instance_id: act.provider_instance_id,
            });
          }
          // Enrich nulls even in prefer-primary
          if (pv == null && sv != null) {
            (existing as any)[field] = sv;
          }
        }
      }
      // VERIFY_ONLY: no changes to canonical
    }
  }

  return {
    merged: Array.from(keyMap.values()),
    provenance,
    conflicts,
    stats: {
      total_primary: primaryActs.length,
      total_secondary: secondaryActs.length,
      added_from_secondary: added,
      deduped,
      conflicts_detected: conflicts.length,
    },
  };
}

/**
 * Merge publicaciones from primary and secondary providers.
 */
export function mergePubs(
  primaryPubs: NormalizedPub[],
  secondaryPubs: NormalizedPub[],
  mergeMode: MergeMode,
  workItemId: string,
  organizationId: string,
): MergeResult<NormalizedPub> {
  const keyMap = new Map<string, NormalizedPub>();
  const provenance: ProvenanceOp[] = [];
  const conflicts: MergeConflict[] = [];
  let added = 0;
  let deduped = 0;

  for (const pub of primaryPubs) {
    const key = buildPubDedupeKey(pub);
    keyMap.set(key, pub);
    provenance.push({
      table: "pub_provenance",
      record_id_field: "work_item_pub_id",
      dedupe_key: key,
      provider_instance_id: pub.provider_instance_id,
    });
  }

  for (const pub of secondaryPubs) {
    const key = buildPubDedupeKey(pub);
    const existing = keyMap.get(key);

    if (!existing) {
      if (mergeMode === "VERIFY_ONLY") {
        provenance.push({
          table: "pub_provenance",
          record_id_field: "work_item_pub_id",
          dedupe_key: key,
          provider_instance_id: pub.provider_instance_id,
        });
      } else {
        keyMap.set(key, pub);
        added++;
        provenance.push({
          table: "pub_provenance",
          record_id_field: "work_item_pub_id",
          dedupe_key: key,
          provider_instance_id: pub.provider_instance_id,
        });
      }
    } else {
      deduped++;
      provenance.push({
        table: "pub_provenance",
        record_id_field: "work_item_pub_id",
        dedupe_key: key,
        provider_instance_id: pub.provider_instance_id,
      });

      if (mergeMode === "UNION") {
        for (const field of PUB_COMPARE_FIELDS) {
          if (existing[field] == null && pub[field] != null) {
            (existing as any)[field] = pub[field];
          }
        }
      } else if (mergeMode === "UNION_PREFER_PRIMARY") {
        for (const field of PUB_COMPARE_FIELDS) {
          const pv = existing[field];
          const sv = pub[field];
          if (pv != null && sv != null && String(pv) !== String(sv)) {
            conflicts.push({
              work_item_id: workItemId,
              organization_id: organizationId,
              scope: "PUBS",
              dedupe_key: key,
              field_name: field,
              primary_value: String(pv),
              secondary_value: String(sv),
              primary_provider_instance_id: existing.provider_instance_id,
              secondary_provider_instance_id: pub.provider_instance_id,
            });
          }
          if (pv == null && sv != null) {
            (existing as any)[field] = sv;
          }
        }
      }
    }
  }

  return {
    merged: Array.from(keyMap.values()),
    provenance,
    conflicts,
    stats: {
      total_primary: primaryPubs.length,
      total_secondary: secondaryPubs.length,
      added_from_secondary: added,
      deduped,
      conflicts_detected: conflicts.length,
    },
  };
}
