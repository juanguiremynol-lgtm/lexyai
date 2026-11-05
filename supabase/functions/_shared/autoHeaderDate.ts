/**
 * autoHeaderDate.ts — candidate date from the HEADER of an auto's text.
 *
 * Read-only quality signal (consumed by MCP list_publicaciones): the
 * structured `fecha_providencia` comes from the source payload and is never
 * rewritten; this extractor looks ONLY at a short header prefix of
 * `texto_auto` for an UNAMBIGUOUS explicit date. It never scans the body
 * (cited dates live there), never invents a date and returns null
 * ("desconocido") when the header holds zero or two+ distinct candidates.
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

/** All distinct valid candidate dates in the header prefix, first-seen order. */
export function autoHeaderDateCandidates(texto: unknown): string[] {
  if (typeof texto !== "string" || !texto.trim()) return [];
  const src = texto.slice(0, HEADER_SCAN_CHARS)
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const found = new Set<string>();
  const add = (y: number, m: number, d: number) => {
    if (isRealDate(y, m, d)) found.add(iso(y, m, d));
  };

  // Word day with digits in parentheses + month name + numeric year, optionally
  // preceded by year words: "veintidos (22) de abril de dos mil veintiseis (2026)".
  const wordsRe = new RegExp(
    `[a-z]+\\s*\\((\\d{1,2})\\)\\s+de\\s+(${MONTH_RE})\\s+de\\s+(?:[a-z]+\\s+)*?\\(?\\b(\\d{4})\\b\\)?`,
    "g",
  );
  for (const m of src.matchAll(wordsRe)) add(+m[3], MONTHS[m[2]], +m[1]);

  // Numeric long: "22 de abril de 2026".
  const longRe = new RegExp(
    `(?<!\\d)(\\d{1,2})\\s+de\\s+(${MONTH_RE})\\s+de\\s+(\\d{4})(?!\\d)`,
    "g",
  );
  for (const m of src.matchAll(longRe)) add(+m[3], MONTHS[m[2]], +m[1]);

  // Numeric short: "22/04/2026" or "22-04-2026" (Colombian dd/mm/yyyy).
  const shortRe = /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/g;
  for (const m of src.matchAll(shortRe)) add(+m[3], +m[2], +m[1]);

  return [...found];
}

/** The single unambiguous header date, or null when none or ambiguous. */
export function extractAutoHeaderDate(texto: unknown): string | null {
  const candidates = autoHeaderDateCandidates(texto);
  return candidates.length === 1 ? candidates[0] : null;
}
