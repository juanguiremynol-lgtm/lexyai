import { toCanonicalActRow } from "./canonicalActMapper.ts";
import { extractActOrigin, resolveActIdentity, toActIdentityCandidate, type CandidateRow } from "./actOriginIdentity.ts";
import { canonicalPubIdentityFromRow, explodeProviderPublicaciones, type CanonicalPubRow, type ProviderPubUnit } from "./canonicalPublicacionMapper.ts";
import { ppExplicitPublicationDates, ppPublicationAttributionConflict } from "./ppExplicitPublicationDates.ts";
import { resolvePartyHint, samaiPublicationDocumentKey } from "./canonicalFingerprint.ts";
import { fetchFromCpnu, fetchFromSamai, fetchFromSamaiEstados, toWizardResult } from "./providerAdapters/index.ts";
import type { AdapterOptions, NormalizedPublicacion, ProviderAdapterResult } from "./providerAdapters/types.ts";

const UNSAVED_ID = "00000000-0000-4000-8000-000000000000";
export const INTAKE_JUDICIAL_TYPES = new Set(["CGP", "EJECUTIVO", "CPACA", "LABORAL", "PENAL_906", "TUTELA"]);

async function readStoredPublicaciones(radicado: string, signal: AbortSignal) {
  const base = Deno.env.get("PUBLICACIONES_BASE_URL")?.replace(/\/+$/, "");
  const key = Deno.env.get("PUBLICACIONES_X_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY");
  if (!base || !key) return { units: [], complete: false };
  try {
    const response = await fetch(`${base}/historico/${radicado}?live=false`, {
      headers: { "x-api-key": key, Accept: "application/json" },
      signal,
    });
    if (!response.ok) return { units: [], complete: false };
    const data = await response.json();
    if (data?.radicado !== radicado || data?.busqueda?.fuente !== "db") return { units: [], complete: false };
    const units = explodeProviderPublicaciones(data);
    const attributable = units.filter(unit => !ppPublicationAttributionConflict(unit, radicado));
    return { units: attributable, complete: data.consulta_completa === true && units.length === attributable.length };
  } catch {
    return { units: [], complete: false };
  }
}

function samaiUnit(pub: NormalizedPublicacion): ProviderPubUnit {
  return {
    _source_provider: "samai_estados",
    key: pub.key ?? pub.title,
    titulo: pub.title,
    tipo: pub.tipo_publicacion,
    fecha_publicacion: pub.fecha_providencia || pub.fecha_fijacion,
    fecha_auto_raw: pub.fecha_providencia,
    pdf_url: pub.pdf_url,
    raw_data: pub.raw_data,
    parte: resolvePartyHint(pub.raw_data),
  };
}

export function mapIntakeRows(acts: ProviderAdapterResult[], units: ProviderPubUnit[], radicado: string, workflow: string) {
  const candidates: CandidateRow[] = [];
  const actRows = acts.flatMap(source => source.actuaciones.flatMap(act => {
    if (act.indice_posicional || !act.actuacion?.trim()) return [];
    const raw = act.raw_data || {};
    const origin = extractActOrigin({ indice: act.indice, anotacion: act.anotacion, description: act.actuacion });
    const row = toCanonicalActRow({
      ...raw, ...act, fecha: act.fecha_actuacion, anexos: act.anexos_count,
      parte: resolvePartyHint(raw), _source: source.provider, _consolidated_sources: act.sources,
    }, {
      work_item_id: UNSAVED_ID, owner_id: null, organization_id: null, workflow_type: workflow,
      source_radicado: radicado, despacho: source.metadata?.despacho,
    });
    if (row.source_radicado !== radicado || row.raw_data.linkage_conflict) return [];
    Object.assign(row.raw_data, {
      origen_clave: origin.key, origen_indice: origin.indice, origen_solicitud: origin.solicitud,
      origen_radicada_en: origin.radicada_en, _idProceso: raw._idProceso ?? raw.idProceso ?? null,
      provider_observed_at: source.sourceObservedAt ?? null,
    });
    const candidate = toActIdentityCandidate({ ...row, id: String(candidates.length) });
    const decision = resolveActIdentity({
      v1: row.hash_fingerprint, semanticKey: candidate.semantic_key ?? null, rows: candidates,
      incoming: origin, provider: source.provider, evidence: row.description,
    });
    if (decision.kind === "match") return [];
    row.hash_fingerprint = decision.fingerprint;
    candidates.push({ ...candidate, hash_fingerprint: row.hash_fingerprint });
    return [row];
  }));
  const pubRows = new Map<string, CanonicalPubRow & { identity_date: string | null; party_hint: string | null; document_key: string | null }>();
  for (const unit of units) {
    const row = ppExplicitPublicationDates(unit, {
      work_item_id: UNSAVED_ID, organization_id: null, source_radicado: radicado,
      source: unit._source_provider ?? "publicaciones",
    });
    if (row.source_radicado !== radicado) continue;
    const samai = row.source === "samai_estados";
    row.hash_fingerprint = canonicalPubIdentityFromRow(row, UNSAVED_ID);
    const identityDate = samai ? row.published_at : row.fecha_fijacion ?? row.published_at;
    pubRows.set(row.hash_fingerprint, {
      ...row, identity_date: identityDate, party_hint: unit.parte ?? resolvePartyHint(unit.raw_data),
      document_key: samai ? samaiPublicationDocumentKey(unit) : null,
    });
  }
  return { acts: actRows, publications: [...pubRows.values()] };
}

export async function readIntakePreview(radicado: string, workflow: string) {
  const signal = AbortSignal.timeout(12_000);
  const options: AdapterOptions = {
    radicado, mode: "monitoring", timeoutMs: 10_000, signal, includeParties: true, allowBuscar: false,
  };
  const readers = workflow === "CPACA" ? [fetchFromSamai]
    : workflow === "TUTELA" ? [fetchFromCpnu, fetchFromSamai] : [fetchFromCpnu];
  const [actResults, publications] = await Promise.all([
    Promise.all(readers.map(read => read(options))),
    workflow === "CPACA" ? fetchFromSamaiEstados(options).then(result => ({
      units: result.publicaciones.map(samaiUnit),
      complete: result.sourceReadComplete === true && !result.identityMismatches?.length,
    })) : readStoredPublicaciones(radicado, signal),
  ]);
  const providers = actResults.map(toWizardResult);
  const primary = providers.find(result => result.found);
  const rows = mapIntakeRows(actResults, publications.units, radicado, workflow);
  const actsComplete = actResults.every(result => result.sourceReadComplete === true
    && result.actuaciones.every(act => !act.indice_posicional));
  return {
    rows,
    primary,
    actsComplete,
    publicationsComplete: publications.complete,
    attempts: providers.map(result => ({
      source: result.source, success: result.ok, found: result.found, latency_ms: result.latency_ms,
      events_found: result.eventsFound, error: result.error,
    })),
  };
}
