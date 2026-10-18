/**
 * ITER70 rev.3 — persistence-state helpers for sync-by-work-item.
 *
 * - loadAllActiveActs: COMPLETE, paginated read of a work item's live acts.
 *   Any page error throws: identity resolution must never run on a partial set.
 * - resolvePersistedAct: after a confirmed RPC success, read back the real row
 *   (UUID + document state) by fingerprint. Never fabricates ids.
 * - ActDocState: effective documentos state per act id, updated after every
 *   confirmed write so later items in the same batch never compare against a
 *   stale snapshot (prevents degrading 2 descriptors to 1).
 */

export const ACT_SELECT_COLUMNS =
  "id, act_date, description, fecha_registro_source, raw_data, hash_fingerprint, source, recurso_consecutivo, documentos, documentos_observados_en";

export class ActLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActLoadError";
  }
}

// deno-lint-ignore no-explicit-any
type Client = any;

export async function loadAllActiveActs(
  client: Client,
  workItemId: string,
  pageSize = 1000,
  maxPages = 200,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await client
      .from("work_item_acts")
      .select(ACT_SELECT_COLUMNS)
      .eq("work_item_id", workItemId)
      .eq("is_archived", false)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new ActLoadError(`existing acts read failed at offset ${from}: ${error.message}`);
    if (!Array.isArray(data)) throw new ActLoadError(`existing acts read returned no data at offset ${from}`);
    out.push(...data);
    if (data.length < pageSize) return out;
  }
  throw new ActLoadError(`existing acts exceed ${maxPages * pageSize} rows; refusing partial identity set`);
}

export interface PersistedAct {
  id: string;
  description: string | null;
  raw_data: Record<string, unknown> | null;
  documentos: unknown;
  documentos_observados_en: string | null;
}

/** Returns the real row for a fingerprint, null when absent; throws on read error. */
export async function resolvePersistedAct(
  client: Client,
  workItemId: string,
  fingerprint: string,
): Promise<PersistedAct | null> {
  const { data, error } = await client
    .from("work_item_acts")
    .select("id, description, raw_data, documentos, documentos_observados_en")
    .eq("work_item_id", workItemId)
    .eq("hash_fingerprint", fingerprint)
    .eq("is_archived", false)
    .limit(1)
    .maybeSingle();
  if (error) throw new ActLoadError(`persisted act read-back failed: ${error.message}`);
  if (!data || typeof data.id !== "string") return null;
  return data as PersistedAct;
}

export interface DocState {
  documentos: unknown;
  documentos_observados_en: string | null;
}

export class ActDocState {
  private map = new Map<string, DocState>();
  set(id: string, s: DocState) {
    this.map.set(id, { documentos: s.documentos ?? null, documentos_observados_en: s.documentos_observados_en ?? null });
  }
  get(id: string): DocState {
    return this.map.get(id) ?? { documentos: null, documentos_observados_en: null };
  }
}
