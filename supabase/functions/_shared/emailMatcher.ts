/**
 * emailMatcher.ts — Inference engine that links a mailbox message to a work
 * item using ONLY metadata (subject, sender, snippet). Bodies are never
 * stored and never leave this function.
 */

export interface PortfolioItem {
  id: string;
  organization_id: string | null;
  radicado: string | null;
  authority_name: string | null;
  authority_email: string | null;
  demandantes: string | null;
  demandados: string | null;
  title: string | null;
  client_name?: string | null;
}

export interface GraphMessage {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  from?: { emailAddress?: { address?: string; name?: string } } | null;
  sender?: { emailAddress?: { address?: string } } | null;
  toRecipients?: { emailAddress?: { address?: string } }[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  hasAttachments?: boolean;
  webLink?: string | null;
  conversationId?: string | null;
  internetMessageId?: string | null;
}

export type MatchedBy = "RADICADO" | "PARTE" | "DESPACHO" | "CLIENTE" | "MANUAL";
export type EvidenceType =
  | "MEMORIAL_ENVIADO"
  | "NOTIFICACION_JUZGADO"
  | "TRASLADO"
  | "REQUERIMIENTO"
  | "OTRO";

export interface MatchResult {
  work_item_id: string;
  organization_id: string | null;
  matched_by: MatchedBy;
  matched_value: string;
  confidence: number;
}

export const JUDICIAL_DOMAINS = [
  "cendoj.ramajudicial.gov.co",
  "notificacionesrj.gov.co",
  "ramajudicial.gov.co",
];

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function norm(s: string | null | undefined): string {
  return stripAccents(String(s ?? "")).toUpperCase().replace(/\s+/g, " ").trim();
}

/** Digits-only 23-char radicado. */
export function normalizeRadicado(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * Extract every 23-digit radicado present in a text, tolerating separators:
 * 05001400303420260089800, 05001-40-03-034-2026-00898-00, with underscores,
 * spaces or dots.
 */
export function extractRadicados(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = /\d[\d\s._\-/]{20,45}\d/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length === 23) {
      found.add(digits);
    } else if (digits.length > 23) {
      // Sliding window for concatenated noise (e.g. radicado + date suffix).
      for (let i = 0; i + 23 <= digits.length; i++) found.add(digits.slice(i, i + 23));
    }
  }
  return [...found];
}

function senderAddress(msg: GraphMessage): string {
  return (
    msg.from?.emailAddress?.address ??
    msg.sender?.emailAddress?.address ??
    ""
  ).toLowerCase();
}

function isJudicialSender(address: string): boolean {
  return JUDICIAL_DOMAINS.some((d) => address.endsWith(`@${d}`) || address.endsWith(`.${d}`));
}

/** Split a party field ("A, B y C") into normalized, meaningful names. */
function partyNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return norm(raw)
    .split(/[,;/|]| Y | VS | CONTRA /)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8 && p.split(" ").length >= 2);
}

/**
 * Score a message against the portfolio. Returns every candidate above 0.5;
 * the caller decides what to persist (>=0.7 confirmed, 0.5-0.7 suggested).
 *
 * Ratified thresholds: only RADICADO (1.0) and DESPACHO (0.85) are surgical
 * enough to be CONFIRMED. CLIENTE/PARTE sit at 0.65 (SUGGESTED) because a
 * single message to a client with N matters fans out to all N.
 */
export function matchMessage(msg: GraphMessage, portfolio: PortfolioItem[]): MatchResult[] {
  const subject = norm(msg.subject);
  const preview = norm(msg.bodyPreview).slice(0, 500);
  const haystack = `${subject} ${preview}`;
  const address = senderAddress(msg);
  const radicados = new Set(extractRadicados(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`));
  const results = new Map<string, MatchResult>();

  const push = (r: MatchResult) => {
    const prev = results.get(r.work_item_id);
    if (!prev || r.confidence > prev.confidence) results.set(r.work_item_id, r);
  };

  for (const wi of portfolio) {
    const wiRad = wi.radicado ? normalizeRadicado(wi.radicado) : "";

    // 1. Radicado — deterministic, confidence 1.0
    if (wiRad.length === 23 && radicados.has(wiRad)) {
      push({
        work_item_id: wi.id,
        organization_id: wi.organization_id,
        matched_by: "RADICADO",
        matched_value: wiRad,
        confidence: 1,
      });
      continue;
    }

    // 2. Judicial sender + despacho match — 0.85
    if (address && isJudicialSender(address)) {
      const authEmail = (wi.authority_email ?? "").toLowerCase();
      const authName = norm(wi.authority_name);
      const despachoHit =
        (authEmail && authEmail === address) ||
        (authName.length >= 10 && haystack.includes(authName));
      if (despachoHit) {
        push({
          work_item_id: wi.id,
          organization_id: wi.organization_id,
          matched_by: "DESPACHO",
          matched_value: authEmail || authName,
          confidence: 0.85,
        });
        continue;
      }
    }

    // 3. Parties / client in subject or snippet — 0.65 (suggestion only)
    const names = [
      ...partyNames(wi.demandantes),
      ...partyNames(wi.demandados),
      ...partyNames(wi.client_name),
    ];
    const hit = names.find((n) => haystack.includes(n));
    if (hit) {
      push({
        work_item_id: wi.id,
        organization_id: wi.organization_id,
        matched_by: wi.client_name && norm(wi.client_name).includes(hit) ? "CLIENTE" : "PARTE",
        matched_value: hit,
        confidence: 0.65,
      });
    }
  }

  return [...results.values()];
}

const MEMORIAL_RE =
  /subsana|memorial|recurso|contestaci[oó]n|alegatos|solicitud|impugnaci[oó]n/i;
const TRASLADO_RE = /traslado/i;
const REQUERIMIENTO_RE = /requerimiento|requiere|requerido/i;

export function classifyEvidence(
  msg: GraphMessage,
  direction: "sent" | "received",
  matchedBy: MatchedBy,
): EvidenceType | null {
  const subject = msg.subject ?? "";
  const address = senderAddress(msg);

  if (
    direction === "sent" &&
    matchedBy === "RADICADO" &&
    msg.hasAttachments === true &&
    MEMORIAL_RE.test(subject)
  ) {
    return "MEMORIAL_ENVIADO";
  }
  if (direction === "received" && isJudicialSender(address)) return "NOTIFICACION_JUZGADO";
  if (TRASLADO_RE.test(subject)) return "TRASLADO";
  if (REQUERIMIENTO_RE.test(subject)) return "REQUERIMIENTO";
  return direction === "sent" ? "OTRO" : null;
}