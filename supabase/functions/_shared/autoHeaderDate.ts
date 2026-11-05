/**
 * autoHeaderDate.ts — candidate date from the HEADER of an auto's text.
 *
 * Read-only quality signal (consumed by MCP list_publicaciones): the
 * structured `fecha_providencia` comes from the source payload and is never
 * rewritten; this extractor looks ONLY at a short header prefix of
 * `texto_auto` and accepts a date solely when it sits in a RECOGNIZABLE,
 * DELIMITED header segment:
 *   - the segment ends at the first procedural identification field
 *     (expediente, radicación, auto No., demandante, proceso, ...) — a
 *     prefix with NO delimiting field yields no segment at all
 *     ("desconocido"), so a body citation can never qualify just because
 *     context and a comma happen to precede it;
 *   - the segment contains tribunal/despacho context (juzgado, tribunal,
 *     corte, sala, despacho, magistrado, juez, consejo, rama judicial);
 *   - the segment yields exactly ONE distinct valid date, written as a
 *     dateline (a place word followed by a comma, e.g. "Bogotá, D.C., 22 de
 *     abril de 2026"). A lone citation inside a paragraph ("auto del 10 de
 *     marzo de 2026"), multiple distinct dates or any doubtful linkage
 *     return null ("desconocido").
 * It never scans the body, never invents a date and never rewrites the
 * structured source date.
 *
 * Recognized formats (after accent/case normalization):
 *   - "22 de abril de 2026"                                   (numeric long)
 *   - "22/04/2026", "22-04-2026"                              (numeric short, dd/mm/yyyy)
 *   - "VEINTIDOS (22) DE ABRIL DE DOS MIL VEINTISEIS (2026)"  (words + digits)
 *   - "veintidos (22) de abril de 2026"                       (word day + numeric year)
 * The parenthesized digits are the operative value; Spanish number words are
 * not cross-validated against them. Every candidate must be a real calendar
 * day in the plausible judicial range (same rule as plausibleCivilDate).
 *
 * Mirrored in src/lib/auto-header-date.ts — keep both files byte-identical
 * in logic; the vitest mirror test shares these cases.
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

  // Word day with digits in parentheses + month name + numeric year, optionally
  // preceded by year words: "veintidos (22) de abril de dos mil veintiseis (2026)".
  const wordsRe = new RegExp(
    `[a-z]+\\s*\\((\\d{1,2})\\)\\s+de\\s+(${MONTH_RE})\\s+de\\s+(?:[a-z]+\\s+)*?\\(?\\b(\\d{4})\\b\\)?`,
    "g",
  );
  for (const m of segment.matchAll(wordsRe)) add(+m[3], MONTHS[m[2]], +m[1], m.index);

  // Numeric long: "22 de abril de 2026".
  const longRe = new RegExp(
    `(?<!\\d)(\\d{1,2})\\s+de\\s+(${MONTH_RE})\\s+de\\s+(\\d{4})(?!\\d)`,
    "g",
  );
  for (const m of segment.matchAll(longRe)) add(+m[3], MONTHS[m[2]], +m[1], m.index);

  // Numeric short: "22/04/2026" or "22-04-2026" (Colombian dd/mm/yyyy).
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
