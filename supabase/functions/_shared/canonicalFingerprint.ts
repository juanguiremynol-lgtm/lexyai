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

/** Canonical, source-agnostic fingerprint for a work_item_acts row. */
export function canonicalActFingerprint(input: {
  work_item_id?: string | null;
  act_date?: string | null;
  description?: string | null;
  actuacion?: string | null;
}): string {
  const wi = (input.work_item_id || "noscope").slice(0, 8);
  const date = (input.act_date || "unknown").trim();
  const title = normalizeTitle(input.actuacion ?? input.description ?? "");
  return `wi_${wi}_${simpleHash(`act|${wi}|${date}|${title}`)}`;
}

/** Canonical, source-agnostic fingerprint for a work_item_publicaciones row. */
export function canonicalPubFingerprint(input: {
  work_item_id?: string | null;
  pub_date?: string | null;
  tipo_publicacion?: string | null;
  title?: string | null;
  description?: string | null;
}): string {
  const wi = (input.work_item_id || "noscope").slice(0, 8);
  const date = (input.pub_date || "unknown").trim();
  const tipo = normalizeTitle(input.tipo_publicacion || "");
  const title = normalizeTitle(input.title ?? input.description ?? "");
  return `pub_${wi}_${simpleHash(`pub|${wi}|${date}|${tipo}|${title}`)}`;
}