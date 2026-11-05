/**
 * auto-header-date.ts — MIRROR of supabase/functions/_shared/autoHeaderDate.ts.
 * Keep both files byte-identical in logic; the canonical file documents the
 * contract. Used by the MCP list_publicaciones tool on prefixes returned by
 * public.publicacion_auto_text_prefix (SECURITY INVOKER, RLS-scoped).
 *
 * A date counts only in a RECOGNIZABLE, DELIMITED header segment: tribunal/
 * despacho context, before the first procedural identification field,
 * exactly one distinct valid date introduced as a dateline (place + comma).
 * A prefix with no delimiting field, citations, multiple dates or doubtful
 * linkage return null ("desconocido").
 */

const HEADER_SCAN_CHARS = 600;
const MIN_YEAR = 2000;

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTH_RE =
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";

// Tribunal/despacho context that makes the segment recognizable as a header.
const CONTEXT_RE =
  /\b(juzgado|tribunal|corte|sala|despacho|magistrad[oa]s?|juez|consejo\s+(?:de\s+estado|seccional|superior)|rama\s+judicial)\b/;

// First procedural identification field: a reliable end of the header.
const FIELD_RE =
  /\b(expediente|radicado|radicacion|auto\s*(?:no\.?|n[°º.]|numero)|demandante|demandad[oa]|accionante|accionad[oa]|recurrente|impugnante|impugnad[oa]|actor(?:a)?|apoderad[oa]|referencia|asunto|proceso)\b/;

// Dateline linkage: a place word (dots/spaces allowed, e.g. "d.c.") followed
// by a comma immediately introduces the date; citations lack it.
const DATELINE_RE = /[a-z][a-z.\s]*,\s*$/;

function maxYear(): number {
  return new Date().getUTCFullYear() + 1;
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (y < MIN_YEAR || y > maxYear() || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Distinct valid dates in the segment with their first-seen index. */
function collectDates(segment: string): { date: string; index: number }[] {
  const found = new Map<string, number>();
  const add = (y: number, m: number, d: number, index: number) => {
    if (!isRealDate(y, m, d)) return;
    const key = iso(y, m, d);
    if (!found.has(key)) found.set(key, index);
  };

  const wordsRe = new RegExp(
    `[a-z]+\\s*\\((\\d{1,2})\\)\\s+de\\s+(${MONTH_RE})\\s+de\\s+(?:[a-z]+\\s+)*?\\(?\\b(\\d{4})\\b\\)?`,
    "g",
  );
  for (const m of segment.matchAll(wordsRe)) add(+m[3], MONTHS[m[2]], +m[1], m.index);

  const longRe = new RegExp(
    `(?<!\\d)(\\d{1,2})\\s+de\\s+(${MONTH_RE})\\s+de\\s+(\\d{4})(?!\\d)`,
    "g",
  );
  for (const m of segment.matchAll(longRe)) add(+m[3], MONTHS[m[2]], +m[1], m.index);

  const shortRe = /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/g;
  for (const m of segment.matchAll(shortRe)) add(+m[3], +m[2], +m[1], m.index);

  return [...found.entries()].map(([date, index]) => ({ date, index }));
}

/**
 * Candidate dates from a RECOGNIZABLE, DELIMITED header segment only.
 * Returns the single dateline date, or an empty array when no delimiting
 * procedural field exists inside the prefix, when the segment is not
 * recognizable (no tribunal/despacho context), when it holds zero or
 * two+ distinct dates (citations/ambiguity), or when the only date is not
 * introduced as a dateline (doubtful linkage).
 */
export function autoHeaderDateCandidates(texto: unknown): string[] {
  if (typeof texto !== "string" || !texto.trim()) return [];
  const src = texto.slice(0, HEADER_SCAN_CHARS)
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const context = CONTEXT_RE.exec(src);
  if (!context) return [];
  const field = FIELD_RE.exec(src);
  if (!field) return [];
  const end = field.index;
  if (context.index >= end) return [];
  const segment = src.slice(0, end);

  const dates = collectDates(segment);
  if (dates.length !== 1) return [];
  const only = dates[0];
  const before = segment.slice(Math.max(0, only.index - 60), only.index);
  if (!DATELINE_RE.test(before)) return [];
  return [only.date];
}

/** The single unambiguous header date, or null when none or doubtful. */
export function extractAutoHeaderDate(texto: unknown): string | null {
  const candidates = autoHeaderDateCandidates(texto);
  return candidates.length === 1 ? candidates[0] : null;
}
