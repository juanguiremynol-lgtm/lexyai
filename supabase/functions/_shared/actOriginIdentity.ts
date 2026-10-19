/**
 * actOriginIdentity.ts — ITER70 (rev. 2 after independent review).
 *
 * Root cause: SAMAI's read API (external samai-read-api) returns memoriales
 * with NO `indice`, NO `fechaRegistro`, `anexos: null` and no URL. Both identity
 * layers (canonical fingerprint = date + title head; semantic key = date +
 * title + fecha_registro) then saw two different "RECIBE MEMORIALES ONLINE"
 * filings of the same day as ONE act and the "longer anotación wins" backfill
 * grafted solicitud B onto row A.
 *
 * The provider carries an origin identity inside the text (ventanilla virtual
 * "solicitud No. NNNN" + exact radicación timestamp) and, sometimes, `indice`.
 *
 * Rules:
 *  - v1 fingerprints are never redefined (fingerprint-immutability rule).
 *  - Identity resolution compares ALL candidate rows that share the v1 prefix or
 *    the semantic key, and matches by component EQUIVALENCE (any shared
 *    component equal). A row first stored as solicitud:X keeps its fingerprint
 *    when indice:N later appears — it is never re-keyed.
 *  - A versioned fingerprint `<v1>_o<hash>` is minted only on INSERT of a new
 *    origin when v1 is already taken by a different origin.
 *  - Enrichment (origin components + attachment inventory) is independent of
 *    the anotación length criterion.
 */

import { mergeActDocumentos } from './actDocumentos.ts';
import { mergeAnexosObservation } from './actDocumentObservation.ts';

export interface ActOriginIdentity {
  key: string | null;
  indice: string | null;
  solicitud: string | null;
  /** Verbatim "dd/mm/yyyy hh:mm:ss" from the text, when present. */
  radicada_en: string | null;
}

const SOLICITUD_RE = /solicitud\s+No\.?\s*(\d{4,})/i;
const RADICADA_EN_RE = /de\s+fecha:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?)/i;
const ANEXOS_RE = /Documentos\s+anexos:\s*(\d+)/i;
const ARCHIVOS_RE = /\b(\d+)\s*-?\s*archivos?\b/i;

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined" ? s : null;
}

/** Primary key preference: text-borne components first (present from the very
 *  first read), indice last (may appear later). Display/diagnostic only. */
function primaryKey(o: Omit<ActOriginIdentity, "key">): string | null {
  if (o.solicitud) return `solicitud:${o.solicitud}`;
  if (o.radicada_en) return `radicada:${o.radicada_en}`;
  if (o.indice) return `indice:${o.indice}`;
  return null;
}

function make(o: Omit<ActOriginIdentity, "key">): ActOriginIdentity {
  const indice = o.indice && /^\d+$/.test(o.indice) ? o.indice.replace(/^0+(?=\d)/, '') : o.indice;
  const normalized = { ...o, indice };
  return { ...normalized, key: primaryKey(normalized) };
}

export function extractActOrigin(input: {
  indice?: unknown;
  anotacion?: unknown;
  description?: unknown;
}): ActOriginIdentity {
  const text = `${clean(input.anotacion) ?? ""} ${clean(input.description) ?? ""}`;
  return make({
    indice: clean(input.indice),
    solicitud: text.match(SOLICITUD_RE)?.[1] ?? null,
    radicada_en: text.match(RADICADA_EN_RE)?.[1] ?? null,
  });
}

/**
 * Origin of a stored row. The protected `description` (first text ever
 * written) is authoritative for text components; raw_data.anotacion may be
 * contaminated and is deliberately NOT read. Stored origen_* components are
 * added when they do not contradict the description.
 */
export function originFromRow(row: {
  description?: string | null;
  raw_data?: Record<string, unknown> | null;
}): ActOriginIdentity {
  const rd = (row.raw_data ?? {}) as Record<string, unknown>;
  const fromDesc = extractActOrigin({ description: row.description });
  const storedSol = clean(rd.origen_solicitud);
  const storedRad = clean(rd.origen_radicada_en);
  return make({
    indice: clean(rd.origen_indice) ?? clean(rd.indice),
    solicitud: fromDesc.solicitud ?? storedSol,
    radicada_en: fromDesc.radicada_en ?? storedRad,
  });
}

