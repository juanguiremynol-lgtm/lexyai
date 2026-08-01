/**
 * Normalized global search — client-side mirror of the SQL function
 * `public.search_work_items_normalized`.
 *
 * The SQL function is the runtime implementation (it can use trigram indexes);
 * this module holds the SAME rules in TypeScript so they are testable and so
 * the UI can label WHY a row matched. Any change here must be mirrored in the
 * migration and vice versa.
 *
 * Radicado identity follows the iteration 4.2 model: BASE(21) + INSTANCE(2).
 */

export interface SearchableWorkItem {
  radicado?: string | null;
  title?: string | null;
  demandantes?: string | null;
  demandados?: string | null;
  authority_name?: string | null;
  authority_city?: string | null;
  workflow_type?: string | null;
  stage?: string | null;
  client_name?: string | null;
  client_id_number?: string | null;
  /** Despacho e-mail addresses (authority_email, resolved_email, directory). */
  despacho_emails?: (string | null | undefined)[];
  /** Subjects/senders of CONFIRMED linked messages. */
  linked_emails?: (string | null | undefined)[];
}

export type MatchedField =
  | "radicado"
  | "radicado parcial"
  | "titulo"
  | "demandante"
  | "demandado"
  | "despacho"
  | "ciudad"
  | "tipo"
  | "etapa"
  | "cliente"
  | "correo del despacho"
  | "correo vinculado";

export const MATCHED_FIELD_LABELS: Record<string, string> = {
  radicado: "coincide: radicado",
  "radicado parcial": "coincide: radicado parcial",
  titulo: "coincide: título",
  demandante: "coincide: demandante",
  demandado: "coincide: demandado",
  despacho: "coincide: despacho",
  ciudad: "coincide: ciudad",
  tipo: "coincide: tipo de proceso",
  etapa: "coincide: etapa",
  cliente: "coincide: cliente",
  "correo del despacho": "coincide: correo del despacho",
  "correo vinculado": "coincide: correo vinculado",
};

/** Minimum digit run treated as a (partial) radicado signal. */
export const MIN_PARTIAL_DIGITS = 4;

