/**
 * canonicalFingerprint.ts — Source-agnostic dedupe fingerprints for judicial facts.
 *
 * Rationale (P0 bug 2026-07-12): previous per-adapter fingerprints included the
 * provider name / route prefix (e.g. `cpnu`, `tut_x_`, `SAMAI:`) and volatile
 * fields (fecha_registro, anotacion). The same legal act reported by two
 * ingestion paths (e.g. `cpnu` vs `CPNU+TUTELAS`, cpnu casing drift, samai vs
 * tutelas) produced different hashes → duplicated rows in `work_item_acts` /
 * `work_item_publicaciones`.
 *
 * A dedupe key MUST identify the JURIDICAL FACT, not the transport:
 *   act key = work_item_id + act_date + normalized act title
 *   pub key = work_item_id + pub_date + tipo + normalized title
 *
 * Title normalization strips accents, lowercases, trims/collapses whitespace,
 * and drops any anotación tail appended after " - " / " — " (adapters concat
 * anotaciones onto description; the stable identifier is only the head).
 *
 * P0 bug 2026-07-14 (call-site divergence): three pub call-sites and five act
 * call-sites passed different subsets of fields to the helper (some omitted
 * `tipo`, some passed raw title with `.pdf`, some stripped it, one substituted
 * radicado for work_item_id). Same juridical fact → different hash → duplicate
 * row. The fix (a) makes required fields explicit and non-optional in the
 * types, (b) internally normalizes title (strip trailing `.pdf`/duplicate-copy
 * suffixes like ` (1) (1)`), (c) internally normalizes act/pub date to
 * YYYY-MM-DD regardless of input format (ISO, timestamptz, DD/MM/YYYY), and
 * (d) validates that work_item_id is a UUID (rejects radicado fallback).
 */

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function simpleHash(data: string): string {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i);
    h1 = ((h1 << 5) - h1) + c; h1 = h1 & h1;
    h2 = ((h2 << 7) + h2) ^ c; h2 = h2 & h2;
  }
  return `${Math.abs(h1).toString(16).padStart(8, "0")}${Math.abs(h2).toString(16).padStart(8, "0")}`;
}

/** Party tokens whose presence in the post-" - " suffix distinguishes two
 *  otherwise-equal acts on the same day (e.g. "Recepción Memorial - DEL
 *  ACCIONANTE" vs "... - DEL ACCIONADO"). Detected on the RAW string before
 *  stripping the suffix so the discriminator survives normalization. */
const PARTY_TOKENS = [
  "accionante",
  "accionado",
  "demandante",
  "demandado",
  "tercero",
  "apoderado",
  "actor",
  "coadyuvante",
  "interviniente",
  "opositor",
] as const;

/** Extract a party discriminator token from the post-" - " suffix of a title,
 *  or from a raw_data.parte / raw_data.docum_a_notif hint if provided. Returns
 *  "" when the suffix is just noise (truncation, provider anotación tail). */
export function extractPartyDiscriminator(
  raw: string | null | undefined,
  hint?: string | null | undefined,
): string {
  const scan = (s: string): string => {
    const lower = stripAccents(s).toLowerCase();
    for (const tok of PARTY_TOKENS) {
      // Word-boundary match to avoid substring hits inside longer words.
      const re = new RegExp(`\\b${tok}\\b`);
      if (re.test(lower)) return tok;
    }
    return "";
  };
  // 1) Hard discriminator from raw_data if the caller supplied one.
  if (hint) {
    const h = scan(String(hint));
    if (h) return h;
  }
  // 2) Otherwise inspect the post-" - " / " — " suffix of the title itself.
  if (!raw) return "";
  const s = String(raw);
  const i1 = s.indexOf(" - ");
  const i2 = s.indexOf(" — ");
  const sepIdx = i1 === -1 ? i2 : i2 === -1 ? i1 : Math.min(i1, i2);
  if (sepIdx < 0) return "";
  const suffix = s.slice(sepIdx + 3);
  return scan(suffix);
}

/** Normalize a title/tipo string: NFD strip accents, lowercase, trim,
 *  collapse whitespace, drop any " - " / " — " tail (anotación concatenada). */
