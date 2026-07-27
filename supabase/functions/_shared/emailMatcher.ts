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
  workflow_type?: string | null;
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

export type MatchedBy =
  | "RADICADO"
  | "RADICADO_PARCIAL"
  | "PARTE"
  | "DESPACHO"
  | "CLIENTE"
  | "MANUAL";
export type EvidenceType =
  | "MEMORIAL_ENVIADO"
  | "NOTIFICACION_JUZGADO"
  | "TRASLADO"
  | "REQUERIMIENTO"
  | "SGDE_ACCESO_EXPEDIENTE"
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
  "ugpp.gov.co",
];

/**
 * Remitentes que NUNCA deben generar un vínculo: Andromeda no puede usar sus
 * propios resúmenes como evidencia (circularidad).
 */
export const EXCLUDED_SENDERS = ["monitoreo@andromeda.legal"];

/** Remitente del Sistema de Gestión Documental Electrónica de la Rama. */
export const SGDE_SENDER = "notificacionessgde@cendoj.ramajudicial.gov.co";
const SGDE_SUBJECT_RE = /se le ha compartido informaci[oó]n de proceso judicial/i;
const SGDE_LINK_RE =
  /https:\/\/siugj-sgde\.ramajudicial\.gov\.co\/expedientes\/usuario-externo\/[A-Za-z0-9._~+/=-]+/;

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
 * Radicados cortos de tutela ("TUTELA 2026-00752"): año + consecutivo de 5
 * dígitos, sin los bloques de despacho.
 */
export function extractPartialRadicados(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = /\b(19|20)(\d{2})\s*[-_/]\s*(\d{5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(`${m[1]}${m[2]}${m[3]}`);
  return [...found];
}

/** Sufijo año(4)+consecutivo(5) de un radicado completo de 23 dígitos. */
export function radicadoSuffix(radicado23: string): string {
  return radicado23.length === 23 ? radicado23.slice(12, 21) : "";
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

/**
 * Exclusiones duras del matcher (punto 5 de la política ratificada):
 *   - correos de monitoreo de la propia Andromeda (evidencia circular);
 *   - auto-envíos del usuario que mencionan más de 3 radicados distintos
 *     ("informe semanal" personal): matchearlos produce fan-out masivo.
 * Los newsletters no requieren lista: sin radicado ni parte no matchean nada.
 */
export function isExcludedMessage(msg: GraphMessage, selfAddress?: string | null): boolean {
  const from = senderAddress(msg);
  if (EXCLUDED_SENDERS.includes(from)) return true;

  const self = (selfAddress ?? "").toLowerCase();
  const recipients = (msg.toRecipients ?? [])
    .map((r) => (r.emailAddress?.address ?? "").toLowerCase())
    .filter(Boolean);
  const selfSent =
    Boolean(self) && from === self && recipients.length > 0 &&
    recipients.every((r) => r === self);
  if (selfSent) {
    const radicados = extractRadicados(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`);
    if (radicados.length > 3) return true;
  }
  return false;
}

export interface SgdeEvidence {
  radicado: string | null;
  access_url: string | null;
  allowed_until: string | null;
  expired: boolean;
}

/** ¿El mensaje es una compartición de expediente electrónico del SGDE? */
export function isSgdeMessage(msg: GraphMessage): boolean {
  return (
    senderAddress(msg) === SGDE_SENDER && SGDE_SUBJECT_RE.test(msg.subject ?? "")
  );
}

/**
 * Extrae el enlace de acceso y la vigencia. `body` es el cuerpo leído en
 * memoria únicamente para este patrón: nunca se persiste.
 */
export function parseSgdeEvidence(msg: GraphMessage, body: string): SgdeEvidence {
  const text = `${msg.subject ?? ""}\n${body ?? ""}`.replace(/<[^>]+>/g, " ");
  const radicado = extractRadicados(text)[0] ?? null;
  const access_url = text.match(SGDE_LINK_RE)?.[0] ?? null;

  let allowed_until: string | null = null;
  const until = text.match(/consulta permitida hasta\s*:?\s*([^\n<]{0,40})/i)?.[1]?.trim();
  if (until && !/indefinido/i.test(until)) {
    const d = until.match(/(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (d) {
      allowed_until = `${d[3]}-${d[2]}-${d[1]}T${d[4] ?? "23"}:${d[5] ?? "59"}:00-05:00`;
    }
  }
  const expired = allowed_until !== null && Date.parse(allowed_until) < Date.now();
  return { radicado, access_url, allowed_until, expired };
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

  if (isExcludedMessage(msg)) return [];

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

  // 4. Radicado parcial ("TUTELA 2026-00752") — solo si no hubo radicado
  // completo. Un único match en tutelas activas es determinante; 2+ es
  // ambigüedad y baja a sugerencia.
  if (radicados.size === 0) {
    const partials = extractPartialRadicados(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`);
    for (const partial of partials) {
      const candidates = portfolio.filter((wi) => {
        const rad = wi.radicado ? normalizeRadicado(wi.radicado) : "";
        return (
          (wi.workflow_type ?? "").toUpperCase() === "TUTELA" &&
          radicadoSuffix(rad) === partial
        );
      });
      if (candidates.length === 0) continue;
      const confidence = candidates.length === 1 ? 1 : 0.65;
      for (const wi of candidates) {
        push({
          work_item_id: wi.id,
          organization_id: wi.organization_id,
          matched_by: "RADICADO_PARCIAL",
          matched_value: `${partial.slice(0, 4)}-${partial.slice(4)}`,
          confidence,
        });
      }
    }
  }

  return [...results.values()];
}

/**
 * Vocabulario ratificado de memoriales. Ampliado con evidencia real del buzón:
 * los recursos (apelación, reposición, queja, súplica), la impugnación, la
 * contestación, las excepciones, los alegatos y los traslados son memoriales
 * igual que la subsanación.
 */
export const MEMORIAL_RE =
  /subsana|subsanaci[oó]n|memorial|recurso de apelaci[oó]n|recurso de reposici[oó]n|recurso de queja|recurso de s[uú]plica|recurso|impugnaci[oó]n|contestaci[oó]n(?: de la demanda)?|excepciones|alegatos de conclusi[oó]n|alegatos|traslado(?: de excepciones)?|solicitud/i;
const TRASLADO_RE = /traslado/i;
const REQUERIMIENTO_RE = /requerimiento|requiere|requerido/i;
const LOW_CONTENT_RE =
  /respuesta autom[aá]tica|automatic reply|acuse de recibo|se acusa recibo|acusamos recibo|out of office|canned\.response/i;

/**
 * Acuses de recibo y auto-respuestas: evidencia válida de timestamp, pero sin
 * contenido sustantivo. La UI los muestra en una línea.
 */
export function isLowContentMessage(msg: GraphMessage): boolean {
  const from = senderAddress(msg);
  return LOW_CONTENT_RE.test(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""} ${from}`);
}

export function classifyEvidence(
  msg: GraphMessage,
  direction: "sent" | "received",
  matchedBy: MatchedBy,
): EvidenceType | null {
  const subject = msg.subject ?? "";
  const address = senderAddress(msg);

  if (isSgdeMessage(msg)) return "SGDE_ACCESO_EXPEDIENTE";
  if (
    direction === "sent" &&
    (matchedBy === "RADICADO" || matchedBy === "RADICADO_PARCIAL") &&
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