/** Strip every non-digit — the single normalization used on both sides. */
export function digitsOf(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Accent- and case-insensitive folding (mirror of SQL f_unaccent(lower(x))). */
export function fold(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** BASE(21) of any radicado form; '' when there are fewer than 21 digits. */
export function radicadoBase(value: string | null | undefined): string {
  const d = digitsOf(value);
  return d.length >= 21 ? d.slice(0, 21) : "";
}

export interface RadicadoQueryVariants {
  /** All digits of the query, in order. */
  digits: string;
  /** 23-digit canonical form when derivable. */
  canonical23: string | null;
  /** 21-digit base when derivable (including the 22-digit missing-zero case). */
  base21: string | null;
  /** True when the query is only a fragment (4..20 digits). */
  partial: boolean;
}

/**
 * Decompose a query into radicado variants. Handles: 23 digits, hyphenated,
 * space-separated, 21-digit base, 22-digit missing-leading-zero and
 * base+instance forms.
 */
export function radicadoQueryVariants(query: string): RadicadoQueryVariants {
  const digits = digitsOf(query);
  if (digits.length >= 23) {
    const d23 = digits.slice(0, 23);
    return { digits, canonical23: d23, base21: d23.slice(0, 21), partial: false };
  }
  if (digits.length === 22) {
    // Missing leading zero: '5001…' → '05001…'
    const padded = `0${digits}`;
    return { digits, canonical23: padded, base21: padded.slice(0, 21), partial: false };
  }
  if (digits.length === 21) {
    return { digits, canonical23: `${digits}00`, base21: digits, partial: false };
  }
  return {
    digits,
    canonical23: null,
    base21: null,
    partial: digits.length >= MIN_PARTIAL_DIGITS,
  };
}

/** Whitespace tokenization; the AND unit of a multi-token query. */
export function tokenize(query: string): string[] {
  return String(query ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function textHit(haystack: string | null | undefined, token: string): boolean {
  const t = fold(token);
  return t.length > 0 && fold(haystack).includes(t);
}

function fieldsMatchedByToken(item: SearchableWorkItem, token: string): MatchedField[] {
  const out: MatchedField[] = [];
  const tokenDigits = digitsOf(token);
  const radDigits = digitsOf(item.radicado);

  if (tokenDigits.length >= MIN_PARTIAL_DIGITS && radDigits) {
    const v = radicadoQueryVariants(token);
    const exact =
      radDigits === tokenDigits ||
      (v.base21 !== null && radDigits.slice(0, 21) === v.base21);
    if (exact) out.push("radicado");
    else if (radDigits.includes(tokenDigits)) out.push("radicado parcial");
  }
  if (textHit(item.title, token)) out.push("titulo");
  if (textHit(item.demandantes, token)) out.push("demandante");
  if (textHit(item.demandados, token)) out.push("demandado");
  if (textHit(item.authority_name, token)) out.push("despacho");
  if (textHit(item.authority_city, token)) out.push("ciudad");
  if (textHit(item.workflow_type, token)) out.push("tipo");
  if (textHit(item.stage, token)) out.push("etapa");
  if (
    textHit(item.client_name, token) ||
    (tokenDigits.length >= MIN_PARTIAL_DIGITS &&
      digitsOf(item.client_id_number).includes(tokenDigits))
  ) {
    out.push("cliente");
  }
  if ((item.despacho_emails ?? []).some((e) => textHit(e, token))) {
    out.push("correo del despacho");
  }
  if ((item.linked_emails ?? []).some((e) => textHit(e, token))) {
    out.push("correo vinculado");
  }
  return out;
}

/**
 * A whole query whose digits already form a radicado (>=21 digits) is ONE
 * radicado, even if the user typed it space-separated ("05001 3103 021 …").
 * Tokenizing it would produce 2-digit fragments that match nothing.
 */
function wholeQueryRadicado(item: SearchableWorkItem, query: string): MatchedField | null {
  const v = radicadoQueryVariants(query);
  if (!v.base21) return null;
  const radDigits = digitsOf(item.radicado);
  if (!radDigits) return null;
  return radDigits.slice(0, 21) === v.base21 ? "radicado" : null;
}

/** Distinct matched fields across every token of the query. */
export function matchedFields(item: SearchableWorkItem, query: string): MatchedField[] {
  const whole = wholeQueryRadicado(item, query);
  if (whole) return [whole];
  const seen = new Set<MatchedField>();
  for (const token of tokenize(query)) {
    for (const f of fieldsMatchedByToken(item, token)) seen.add(f);
  }
  // "radicado" wins over "radicado parcial" for the same query.
  if (seen.has("radicado")) seen.delete("radicado parcial");
  return [...seen];
}

/** AND across tokens: every token must hit at least one field. */
export function matchesQuery(item: SearchableWorkItem, query: string): boolean {
  if (wholeQueryRadicado(item, query)) return true;
  const tokens = tokenize(query);
  if (tokens.length === 0) return false;
  return tokens.every((t) => fieldsMatchedByToken(item, t).length > 0);
}

/**
 * Rank: 1 exact radicado, 2 base/missing-zero, 3 partial radicado,
 * 4 title/party, 5 everything else. Lower is better.
 */
export function rankOf(item: SearchableWorkItem, query: string): number {
  const radDigits = digitsOf(item.radicado);
  const v = radicadoQueryVariants(query);
  if (v.digits && radDigits) {
    if (radDigits === v.digits) return 1;
    if (v.base21 && radDigits.slice(0, 21) === v.base21) return 2;
    if (v.digits.length >= MIN_PARTIAL_DIGITS && radDigits.includes(v.digits)) return 3;
  }
  const fields = matchedFields(item, query);
  if (fields.some((f) => f === "titulo" || f === "demandante" || f === "demandado")) return 4;
  return 5;
}

/** Pure, in-memory search used by tests and by client-side pickers. */
export function searchWorkItems<T extends SearchableWorkItem>(items: T[], query: string): T[] {
  return items
    .filter((i) => matchesQuery(i, query))
    .sort((a, b) => rankOf(a, query) - rankOf(b, query));
}

/** Human-readable radicado (05-001-31-03-021-2025-00211-00 style grouping). */
export function formatRadicadoPretty(value: string | null | undefined): string {
  const d = digitsOf(value);
  if (d.length !== 23) return String(value ?? "");
  return [
    d.slice(0, 5),
    d.slice(5, 7),
    d.slice(7, 9),
    d.slice(9, 12),
    d.slice(12, 16),
    d.slice(16, 21),
    d.slice(21, 23),
  ].join("-");
}