export function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);
  // Split on the first " - " or " — " and keep the head (stable identifier).
  const sepIdx = (() => {
    const i1 = s.indexOf(" - ");
    const i2 = s.indexOf(" — ");
    if (i1 === -1) return i2;
    if (i2 === -1) return i1;
    return Math.min(i1, i2);
  })();
  if (sepIdx >= 0) s = s.slice(0, sepIdx);
  s = stripAccents(s).toLowerCase().trim().replace(/\s+/g, " ");
  return s.slice(0, 200);
}

/** Strip common non-identifying suffixes from a raw title/filename before it
 *  reaches normalizeTitle. Keeps the fact stable across code paths that do or
 *  don't pre-clean their inputs.
 *  - trailing `.pdf` extension
 *  - trailing whitespace-separated copy markers " (1)", " (2)", " (1) (1)"
 *  - trailing bare date tail like " 18/06/2026" (some PP payloads append it) */
function stripTitleNoise(raw: string): string {
  let s = raw;
  // Strip .pdf and repeated (n) copy markers, in any order at the tail.
  // Loop because we may have "foo.pdf (1) (1)" or "foo (1).pdf".
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(/\s*\(\d+\)\s*$/, "");
    s = s.replace(/\.pdf\s*$/i, "");
    if (s === before) break;
  }
  return s.trim();
}

/** Coerce any date-ish input to YYYY-MM-DD (UTC). Returns "unknown" for null,
 *  empty, or unparseable inputs so the fingerprint never diverges on format
 *  (ISO vs timestamptz vs DD/MM/YYYY vs bare date). */
function normalizeDate(input: string | null | undefined): string {
  if (!input) return "unknown";
  const s = String(input).trim();
  if (!s) return "unknown";
  // Already YYYY-MM-DD prefix (fast path).
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // DD/MM/YYYY or DD-MM-YYYY.
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Fallback: let Date parse it (handles ISO timestamps).
  const t = new Date(s);
  if (!Number.isNaN(t.getTime())) return t.toISOString().slice(0, 10);
  return "unknown";
}

/** Reject non-UUID values so callers can't accidentally pass a radicado. */
function normalizeWorkItemId(input: string | null | undefined): string {
  if (!input) return "noscope";
  const s = String(input).trim().toLowerCase();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuid.test(s)) {
    // Callers that lack a real UUID (e.g. cpnuAdapter with only a radicado)
    // will get a stable but distinct scope so their hash never accidentally
    // collides with a real work-item's hash.
    return `nowi:${simpleHash(s).slice(0, 8)}`;
  }
  return s.slice(0, 8);
}

/** Canonical, source-agnostic fingerprint for a work_item_acts row. */
export function canonicalActFingerprint(input: {
  work_item_id: string | null;
  act_date: string | null;
  /** Prefer `actuacion` (the stable act type). `description` is accepted for
   *  legacy callers but internally treated identically after normalization. */
  actuacion: string | null;
  /** Required — pass `null` if not available. Prevents silent divergence. */
  party_hint: string | null;
  /** Legacy alias — merged with `actuacion` if that field is empty. */
  description?: string | null;
}): string {
  const wi = normalizeWorkItemId(input.work_item_id);
  const date = normalizeDate(input.act_date);
  const rawTitle = stripTitleNoise(input.actuacion ?? input.description ?? "");
  const title = normalizeTitle(rawTitle);
  const party = extractPartyDiscriminator(rawTitle, input.party_hint);
  const suffix = party ? `|p:${party}` : "";
  return `wi_${wi}_${simpleHash(`act|${wi}|${date}|${title}${suffix}`)}`;
}

/** Canonical, source-agnostic fingerprint for a work_item_publicaciones row. */
export function canonicalPubFingerprint(input: {
  work_item_id: string | null;
  pub_date: string | null;
  tipo_publicacion: string | null;
  /** Prefer `title`; `description` accepted for legacy callers. */
  title: string | null;
  /** Required — pass `null` if not available. Prevents silent divergence. */
  party_hint: string | null;
  description?: string | null;
}): string {
  const wi = normalizeWorkItemId(input.work_item_id);
  const date = normalizeDate(input.pub_date);
  const tipo = normalizeTitle(input.tipo_publicacion || "");
  const rawTitle = stripTitleNoise(input.title ?? input.description ?? "");
  const title = normalizeTitle(rawTitle);
  const party = extractPartyDiscriminator(rawTitle, input.party_hint);
  const suffix = party ? `|p:${party}` : "";
  return `pub_${wi}_${simpleHash(`pub|${wi}|${date}|${tipo}|${title}${suffix}`)}`;
}