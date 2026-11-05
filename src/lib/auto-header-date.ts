/**
 * auto-header-date.ts — MIRROR of supabase/functions/_shared/autoHeaderDate.ts.
 * Keep both files byte-identical in logic; the canonical file documents the
 * contract. Used by the MCP list_publicaciones tool on prefixes returned by
 * public.publicacion_auto_text_prefix (SECURITY INVOKER, RLS-scoped).
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

  const wordsRe = new RegExp(
    `[a-z]+\\s*\\((\\d{1,2})\\)\\s+de\\s+(${MONTH_RE})\\s+de\\s+(?:[a-z]+\\s+)*?\\(?\\b(\\d{4})\\b\\)?`,
    "g",
  );
  for (const m of src.matchAll(wordsRe)) add(+m[3], MONTHS[m[2]], +m[1]);

  const longRe = new RegExp(
    `(?<!\\d)(\\d{1,2})\\s+de\\s+(${MONTH_RE})\\s+de\\s+(\\d{4})(?!\\d)`,
    "g",
  );
  for (const m of src.matchAll(longRe)) add(+m[3], MONTHS[m[2]], +m[1]);

  const shortRe = /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/g;
  for (const m of src.matchAll(shortRe)) add(+m[3], +m[2], +m[1]);

  return [...found];
}

/** The single unambiguous header date, or null when none or ambiguous. */
export function extractAutoHeaderDate(texto: unknown): string | null {
  const candidates = autoHeaderDateCandidates(texto);
  return candidates.length === 1 ? candidates[0] : null;
}
