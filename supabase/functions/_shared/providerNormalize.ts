/**
 * providerNormalize.ts — Map external provider /snapshot response to canonical
 * ATENIA objects (work_item_acts and work_item_publicaciones rows).
 *
 * Keeps provenance metadata so we can trace every ingested record back to
 * the provider instance, case ID, and retrieval timestamp.
 */

import {
  sanitizeDateSource,
  DATE_SOURCE_TO_CONFIDENCE,
  type DateSource,
} from "./sync-constraints.ts";

// Re-export for convenience — edge functions can import from here
export { sanitizeDateSource, DATE_SOURCE_TO_CONFIDENCE };

// ────────────────────────────── Types ──────────────────────────────

export interface ProviderActuacion {
  /** Hash fingerprint for dedup (provider should supply; we'll generate if missing) */
  hash_fingerprint?: string;
  description: string;
  raw_text?: string;
  act_date?: string | null;
  act_date_raw?: string | null;
  act_time?: string | null;
  date_source?: string;
  fecha_registro?: string | null;
  estado?: string | null;
  attachments?: unknown;
  anexos_count?: number;
  source_url?: string | null;
  raw_data?: unknown;
  [key: string]: unknown;
}

export interface ProviderPublicacion {
  hash_fingerprint?: string;
  description: string;
  raw_text?: string;
  pub_date?: string | null;
  pub_date_raw?: string | null;
  date_source?: string;
  fecha_fijacion?: string | null;
  fecha_desfijacion?: string | null;
  despacho?: string | null;
  tipo_publicacion?: string | null;
  source_url?: string | null;
  raw_data?: unknown;
  [key: string]: unknown;
}

export interface ProviderSnapshot {
  ok: boolean;
  actuaciones?: ProviderActuacion[];
  publicaciones?: ProviderPublicacion[];
  provider_case_id?: string;
  source_url?: string;
  [key: string]: unknown;
}

export interface Provenance {
  provider_instance_id: string;
  provider_case_id: string;
  source_url?: string | null;
  retrieved_at: string;
}

// ────────────────────────────── Helpers ──────────────────────────────

async function generateFingerprint(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

/**
 * Translate raw SAMAI-format records (Spanish field names) into canonical ProviderActuacion format.
 * SAMAI Estados returns: { Actuación, Fecha Providencia, Radicacion, url_descarga, hash_documento, Ponente, ... }
 * We need:              { description, act_date, source_url, hash_fingerprint, raw_data, ... }
 */
export function translateSamaiFormat(rawRecords: Record<string, unknown>[]): ProviderActuacion[] {
  return rawRecords.map((r) => {
    // Parse "DD/MM/YYYY" → "YYYY-MM-DD"
    const rawDate = String(r["Fecha Providencia"] || r["fecha_providencia"] || "");
    let actDate: string | null = null;
    const dmyMatch = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmyMatch) {
      actDate = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}/)) {
      actDate = rawDate.slice(0, 10);
    }

    const description = String(
      r["Actuación"] || r["actuacion"] || r["Actuacion"] || r["description"] || ""
    );
    const docNotif = String(r["Docum. a notif."] || r["docum_a_notif"] || "");
    // Use hyphen " - " (not em-dash " — ") to match built-in SAMAI format
    const fullDescription = docNotif && docNotif !== "undefined"
      ? `${description} - ${docNotif}`
      : description;

    const hashDoc = String(r["hash_documento"] || "");
    const urlDescarga = String(r["url_descarga"] || "");

    return {
      description: fullDescription,
      raw_text: fullDescription,
      act_date: actDate,
      act_date_raw: rawDate || null,
      date_source: "api_explicit",
      source_url: urlDescarga || null,
      hash_fingerprint: undefined, // Let normalizer generate from content
      raw_data: r,
      // Extras: ponente, class, parties — stored in raw_data
    } as ProviderActuacion;
  });
}

// ────────────────────────────── Normalizers ──────────────────────────────

export async function normalizeActuaciones(
  raw: ProviderActuacion[],
  provenance: Provenance,
  workItemId: string,
  ownerId: string,
  organizationId: string,
) {
  const results = [];
  for (const a of raw) {
    const description = a.description || a.raw_text || "";
    const fingerprint =
      a.hash_fingerprint ||
      (await generateFingerprint(
        `${workItemId}|${a.act_date || ""}|${description.slice(0, 200)}`,
      ));

    const dateSource = sanitizeDateSource(a.date_source || "api_explicit") as DateSource;

    results.push({
      work_item_id: workItemId,
      owner_id: ownerId,
      organization_id: organizationId,
      hash_fingerprint: fingerprint,
      description,
      act_date: a.act_date || null,
      act_date_raw: a.act_date_raw || a.act_date || null,
      date_source: dateSource,
      date_confidence: DATE_SOURCE_TO_CONFIDENCE[dateSource] || "low",
      source_url: a.source_url || provenance.source_url || null,
      source: "external_provider",
      raw_data: a.raw_data || null,
      provider_instance_id: provenance.provider_instance_id,
      provider_case_id: provenance.provider_case_id,
      provenance: {
        ...provenance,
        record_type: "actuacion",
      },
    });
  }
  return results;
}

export async function normalizePublicaciones(
  raw: ProviderPublicacion[],
  provenance: Provenance,
  workItemId: string,
  ownerId: string,
  organizationId: string,
) {
  const results = [];
  for (const p of raw) {
    const description = p.description || p.raw_text || "";
    const fingerprint =
      p.hash_fingerprint ||
      (await generateFingerprint(
        `${workItemId}|pub|${p.pub_date || ""}|${description.slice(0, 200)}`,
      ));

    const dateSource = sanitizeDateSource(p.date_source || "api_explicit") as DateSource;

    results.push({
      work_item_id: workItemId,
      organization_id: organizationId,
      hash_fingerprint: fingerprint,
      // Map to work_item_publicaciones column names
      title: description,
      annotation: p.raw_text || null,
      source: "external_provider",
      published_at: p.pub_date || null,
      pdf_url: p.source_url || provenance.source_url || null,
      entry_url: null,
      pdf_available: !!(p.source_url || provenance.source_url),
      date_source: dateSource,
      date_confidence: DATE_SOURCE_TO_CONFIDENCE[dateSource] || "low",
      fecha_fijacion: p.fecha_fijacion || null,
      fecha_desfijacion: p.fecha_desfijacion || null,
      despacho: p.despacho || null,
      tipo_publicacion: p.tipo_publicacion || null,
      raw_data: p.raw_data || null,
      provider_instance_id: provenance.provider_instance_id,
      provider_case_id: provenance.provider_case_id,
      provenance: {
        ...provenance,
        record_type: "publicacion",
      },
    });
  }
  return results;
}