export type OriginRelation = "equivalent" | "conflict" | "indeterminate";

/**
 * equivalent    — at least one shared component is equal and none differs.
 * conflict      — at least one shared component differs.
 * indeterminate — one side has no origin, or no component type is shared.
 */
export function compareOrigins(a: ActOriginIdentity, b: ActOriginIdentity): OriginRelation {
  let same = 0;
  let diff = 0;
  for (const k of ["indice", "solicitud", "radicada_en"] as const) {
    if (a[k] && b[k]) {
      if (a[k] === b[k]) same++;
      else diff++;
    }
  }
  if (diff > 0) return "conflict";
  if (same > 0) return "equivalent";
  return "indeterminate";
}

/** Backward-compatible helper. */
export function originsConflict(a: ActOriginIdentity, b: ActOriginIdentity): boolean {
  return compareOrigins(a, b) === "conflict";
}

export function mergeOrigins(a: ActOriginIdentity, b: ActOriginIdentity): ActOriginIdentity {
  return make({
    indice: a.indice ?? b.indice,
    solicitud: a.solicitud ?? b.solicitud,
    radicada_en: a.radicada_en ?? b.radicada_en,
  });
}

function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Versioned fingerprint minted only when inserting a new origin over a taken v1. */
export function originVersionedFingerprint(v1: string, origin: ActOriginIdentity): string {
  if (!origin.key) return v1;
  return `${v1}_o${hash32(origin.key)}`;
}

// ─────────────── Identity resolution ───────────────

export interface CandidateRow {
  id: string;
  hash_fingerprint: string | null;
  semantic_key?: string | null;
  description: string | null;
  raw_data: Record<string, unknown> | null;
  documentos?: unknown;
  documentos_observados_en?: string | null;
}

export type IdentityDecision =
  | { kind: "match"; row: CandidateRow; relation: OriginRelation; via: "fingerprint" | "semantic" }
  | { kind: "insert"; fingerprint: string; reason: "new" | "origin_conflict" };

/**
 * Decide whether `incoming` is an existing row or a new act. Candidates are the
 * rows whose fingerprint is v1 or v1_o*, plus rows sharing the semantic key.
 */
export function resolveActIdentity(input: {
  v1: string;
  semanticKey: string | null;
  incoming: ActOriginIdentity;
  /** Exact source text provides repeatability when origin components are absent. */
  evidence?: string | null;
  rows: CandidateRow[];
}): IdentityDecision {
  const { v1, semanticKey, incoming } = input;
  const byFp = input.rows.filter(
    (r) => r.hash_fingerprint === v1 || (r.hash_fingerprint ?? "").startsWith(`${v1}_o`),
  );
  const bySem = semanticKey
    ? input.rows.filter((r) => r.semantic_key === semanticKey && !byFp.includes(r))
    : [];
  const rank = (r: CandidateRow) => (r.hash_fingerprint === v1 ? 0 : 1);
  const fpSorted = [...byFp].sort((a, b) => rank(a) - rank(b));

  for (const [list, via] of [[fpSorted, "fingerprint"], [bySem, "semantic"]] as const) {
    const eq = list.find((r) => compareOrigins(originFromRow(r), incoming) === "equivalent");
    if (eq) return { kind: "match", row: eq, relation: "equivalent", via };
  }
  for (const [list, via] of [[fpSorted, "fingerprint"], [bySem, "semantic"]] as const) {
    const ind = list.find((r) => {
      const stored = originFromRow(r);
      return !stored.key && !incoming.key &&
        (input.evidence === undefined || clean(r.description) === clean(input.evidence));
    });
    if (ind) return { kind: "match", row: ind, relation: "indeterminate", via };
  }
  const v1Taken = input.rows.some((r) => r.hash_fingerprint === v1);
  const conflicted = byFp.length + bySem.length > 0;
  return {
    kind: "insert",
    fingerprint: v1Taken
      ? incoming.key ? originVersionedFingerprint(v1, incoming) : `${v1}_o${hash32(`unconfirmed:${input.evidence ?? ''}`)}`
      : v1,
    reason: conflicted ? "origin_conflict" : "new",
  };
}

