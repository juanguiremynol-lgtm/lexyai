/**
 * canonicalActMapper.ts — ITERATION 22, item 2.
 *
 * THE SINGLE CANONICAL TRANSFORMATION from an actuaciones-family provider
 * payload (CPNU / SAMAI / TUTELAS / PENAL_906) to a `work_item_acts` row.
 *
 * Audit result that produced this file: the acts path was *mostly* consolidated
 * — `sync-by-work-item` and `bridge-reconcile` both funnel through
 * `canonicalActFingerprint` — but `sync-penal906-by-radicado` computed its own
 * `penal_<hash>` identity over `"${actuacion} ${anotacion}"` and wrote the row
 * with a bare `.insert()`, bypassing both the canonical fingerprint and the
 * persistence-bucket RPC. The publicaciones divergence had simply not surfaced
 * there yet because no reconciliation had ever run over PENAL_906 items.
 *
 * Invariant (same as the publicaciones mapper): identity is recomputable from
 * the stored row — `act_date` + normalized `description` + party discriminator.
 */

import { canonicalActFingerprint } from "./canonicalFingerprint.ts";
import { normalizeSourceKey, normalizeSourceList } from "./canonicalSource.ts";
import { extractRunProvenance } from "./runProvenance.ts";
import { resolveProviderLinkage } from "./recursoStreams.ts";
import { resolveDocumentosObservadosEn, normalizeActDocumentos, type ActDocumento } from "./actDocumentos.ts";

