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

import { compareOrigins, extractActOrigin, hasStableOrigin, originFromRow, planEnrichment, type IncomingAct, type HistoricalRepairScope } from './actOriginIdentity.ts';
import { documentosEnrichmentPatch, normalizeActDocumentos, mergeActDocumentos } from './actDocumentos.ts';

export const ACT_SELECT_COLUMNS =
  "id, act_date, description, fecha_registro_source, inicia_termino, raw_data, hash_fingerprint, source, recurso_consecutivo, documentos, documentos_observados_en";

export class ActLoadError extends Error {
  constructor(message: string, readonly persistenceUnknown = false) {
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

/** Atomic raw-data/document enrichment. A zero-row conditional PATCH is a
 * conflict, never success: re-read BOTH values and recompute the union. */
export async function enrichPersistedAct(
  client: Client,
  workItemId: string,
  actId: string,
  incoming: IncomingAct & { documentos_observados_en?: unknown; [key: string]: unknown },
  opts: { provider?: string | null; repair?: HistoricalRepairScope | null } = {},
  maxAttempts = 3,
): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: row, error: readError } = await client.from('work_item_acts')
      .select(ACT_SELECT_COLUMNS).eq('work_item_id', workItemId).eq('id', actId)
      .eq('is_archived', false).maybeSingle();
    if (readError || !row) throw new ActLoadError(`enrichment fresh read failed: ${readError?.message ?? 'row missing'}`);
    const storedOrigin = originFromRow(row);
    const incomingOrigin = extractActOrigin({ indice: incoming.indice, anotacion: incoming.anotacion });
    const relation = compareOrigins(storedOrigin, incomingOrigin);
    const stableStored = hasStableOrigin(storedOrigin), stableIncoming = hasStableOrigin(incomingOrigin);
    if (relation !== 'equivalent' && (stableStored || stableIncoming)) {
      throw new ActLoadError('enrichment rejected: insufficient or conflicting origin evidence');
    }
    if (relation !== 'equivalent' && row.description !== `${incoming.actuacion}${incoming.anotacion ? ' - ' + incoming.anotacion : ''}`) {
      throw new ActLoadError('enrichment rejected: unconfirmed source text changed');
    }
    const normalized = { ...incoming, documentos: normalizeActDocumentos(incoming.documentos) };
    const plan = planEnrichment(row, normalized, relation, undefined, opts);
    const docs = documentosEnrichmentPatch(row.documentos, row.documentos_observados_en, mergeActDocumentos(row.raw_data?.documentos, incoming.documentos), incoming.documentos_observados_en);
    const dates: Record<string, string> = {};
    for (const [column, input] of [['fecha_registro_source', 'fecha_registro'], ['inicia_termino', 'fecha_inicia_termino']]) {
      const value = incoming[input];
      if (row[column] == null && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) dates[column] = value;
    }
    if (!plan && !docs && Object.keys(dates).length === 0) return row;
    const raw = { ...(plan?.raw_data ?? row.raw_data ?? {}) };
    for (const key of ['fecha_registro', 'estado', 'anexos', 'indice', 'instancia']) {
      const value = incoming[key];
      if (value !== undefined && value !== null && value !== '') raw[key] = value;
    }
    if (docs) raw.documentos = docs.documentos;
    const update = { raw_data: raw, ...docs, ...dates,
      ...(plan?.event_summary ? { event_summary: plan.event_summary } : {}),
      last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data, error } = await client.rpc('rpc_enrich_work_item_act', {
      p_work_item_id: workItemId, p_act_id: actId,
      p_expected_raw_data: row.raw_data ?? null,
      p_expected_documentos: row.documentos ?? null,
      p_patch: update,
    }).select(ACT_SELECT_COLUMNS);
    if (error) throw new ActLoadError(`enrichment RPC failed: ${String(error.code || '')} ${String(error.message || 'unknown error').slice(0, 400)}`, true);
    if (Array.isArray(data) && data.length === 1 && data[0].id === actId) return data[0];
    // Zero rows means another writer changed a compared value; retry from a
    // fresh read. No success count or downstream effect occurs here.
  }
  throw new ActLoadError(`enrichment CAS affected zero rows after ${maxAttempts} fresh-read attempts`);
}
