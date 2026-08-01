/**
 * Lexy grounding contract (iteration 8).
 *
 * The daily digest may ONLY talk about facts that exist as live rows in the
 * last 24h window (acts, publicaciones/estados, non-digest alerts, deadline
 * transitions) plus currently-open deadlines within the next 15 days.
 *
 * Every concrete claim carries its source row id internally. If the 24h window
 * is empty, the digest must say exactly that and may only list forward-looking
 * items. Nothing months old is ever resurfaced as current news.
 */

export const GROUNDING_WINDOW_HOURS = 24;
export const FORWARD_DEADLINE_DAYS = 15;

export const EMPTY_WINDOW_STATEMENT =
  "En las últimas 24 horas no se registran nuevos estados ni actuaciones en tus asuntos.";

export interface GroundedFact {
  /** Source row id — internal traceability, never rendered to the user. */
  source_id: string;
  source_table:
    | "work_item_acts"
    | "work_item_publicaciones"
    | "alert_instances"
    | "work_item_deadlines";
  radicado: string | null;
  work_item_title: string | null;
  text: string;
  date: string | null;
}

export interface GroundedFacts {
  /** Rows created within the last 24h. */
  window: GroundedFact[];
  /** Currently-open deadlines within FORWARD_DEADLINE_DAYS (forward-looking). */
  forward: GroundedFact[];
}

export function isWindowEmpty(facts: GroundedFacts): boolean {
  return facts.window.length === 0;
}

/** Radicados + titles that the digest is allowed to mention. */
export function allowedSubjects(facts: GroundedFacts): string[] {
  const all = [...facts.window, ...facts.forward];
  const subjects = new Set<string>();
  for (const f of all) {
    if (f.radicado) subjects.add(f.radicado.replace(/\D/g, ""));
    if (f.work_item_title) subjects.add(normalizeText(f.work_item_title));
  }
  return [...subjects].filter(Boolean);
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Renders the grounding block handed to the model (source ids included). */
export function buildGroundingBlock(facts: GroundedFacts): string {
  const fmt = (f: GroundedFact) =>
    `- [${f.source_table}#${f.source_id}] ${f.radicado ?? "sin radicado"} | ${f.date ?? "sin fecha"} | ${f.text}`;

  return [
    `### Hechos de las últimas ${GROUNDING_WINDOW_HOURS} horas (${facts.window.length}):`,
    facts.window.length ? facts.window.map(fmt).join("\n") : "NINGUNO",
    "",
    `### Términos abiertos en los próximos ${FORWARD_DEADLINE_DAYS} días (${facts.forward.length}):`,
    facts.forward.length ? facts.forward.map(fmt).join("\n") : "NINGUNO",
  ].join("\n");
}

export interface DigestDraft {
  greeting: string;
  summary_body: string;
  highlights: Array<{ icon: string; text: string }>;
  closing: string;
}

/**
 * Post-generation guard: strips any highlight that mentions a matter/radicado
 * with no live source row, and forces the explicit statement when the 24h
 * window is empty.
 */
export function sanitizeDigest(draft: DigestDraft, facts: GroundedFacts): DigestDraft {
  const subjects = allowedSubjects(facts);
  const empty = isWindowEmpty(facts);

  const highlights = (draft.highlights || []).filter((h) => {
    const text = normalizeText(h.text || "");
    if (!text) return false;
    const radicados = (h.text.match(/\d[\d\s.-]{9,}\d/g) || []).map((r) => r.replace(/\D/g, ""));
    // A radicado mentioned must exist in the grounded facts.
    if (radicados.length > 0) {
      return radicados.every((r) => subjects.some((s) => s.includes(r) || r.includes(s)));
    }
    // No radicado: with an empty window only forward-looking items survive.
    if (empty) {
      return facts.forward.length > 0 && /término|termino|audiencia|vence|próxim|proxim/i.test(h.text);
    }
    return true;
  });

  if (empty && facts.forward.length === 0) {
    return {
      greeting: draft.greeting,
      summary_body: EMPTY_WINDOW_STATEMENT,
      highlights: [],
      closing: draft.closing,
    };
  }

  if (empty) {
    return {
      greeting: draft.greeting,
      summary_body: `${EMPTY_WINDOW_STATEMENT} A continuación, lo que viene.`,
      highlights,
      closing: draft.closing,
    };
  }

  return { ...draft, highlights };
}