export interface ProviderActUnit {
  actuacion: string;
  anotacion?: string | null;
  /** Raw provider date string (any format). */
  fecha?: string | null;
  /** Already-normalized YYYY-MM-DD, when the caller has it. */
  act_date?: string | null;
  fecha_registro?: string | null;
  estado?: string | null;
  anexos?: unknown;
  indice?: unknown;
  documentos?: unknown;
  instancia?: string | null;
  fecha_inicia_termino?: string | null;
  fecha_finaliza_termino?: string | null;
  nombre_despacho?: string | null;
  parte?: string | null;
  /** Provider key: cpnu | samai | tutelas … */
  _source?: string;
  _consolidated_sources?: string[];
  _cross_provider_data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CanonicalActContext {
  work_item_id: string;
  owner_id: string | null;
  organization_id: string | null;
  workflow_type: string | null;
  /** Fallback provider key when the unit does not carry `_source`. */
  source?: string;
  despacho?: string | null;
  /** YYYY-MM-DD; defaults to today (UTC). */
  scrape_date?: string;
  /** ITER59 — the 23-digit radicación of the stream being ingested. A recurso
   *  stream (…01) lands in the SAME work item as its base process (…00). */
  source_radicado?: string | null;
}

export interface CanonicalActRow {
  owner_id: string | null;
  organization_id: string | null;
  work_item_id: string;
  workflow_type: string | null;
  description: string;
  act_date: string | null;
  act_date_raw: string | null;
  event_date: string | null;
  event_summary: string;
  source: string;
  source_platform: string;
  sources: string[];
  hash_fingerprint: string;
  scrape_date: string;
  despacho: string | null;
  date_source: string;
  date_confidence: string;
  raw_schema_version: string;
  instancia: string | null;
  source_radicado: string | null;
  recurso_consecutivo: string | null;
  instancia_grado: string | null;
  fecha_registro_source: string | null;
  inicia_termino: string | null;
  /** ITER60 — CPNU act-level documents. `null` = not observed, `[]` = none. */
  documentos: ActDocumento[] | null;
  documentos_observados_en: string | null;
  raw_data: Record<string, unknown>;
}

const DATE_CONFIDENCE: Record<string, string> = {
  api_explicit: "high",
  parsed_filename: "medium",
  parsed_annotation: "medium",
  parsed_title: "medium",
  inferred_sync: "low",
};

const SOURCE_PLATFORM: Record<string, string> = {
  cpnu: "cpnu", samai: "samai", tutelas: "tutelas", "tutelas-api": "tutelas",
};

export function parseActDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  const dateOnly = String(dateStr).split(" ")[0];
  const m = dateOnly.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const t = new Date(String(dateStr));
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

/** Canonical description: `actuacion` head + " - " + anotación tail.
 *  The fingerprint normalizer drops everything after " - ", so the head stays
 *  the stable identifier while the tail remains visible to the lawyer. */
export function canonicalActDescription(unit: ProviderActUnit): string {
  const head = String(unit.actuacion ?? "").trim();
  const tail = unit.anotacion ? String(unit.anotacion).trim() : "";
  return tail ? `${head} - ${tail}` : head;
}

/**
 * Map one provider actuación to the canonical row. This is the ONLY place a
 * `work_item_acts` payload may be constructed from provider data.
 */
export function toCanonicalActRow(
  unit: ProviderActUnit,
  ctx: CanonicalActContext,
): CanonicalActRow {
  const actDate = unit.act_date ?? parseActDate(unit.fecha);
  const description = canonicalActDescription(unit);
  // ITERATION 24 — `source` is a closed lowercase enum, canonicalised HERE and
  // nowhere else. Compound values (`CPNU+TUTELAS`) collapse to their primary
  // provider; the full chain survives in `sources`.
  const rawSource = unit._source || ctx.source || "cpnu";
  const actSource = normalizeSourceKey(rawSource, "cpnu");
  const sourceList = normalizeSourceList(rawSource, unit._consolidated_sources ?? null, "cpnu");
  const dateSource = actDate ? "api_explicit" : "inferred_sync";

  // ITER59 — one place resolves which provider stream this fact came from.
  const linkage = resolveProviderLinkage(unit, ctx.source_radicado ?? null);
  // ITER60 — documents are resolved in exactly one place too.
  const documentos = normalizeActDocumentos(unit.documentos);
  const documentosObservedAt = resolveDocumentosObservadosEn(
    unit.documentos,
    (unit as Record<string, unknown>).documentos_observados_en,
  );

  const rawData: Record<string, unknown> = {
    actuacion: unit.actuacion,
    anotacion: unit.anotacion ?? null,
    fecha_registro: unit.fecha_registro ?? null,
    estado: unit.estado ?? null,
    anexos: unit.anexos ?? null,
    indice: unit.indice ?? null,
    documentos: unit.documentos ?? null,
    instancia: unit.instancia ?? null,
    fecha_inicia_termino: unit.fecha_inicia_termino ?? null,
    fecha_finaliza_termino: unit.fecha_finaliza_termino ?? null,
  };
  rawData.radicacion = linkage.radicacion;
  rawData.radicacion_base = linkage.base21;
  rawData.consecutivo_recurso = linkage.consecutivo;
  rawData.instancia_grado = linkage.instancia;
  if (linkage.conflict) rawData.linkage_conflict = true;
  // ITER55 A1 — carry the provider's own run provenance verbatim. The DB
  // trigger reads it from raw_data and only falls back to our 30-minute
  // window when it is absent. NULL stays NULL (UNKNOWN), never a guess.
  const provenance = extractRunProvenance(unit);
  rawData.run_type = provenance.run_type;
  rawData.previous_scan_at = provenance.previous_scan_at;
  rawData.provider_observed_at = provenance.provider_observed_at;
  if (unit.parte) rawData.parte = unit.parte;
  const consolidated = sourceList;
  if (consolidated.length > 1) rawData._sources = consolidated;
  if (unit._cross_provider_data) Object.assign(rawData, unit._cross_provider_data);

  return {
    owner_id: ctx.owner_id,
    organization_id: ctx.organization_id,
    work_item_id: ctx.work_item_id,
    workflow_type: ctx.workflow_type,
    description,
    act_date: actDate,
    act_date_raw: (unit.fecha as string) ?? actDate,
    event_date: actDate,
    event_summary: description.slice(0, 500),
    source: actSource,
    source_platform: SOURCE_PLATFORM[actSource] || actSource,
    sources: consolidated.length > 0 ? consolidated : [actSource],
    hash_fingerprint: canonicalActFingerprint({
      work_item_id: ctx.work_item_id,
      act_date: actDate,
      actuacion: description,
      party_hint: unit.parte ?? null,
      recurso_consecutivo: linkage.consecutivo,
    }),
    scrape_date: ctx.scrape_date || new Date().toISOString().slice(0, 10),
    // ITER60 — the act's OWN despacho wins: a second-instance act is produced
    // by the superior, not by the despacho the work item is bound to.
    despacho: unit.nombre_despacho ?? linkage.despacho ?? ctx.despacho ?? null,
    date_source: dateSource,
    date_confidence: DATE_CONFIDENCE[dateSource] || "low",
    raw_schema_version: actSource === "cpnu"
      ? "cpnu_v2"
      : actSource === "samai" ? "samai_2026_02" : `${actSource}_v1`,
    instancia: unit.instancia ?? null,
    source_radicado: linkage.radicacion,
    recurso_consecutivo: linkage.consecutivo,
    instancia_grado: linkage.instancia,
    fecha_registro_source: unit.fecha_registro ?? null,
    inicia_termino: unit.fecha_inicia_termino ?? null,
    documentos,
    documentos_observados_en: documentosObservedAt,
    raw_data: rawData,
  };
}

/** Identity of a stored `work_item_acts` row, recomputed from the row itself. */
export function canonicalActIdentityFromRow(
  row: {
    act_date?: string | null;
    description?: string | null;
    raw_data?: any;
    recurso_consecutivo?: string | null;
  },
  workItemId: string,
): string {
  return canonicalActFingerprint({
    work_item_id: workItemId,
    act_date: row.act_date ?? null,
    actuacion: row.description ?? null,
    party_hint: (row.raw_data as any)?.parte ?? null,
    recurso_consecutivo:
      row.recurso_consecutivo ?? (row.raw_data as any)?.consecutivo_recurso ?? null,
  });
}