// ─────────────── Attachment inventory per act ───────────────

/**
 * desconocido      — no evidence of any document query (absence of a link
 *                    proves nothing).
 * sin_anexos       — the provider explicitly reported zero.
 * enlaces_sin_verificar — descriptors with URLs exist; bytes not verified.
 * restringido / sesion_requerida / error — ONLY from a recorded attempt.
 * disponible / parcial — ONLY after byte verification (read side).
 */
export type AnexosEstado =
  | "desconocido"
  | "sin_anexos"
  | "enlaces_sin_verificar"
  | "restringido"
  | "sesion_requerida"
  | "error"
  | "disponible"
  | "parcial";

export interface DocumentQueryAttempt {
  status: "restricted" | "session_required" | "error" | "ok";
  at: string;
  detail?: string | null;
}

export interface AnexosInventario {
  anunciados: number | null;
  enlaces_registrados: number;
  estado: AnexosEstado;
  causa: string;
  fuente_conteo: "campo_anexos" | "texto_actuacion" | "descriptores" | null;
  intento: DocumentQueryAttempt | null;
}

function explicitCount(v: unknown): number | null {
  if (typeof v !== "number" && !(typeof v === "string" && /^\d+$/.test(v.trim()))) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function buildAnexosInventario(input: {
  anexos?: unknown;
  anotacion?: unknown;
  documentos?: Array<{ [key: string]: unknown; url?: string | null; gcs_url?: string | null }> | null;
  attempt?: DocumentQueryAttempt | null;
}): AnexosInventario {
  const text = clean(input.anotacion) ?? "";
  let anunciados = explicitCount(input.anexos);
  let fuente: AnexosInventario["fuente_conteo"] = anunciados !== null ? "campo_anexos" : null;
  if (anunciados === null) {
    const m = text.match(ANEXOS_RE) ?? text.match(ARCHIVOS_RE);
    if (m) {
      anunciados = Number(m[1]);
      fuente = "texto_actuacion";
    }
  }
  const docs = Array.isArray(input.documentos) ? input.documentos : null;
  const links = (docs ?? []).filter((d) => !!(d?.gcs_url || d?.url)).length;
  // Visible descriptors do not prove how many annexes the source announced.
  const attempt = input.attempt ?? null;

  let estado: AnexosEstado;
  let causa: string;
  if (attempt?.status === "restricted") {
    estado = "restringido";
    causa = `Consulta registrada el ${attempt.at}: el proveedor indica reserva.${attempt.detail ? " " + attempt.detail : ""}`;
  } else if (attempt?.status === "session_required") {
    estado = "sesion_requerida";
    causa = `Consulta registrada el ${attempt.at}: el proveedor exige sesión.${attempt.detail ? " " + attempt.detail : ""}`;
  } else if (attempt?.status === "error") {
    estado = "error";
    causa = `Consulta registrada el ${attempt.at} falló: ${attempt.detail ?? "sin detalle"}.`;
  } else if (links > 0) {
    estado = "enlaces_sin_verificar";
    causa = anunciados !== null
      ? `${links} de ${anunciados} anexo(s) con enlace registrado; contenido no verificado.`
      : `${links} enlace(s) registrado(s); contenido no verificado.`;
  } else if (anunciados === 0) {
    estado = "sin_anexos";
    causa = fuente === "campo_anexos"
      ? "El proveedor informa cero anexos."
      : "El texto de la actuación informa cero anexos.";
  } else {
    estado = "desconocido";
    causa = anunciados
      ? `La actuación anuncia ${anunciados} anexo(s); no hay registro de consulta documental ni enlaces.`
      : "Sin evidencia de consulta documental para esta actuación.";
  }
  return { anunciados, enlaces_registrados: links, estado, causa, fuente_conteo: fuente, intento: attempt };
}

// ─────────────── Enrichment (independent of anotación length) ───────────────

export interface IncomingAct {
  actuacion: string;
  anotacion: string | null;
  anexos: unknown;
  indice: unknown;
  documentos: Array<{ [key: string]: unknown; url?: string | null; gcs_url?: string | null }> | null;
}

export interface EnrichmentPlan {
  raw_data: Record<string, unknown>;
  event_summary?: string;
  healed_contamination: boolean;
  anotacion_grew: boolean;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Patch for a matched row. Origin components and inventory are refreshed on
 * every match; the anotación changes only when the origins are equivalent (or
 * the stored row carries no origin at all) and either:
 *  - the stored anotación belongs to a DIFFERENT origin than the row's own
 *    protected description (contamination) and the incoming one is the row's
 *    own → restored, previous value kept for audit; or
 *  - the incoming anotación is longer (legacy truncation backfill).
 */
/**
 * Historical contamination repair is OFF by default. It runs only when the
 * caller passes an explicit scope naming the provider and the approved act
 * ids (with a prior backup, per the repair plan). Normal sync never repairs.
 */
export interface HistoricalRepairScope {
  provider: "samai";
  approvedActIds: ReadonlySet<string>;
}

export function planEnrichment(
  row: CandidateRow,
  incoming: IncomingAct,
  relation: OriginRelation,
  now: string = new Date().toISOString(),
  opts: { provider?: string | null; repair?: HistoricalRepairScope | null } = {},
): EnrichmentPlan | null {
  const repairAllowed = !!opts.repair &&
    (opts.provider ?? "").toLowerCase() === opts.repair.provider &&
    opts.repair.approvedActIds.has(row.id);
  const rd = { ...(row.raw_data ?? {}) } as Record<string, unknown>;
  const rowOrigin = originFromRow(row);
  const inOrigin = extractActOrigin({ indice: incoming.indice, anotacion: incoming.anotacion });
  // An index-only entry cannot enrich a known solicitud without a shared
  // non-conflicting component. This includes attachments and scalar metadata.
  if (relation !== 'equivalent' && (rowOrigin.key || inOrigin.key)) return null;
  const next: Record<string, unknown> = mergeAnexosObservation(rd, (incoming as IncomingAct & { anexos_observacion?: unknown }).anexos_observacion);

  if (relation === "equivalent" || !rowOrigin.key) {
    const merged = mergeOrigins(rowOrigin, inOrigin);
    next.origen_indice = merged.indice;
    next.origen_solicitud = merged.solicitud;
    next.origen_radicada_en = merged.radicada_en;
    next.origen_clave = merged.key;
  }

  const prevInv = (rd.anexos_inventario ?? null) as AnexosInventario | null;
  const documentos = mergeActDocumentos(row.documentos ?? rd.documentos, incoming.documentos);
  if (documentos !== null) next.documentos = documentos;
  next.anexos_inventario = buildAnexosInventario({
    anexos: incoming.anexos ?? prevInv?.anunciados,
    anotacion: incoming.anotacion,
    documentos,
    attempt: prevInv?.intento ?? null,
  });

  let healed = false;
  let grew = false;
  let eventSummary: string | undefined;
  const newAnot = (incoming.anotacion ?? "").trim();
  const oldAnot = String(rd.anotacion ?? "").trim();
  const textAllowed = relation === "equivalent" || (!rowOrigin.key && relation === "indeterminate");
  if (textAllowed && newAnot) {
    const storedAnotOrigin = extractActOrigin({ anotacion: oldAnot });
    const contaminated = rowOrigin.key !== null &&
      compareOrigins(storedAnotOrigin, rowOrigin) === "conflict" &&
      compareOrigins(inOrigin, rowOrigin) === "equivalent";
    if (contaminated && !repairAllowed) {
      // Contaminated history is left untouched (no text change, no novedad)
      // until an approved, backed-up repair names this row explicitly.
    } else if (contaminated) {
      next.anotacion = newAnot;
      next.anotacion_reparada = { en: now, anterior: oldAnot, motivo: "anotacion_de_otro_origen" };
      healed = true;
    } else if (
      newAnot.length > oldAnot.length ||
      (oldAnot.endsWith("…") && newAnot.length >= oldAnot.length - 1)
    ) {
      next.anotacion = newAnot;
      grew = true;
    }
    if (healed || grew) {
      eventSummary = `${incoming.actuacion}${newAnot ? " - " + newAnot : ""}`.slice(0, 500);
    }
  }

  if (same(next, rd) && !eventSummary) return null;
  return { raw_data: next, event_summary: eventSummary, healed_contamination: healed, anotacion_grew: grew };
}
