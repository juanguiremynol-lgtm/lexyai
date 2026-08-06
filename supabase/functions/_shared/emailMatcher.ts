/**
 * emailMatcher.ts — Inference engine that links a mailbox message to a work
 * item using ONLY metadata (subject, sender, snippet). Bodies are never
 * stored and never leave this function.
 */
import { DEPT_NAMES } from "./radicadoUtils.ts";

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
  | "RADICADO_SIN_CERO"
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
  /** Instancia observada en el correo ('00','01',...) o null si vino el base
   *  de 21 dígitos desnudo. Metadato, nunca identidad. */
  instance_observed?: string | null;
  /** ITERACIÓN 6 — conjunto de señales independientes que sustentan el
   *  vínculo. Un vínculo sin radicado exige >= 2 señales. */
  match_signals?: MatchSignal[];
  /** Bases de 21 dígitos detectadas EN EL MENSAJE (asunto/cuerpo). Sirven a la
   *  UI para mostrar el conflicto de radicado. */
  message_bases?: string[];
}

/**
 * ITERACIÓN 6 — señales de identidad. `DESPACHO` identifica el JUZGADO, no el
 * proceso: un mismo despacho lleva varios asuntos del usuario, así que por sí
 * sola JAMÁS confirma ni sugiere.
 */
export type MatchSignal =
  | "RADICADO"
  | "RADICADO_SIN_CERO"
  | "RADICADO_PARCIAL"
  | "PARTE_DEMANDANTE"
  | "PARTE_DEMANDADA"
  | "DESPACHO"
  | "CLIENTE";

/** Etiquetas en español para los chips de la UI. */
export const MATCH_SIGNAL_LABELS_ES: Record<MatchSignal, string> = {
  RADICADO: "radicado",
  RADICADO_SIN_CERO: "radicado sin cero inicial",
  RADICADO_PARCIAL: "radicado parcial",
  PARTE_DEMANDANTE: "parte demandante",
  PARTE_DEMANDADA: "parte demandada",
  DESPACHO: "despacho",
  CLIENTE: "cliente",
};

/** Mínimo de señales independientes para sugerir sin radicado. */
export const MIN_SIGNALS_WITHOUT_RADICADO = 2;

export const JUDICIAL_DOMAINS = [
  "cendoj.ramajudicial.gov.co",
  "notificacionesrj.gov.co",
  "ramajudicial.gov.co",
  "deaj.ramajudicial.gov.co",
  "cortesuprema.gov.co",
  "ugpp.gov.co",
];

/**
 * Remitentes que NUNCA deben generar un vínculo: Andromeda no puede usar sus
 * propios resúmenes como evidencia (circularidad).
 */
export const EXCLUDED_SENDERS = ["monitoreo@andromeda.legal"];

/**
 * Identidad del titular del buzón. El abogado firma TODOS sus correos: su
 * propio nombre (o el de la firma) no aporta ninguna señal y produce fan-out
 * masivo por el matcher de nombres.
 *
 * MULTI-INQUILINO (iteración 39): se deriva EXCLUSIVAMENTE del buzón conectado
 * y del perfil de ese usuario. No existe ningún nombre ni correo codificado:
 * un valor fijo bloquearía la identidad equivocada en la firma de otro cliente
 * y dejaría de bloquear la suya.
 */
export interface OwnerIdentity {
  names: string[];
  emails: string[];
}

/** Vacío a propósito: ninguna identidad de inquilino se codifica en el motor. */
export const FALLBACK_OWNER_IDENTITY: OwnerIdentity = { names: [], emails: [] };

/** Construye la identidad del titular a partir del buzón y del perfil. */
export function buildOwnerIdentity(partial?: Partial<OwnerIdentity>): OwnerIdentity {
  const emails = (partial?.emails ?? [])
    .filter(Boolean)
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
  return {
    names: (partial?.names ?? [])
      .filter(Boolean)
      .map((n) => norm(n))
      .filter((n) => n.length >= 4),
    emails: [...new Set(emails)],
  };
}

const OWNER_STOPWORDS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y", "S", "SAS", "SA"]);

/**
 * ¿El valor matcheado corresponde al titular del buzón? Se compara por tokens
 * para cubrir normalizaciones y subcadenas ("RESTREPO MAYA",
 * "JUAN RESTREPO MAYA", "LEX ET LIT").
 */
export function isOwnerIdentityValue(value: string, owner: OwnerIdentity): boolean {
  const v = norm(value);
  if (!v) return false;
  if (owner.emails.some((e) => v.includes(e.toUpperCase()))) return true;
  const tokens = v.split(" ").filter((t) => t.length >= 2 && !OWNER_STOPWORDS.has(t));
  if (tokens.length === 0) return false;
  return owner.names.some((name) => {
    const ownerTokens = new Set(
      name.split(" ").filter((t) => t.length >= 2 && !OWNER_STOPWORDS.has(t)),
    );
    if (ownerTokens.size === 0) return false;
    return tokens.every((t) => ownerTokens.has(t));
  });
}

/**
 * Cap de ambigüedad: si un mensaje matchea más de N expedientes SOLO por
 * nombre, no se emite ninguna sugerencia (N sugerencias hermanas son ruido).
 */
export const NAME_FANOUT_CAP = 3;

/** Notificaciones de no entrega (NDR): nunca son evidencia de nada. */
const NDR_SENDER_RE =
  /^(postmaster@|mailer-daemon@|microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@)/i;
const NDR_SUBJECT_RE =
  /^(no se puede entregar|undeliverable|delivery (status notification|has failed))/i;

export function isBounceMessage(msg: GraphMessage): boolean {
  const from = senderAddress(msg);
  if (NDR_SENDER_RE.test(from)) return true;
  const subject = (msg.subject ?? "").trim();
  if (NDR_SUBJECT_RE.test(subject)) return true;
  const imid = (msg.internetMessageId ?? "").toLowerCase();
  return imid.endsWith("@microsoft.com>") || imid.endsWith("@microsoft.com");
}

/** Remitente del Sistema de Gestión Documental Electrónica de la Rama. */
export const SGDE_SENDER = "notificacionessgde@cendoj.ramajudicial.gov.co";
const SGDE_SUBJECT_RE = /se le ha compartido informaci[oó]n de proceso judicial/i;
const SGDE_LINK_RE =
  /https:\/\/siugj-sgde\.ramajudicial\.gov\.co\/expedientes\/usuario-externo\/[A-Za-z0-9._~+/=-]+/;

/**
 * Correos de token de validación del SGDE: el radicado sigue sirviendo para
 * matchear, pero no son evidencia sustantiva (mismo trato que un acuse).
 */
const SGDE_TOKEN_SUBJECT_RE = /^token validaci[oó]n de acceso/i;

/**
 * Enlaces de acceso al expediente electrónico aceptados: SGDE, Alfresco y TYBA
 * siempre que estén alojados bajo la Rama Judicial.
 */
export const EXPEDIENTE_LINK_HOSTS = [
  "siugj-sgde.ramajudicial.gov.co",
  "alfresco.ramajudicial.gov.co",
  "tyba.ramajudicial.gov.co",
];
const EXPEDIENTE_URL_RE = /https:\/\/([A-Za-z0-9.-]+)(\/[A-Za-z0-9._~+/=%?&#:-]*)?/g;

function isAllowedExpedienteHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h.endsWith(".ramajudicial.gov.co") || EXPEDIENTE_LINK_HOSTS.includes(h)
  );
}

/**
 * Extrae el primer enlace de acceso al expediente (SGDE / Alfresco / TYBA)
 * presente en un mensaje de un remitente judicial. `text` se lee en memoria y
 * nunca se persiste.
 */
export function extractExpedienteAccessUrl(
  msg: GraphMessage,
  text: string,
): string | null {
  if (!isJudicialSender(senderAddress(msg))) return null;
  const clean = `${msg.subject ?? ""}\n${text ?? ""}`.replace(/<[^>]+>/g, " ");
  EXPEDIENTE_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPEDIENTE_URL_RE.exec(clean)) !== null) {
    if (isAllowedExpedienteHost(m[1])) return m[0].replace(/[).,;"']+$/, "");
  }
  return null;
}

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
 * Validación estructural de un radicado de 23 dígitos:
 *   DANE(5) + CORP(2) + ESP(2) + DESP(3) + AÑO(4) + CONSEC(5) + RECURSO(2)
 *
 * Sin esta validación, un texto con una cadena larga de dígitos (números de
 * oficio, teléfonos concatenados, fechas) genera decenas de radicados falsos
 * por ventana deslizante. Es el freno al "enumeration garbage".
 */
export function isStructurallyValidRadicado(digits: string): boolean {
  if (!/^\d{23}$/.test(digits)) return false;
  const dane5 = digits.slice(0, 5);
  const dept = digits.slice(0, 2);
  const year = Number(digits.slice(12, 16));
  const consec = digits.slice(16, 21);
  if (dane5 === "00000") return false;
  if (!DEPT_NAMES[dept]) return false;
  const maxYear = new Date().getUTCFullYear() + 1;
  if (!Number.isFinite(year) || year < 1990 || year > maxYear) return false;
  if (consec === "00000") return false;
  return true;
}

/**
 * MODELO CANÓNICO (iteración 4.2): radicado = BASE(21) + INSTANCIA(2).
 * La identidad del proceso es la BASE; los 2 últimos dígitos son la instancia
 * (00 primera, 01 segunda, ...) y son metadato, no identidad.
 */
export interface RadicadoCandidate {
  /** 21 dígitos — identidad del proceso. */
  base: string;
  /** '00'..'09' cuando el correo la trae; null si vino la base desnuda. */
  instance: string | null;
  /** Cadena tal como apareció en el texto (para matched_value). */
  observed: string;
  /** 23 dígitos: base + (instancia ?? '00'). */
  canonical: string;
}

/** Validación estructural de la BASE de 21 dígitos. */
export function isStructurallyValidBase(base: string): boolean {
  if (!/^\d{21}$/.test(base)) return false;
  const dane5 = base.slice(0, 5);
  const dept = base.slice(0, 2);
  const year = Number(base.slice(12, 16));
  const consec = base.slice(16, 21);
  if (dane5 === "00000") return false;
  if (!DEPT_NAMES[dept]) return false;
  const maxYear = new Date().getUTCFullYear() + 1;
  if (!Number.isFinite(year) || year < 1990 || year > maxYear) return false;
  if (consec === "00000") return false;
  return true;
}

/** Instancia plausible: 00–09. Descarta colas de teléfonos ('73'). */
export function isValidInstance(instance: string): boolean {
  return /^0\d$/.test(instance);
}

/** Descompone una corrida de dígitos en base + instancia. */
export function decomposeRadicado(digits: string): RadicadoCandidate | null {
  if (/^\d{23}$/.test(digits)) {
    const base = digits.slice(0, 21);
    const instance = digits.slice(21, 23);
    if (!isStructurallyValidBase(base) || !isValidInstance(instance)) return null;
    return { base, instance, observed: digits, canonical: base + instance };
  }
  if (/^\d{21}$/.test(digits)) {
    if (!isStructurallyValidBase(digits)) return null;
    return { base: digits, instance: null, observed: digits, canonical: `${digits}00` };
  }
  return null;
}

/** Igual que `decomposeRadicado` pero aceptando un radicado ya almacenado
 *  (con o sin separadores). */
export function decomposeStoredRadicado(raw: string | null | undefined): RadicadoCandidate | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return decomposeRadicado(digits);
}

/**
 * Extrae candidatos base+instancia de un texto. Orden de reconocimiento por
 * corrida (anclada por límites de dígito): 23 → base+instancia; 21+sep+2 (que
 * al normalizar es la misma corrida de 23); 21 desnudos → solo base.
 * Corridas más largas se recorren con ventana de 23 (ruido concatenado).
 */
export function extractRadicadoCandidates(text: string): RadicadoCandidate[] {
  if (!text) return [];
  const byCanonical = new Map<string, RadicadoCandidate>();
  const re = /(?<!\d)\d[\d\s._\-/]{18,45}\d(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, "");
    let cands: RadicadoCandidate[] = [];
    if (digits.length === 23 || digits.length === 21) {
      const c = decomposeRadicado(digits);
      if (c) cands = [{ ...c, observed: raw.trim() }];
    } else if (digits.length > 23) {
      for (let i = 0; i + 23 <= digits.length; i++) {
        const c = decomposeRadicado(digits.slice(i, i + 23));
        if (c) cands.push(c);
      }
    }
    for (const c of cands) {
      const prev = byCanonical.get(c.canonical);
      // Preferimos la variante con instancia explícita.
      if (!prev || (prev.instance === null && c.instance !== null)) {
        byCanonical.set(c.canonical, c);
      }
    }
  }
  return [...byCanonical.values()];
}

/**
 * Extract every 23-digit radicado present in a text, tolerating separators:
 * 05001400303420260089800, 05001-40-03-034-2026-00898-00, with underscores,
 * spaces or dots. Toda candidata pasa por `isStructurallyValidRadicado`.
 */
export function extractRadicados(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = /\d[\d\s._\-/]{20,45}\d/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length === 23) {
      if (isStructurallyValidRadicado(digits)) found.add(digits);
    } else if (digits.length > 23) {
      // Ventana deslizante para ruido concatenado (radicado + fecha), pero
      // solo se conservan las ventanas estructuralmente válidas.
      for (let i = 0; i + 23 <= digits.length; i++) {
        const w = digits.slice(i, i + 23);
        if (isStructurallyValidRadicado(w)) found.add(w);
      }
    }
  }
  return [...found];
}

/**
 * Tolerancia 22 dígitos: algunos despachos omiten el cero inicial del código
 * DANE ("5001-31-03-018-2026-00313-00"). Solo se usa para emparejar contra el
 * portafolio del usuario (nunca para descubrir procesos nuevos), por lo que no
 * debilita la regla de 23 dígitos de `extractRadicados`.
 */
export function extractRadicados22(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = /\d[\d\s._\-/]{19,44}\d/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length !== 22) continue;
    const candidate = `0${digits}`;
    if (isStructurallyValidRadicado(candidate)) found.add(candidate);
  }
  return [...found];
}

/**
 * Mensajes de reparto / oficina judicial: el radicado del día cero suele venir
 * en el cuerpo estructurado ("NÚMERO RADICACIÓN: ..."), no en el asunto.
 */
const REPARTO_SENDER_RE = /oficinajudicial|reparto|ofjudicial/i;
const REPARTO_SUBJECT_RE =
  /reparto|radicaci[oó]n|acta de reparto|asignaci[oó]n de proceso|constancia de radicaci[oó]n/i;

export function isRepartoMessage(msg: GraphMessage): boolean {
  const from = (
    msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? ""
  ).toLowerCase();
  return (
    REPARTO_SENDER_RE.test(from) ||
    REPARTO_SUBJECT_RE.test(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`)
  );
}

const REPARTO_LABEL_RE =
  /(?:n[uú]mero\s+(?:de\s+)?radicaci[oó]n|radicado|no\.?\s*de\s*radicado)\s*:?\s*([\d\s._\-/]{20,45}\d)/gi;

/**
 * Extrae radicados de un cuerpo de reparto leído en memoria. Prioriza los
 * valores etiquetados; si no hay etiquetas, cae al extractor genérico.
 */
export function extractRepartoRadicados(body: string): string[] {
  const text = String(body ?? "").replace(/<[^>]+>/g, " ");
  const labeled = new Set<string>();
  let m: RegExpExecArray | null;
  REPARTO_LABEL_RE.lastIndex = 0;
  while ((m = REPARTO_LABEL_RE.exec(text)) !== null) {
    const digits = (m[1] ?? "").replace(/\D/g, "");
    if (isStructurallyValidRadicado(digits)) labeled.add(digits);
  }
  if (labeled.size > 0) return [...labeled];
  return extractRadicados(text);
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

/** Público: ¿la dirección pertenece a un dominio judicial reconocido? */
export function isJudicialAddress(address: string | null | undefined): boolean {
  return isJudicialSender(String(address ?? "").toLowerCase());
}

/**
 * ITERACIÓN 5 — lectura universal del cuerpo.
 *
 * Un mensaje es "contraparte judicial" cuando el remitente O alguno de los
 * destinatarios pertenece a un dominio judicial. Cubre las dos direcciones:
 * la notificación que entra del despacho y el memorial que sale hacia él.
 */
export function isJudicialCounterpart(msg: GraphMessage): boolean {
  if (isJudicialSender(senderAddress(msg))) return true;
  return (msg.toRecipients ?? []).some((r) =>
    isJudicialSender((r.emailAddress?.address ?? "").toLowerCase())
  );
}

/** Tope duro de lectura en memoria: 20KB de texto. El cuerpo NUNCA se persiste. */
export const BODY_TEXT_CAP = 20_000;

/**
 * ITERACIÓN 7.2 — Unión de BASES de 21 dígitos detectadas en el ASUNTO y en el
 * CUERPO. Es la fuente única para (a) la regla de conflicto del matcher y
 * (b) el chip de conflicto de la UI: ambas deben ver los mismos radicados.
 */
export function messageRadicadoBases(
  subject: string | null | undefined,
  bodyText?: string | null,
): string[] {
  const bases = new Set<string>();
  const text = `${subject ?? ""}\n${bodyText ?? ""}`;
  for (const c of extractRadicadoCandidates(text)) bases.add(c.base);
  for (const r of extractRadicados(text)) bases.add(r.slice(0, 21));
  for (const r of extractRadicados22(text)) bases.add(r.slice(0, 21));
  if (bodyText) {
    for (const c of extractBodyRadicadoCandidates(bodyText)) bases.add(c.base);
  }
  return [...bases];
}

const HTML_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü",
  ordf: "ª", ordm: "º", deg: "°", mdash: "—", ndash: "–", hellip: "…",
};

/**
 * Convierte el cuerpo (HTML o texto) a texto plano acotado. Se usa solo en
 * memoria: el resultado se descarta apenas se extraen los identificadores.
 */
export function bodyToText(body: string | null | undefined, cap = BODY_TEXT_CAP): string {
  let text = String(body ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => HTML_ENTITIES[name] ?? whole);
  return text.replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, cap);
}

/**
 * Anclas etiquetadas que los despachos usan en el CUERPO cuando el asunto no
 * trae el radicado ("REF.: 08001600125720253122600-").
 */
export const BODY_RADICADO_ANCHORS: RegExp[] = [
  /REF\.?:?\s*([\d\s.\-/]{21,45})/gi,
  /EXPEDIENTE:?\s*([\d\s.\-/]{21,45})/gi,
  /(?:n[uú]mero\s+(?:de\s+)?radicaci[oó]n|radicaci[oó]n|radicado|proceso)\s*(?:n[oº°.]*)?\s*:?\s*([\d\s.\-/]{21,45})/gi,
  /TUTELA\s*(?:n[oº°.]*)?\s*:?\s*([\d\s.\-/]{21,45})/gi,
];

/**
 * Extrae radicados de un cuerpo leído en memoria: primero por ancla
 * etiquetada, y siempre complementado con el extractor genérico anclado por
 * límites de dígito. Devuelve candidatos base+instancia (modelo 4.2).
 */
export function extractBodyRadicadoCandidates(body: string): RadicadoCandidate[] {
  const text = bodyToText(body);
  const byBase = new Map<string, RadicadoCandidate>();
  const push = (c: RadicadoCandidate | null) => {
    if (!c) return;
    const prev = byBase.get(c.base);
    if (!prev || (prev.instance === null && c.instance !== null)) byBase.set(c.base, c);
  };
  for (const re of BODY_RADICADO_ANCHORS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const digits = (m[1] ?? "").replace(/\D/g, "");
      if (digits.length === 23 || digits.length === 21) push(decomposeRadicado(digits));
      else if (digits.length > 23) {
        for (let i = 0; i + 23 <= digits.length; i++) push(decomposeRadicado(digits.slice(i, i + 23)));
      }
    }
  }
  for (const c of extractRadicadoCandidates(text)) push(c);
  return [...byBase.values()];
}

/** Identificador secundario NIJ: metadato, JAMÁS clave de identidad. */
export function extractNij(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(/NIJ:?\s*([\d][\d-]{3,11})/i);
  return m ? m[1].replace(/-$/, "") : null;
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
  if (isBounceMessage(msg)) return true;

  const self = (selfAddress ?? "").toLowerCase();
  const recipients = (msg.toRecipients ?? [])
    .map((r) => (r.emailAddress?.address ?? "").toLowerCase())
    .filter(Boolean);
  const selfSent =
    Boolean(self) && from === self && recipients.length > 0 &&
    recipients.every((r) => r === self);
  if (selfSent) {
    if (/^informe semanal/i.test((msg.subject ?? "").trim())) return true;
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
  const access_url =
    text.match(SGDE_LINK_RE)?.[0] ?? extractExpedienteAccessUrl(msg, body);

  const allowed_until = parseAllowedUntil(text);
  const expired =
    allowed_until !== null && Date.parse(expiryInstant(allowed_until)) < Date.now();
  return { radicado, access_url, allowed_until, expired };
}

/**
 * "Consulta permitida hasta" admite tres formas reales:
 *   - "Indefinido"            → null (sin vencimiento)
 *   - "31-07-2026"            → fecha ISO "2026-07-31"
 *   - "31-07-2026 11:32"      → datetime ISO con offset de Bogotá
 */
export function parseAllowedUntil(text: string): string | null {
  const until = text.match(/consulta permitida hasta\s*:?\s*([^\n<]{0,40})/i)?.[1]?.trim();
  if (!until || /indefinido/i.test(until)) return null;
  const d = until.match(/(\d{2})-(\d{2})-(\d{4})(?:[\sT]+(\d{1,2}):(\d{2}))?/);
  if (!d) return null;
  const date = `${d[3]}-${d[2]}-${d[1]}`;
  if (d[4] === undefined) return date;
  return `${date}T${d[4].padStart(2, "0")}:${d[5]}:00-05:00`;
}

/** Instante efectivo de vencimiento: las fechas sin hora vencen al final del día. */
function expiryInstant(allowedUntil: string): string {
  return /T/.test(allowedUntil) ? allowedUntil : `${allowedUntil}T23:59:59-05:00`;
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
export interface MatchOptions {
  selfAddress?: string | null;
  owner?: OwnerIdentity;
}

export function matchMessage(
  msg: GraphMessage,
  portfolio: PortfolioItem[],
  options: MatchOptions = {},
): MatchResult[] {
  const subject = norm(msg.subject);
  const preview = norm(msg.bodyPreview).slice(0, 500);
  const haystack = `${subject} ${preview}`;
  const address = senderAddress(msg);
  const radicados = new Set(extractRadicados(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`));
  const radicados22 = new Set(
    extractRadicados22(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`),
  );
  // Identidad por BASE de 21 dígitos: la instancia (00/01/…) es metadato.
  const candidatesByBase = new Map<string, RadicadoCandidate>();
  for (const c of extractRadicadoCandidates(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`)) {
    const prev = candidatesByBase.get(c.base);
    if (!prev || (prev.instance === null && c.instance !== null)) candidatesByBase.set(c.base, c);
  }
  const results = new Map<string, MatchResult>();
  const owner = options.owner ?? buildOwnerIdentity();

  const push = (r: MatchResult) => {
    const prev = results.get(r.work_item_id);
    if (!prev || r.confidence > prev.confidence) results.set(r.work_item_id, r);
  };

  if (isExcludedMessage(msg, options.selfAddress ?? null)) return [];

  // ── ITERACIÓN 6, regla dura de conflicto de radicado ──
  // Si el mensaje NOMBRA un proceso (trae cualquier radicado estructuralmente
  // válido), entonces solo pueden vincularse los expedientes cuya BASE esté
  // entre esos radicados. Las señales de nombre/despacho quedan suprimidas por
  // completo para ese mensaje: un correo que nombra un caso pertenece a ese caso.
  const messageBases = new Set<string>(candidatesByBase.keys());
  for (const r of radicados) messageBases.add(r.slice(0, 21));
  for (const r of radicados22) messageBases.add(r.slice(0, 21));
  const messageNamesACase = messageBases.size > 0;
  const messageBasesList = [...messageBases];

  for (const wi of portfolio) {
    const wiRad = wi.radicado ? normalizeRadicado(wi.radicado) : "";
    const wiDecomposed = decomposeStoredRadicado(wiRad);

    // 1. Radicado — deterministic, confidence 1.0
    if (wiRad.length === 23 && radicados.has(wiRad)) {
      push({
        work_item_id: wi.id,
        organization_id: wi.organization_id,
        matched_by: "RADICADO",
        matched_value: wiRad,
        confidence: 1,
        instance_observed: wiRad.slice(21, 23),
        match_signals: ["RADICADO"],
        message_bases: messageBasesList,
      });
      continue;
    }

    // 1.a-bis Igualdad por BASE con instancia distinta o desconocida — 1.0.
    if (wiDecomposed) {
      const hit = candidatesByBase.get(wiDecomposed.base);
      if (hit) {
        push({
          work_item_id: wi.id,
          organization_id: wi.organization_id,
          matched_by: "RADICADO",
          matched_value: hit.observed,
          confidence: 1,
          instance_observed: hit.instance,
          match_signals: ["RADICADO"],
          message_bases: messageBasesList,
        });
        continue;
      }
    }

    // 1.b Radicado sin cero inicial (22 dígitos) — solo portafolio, 0.95
    if (wiRad.length === 23 && radicados22.has(wiRad)) {
      push({
        work_item_id: wi.id,
        organization_id: wi.organization_id,
        matched_by: "RADICADO_SIN_CERO",
        matched_value: wiRad,
        confidence: 0.95,
        match_signals: ["RADICADO_SIN_CERO"],
        message_bases: messageBasesList,
      });
      continue;
    }

    // El mensaje nombra otro proceso: ninguna señal blanda puede vincularlo.
    if (messageNamesACase) continue;

    // ── Puntuación multi-señal (iteración 6) ──
    const signals: MatchSignal[] = [];
    const values: string[] = [];

    // 2. DESPACHO — señal, nunca identidad. Cuenta el remitente y también
    //    los destinatarios (memorial saliente hacia el juzgado).
    const authEmail = (wi.authority_email ?? "").toLowerCase();
    const authName = norm(wi.authority_name);
    const counterparts = [
      address,
      ...(msg.toRecipients ?? []).map((r) => (r.emailAddress?.address ?? "").toLowerCase()),
    ].filter(Boolean);
    const despachoHit =
      (authEmail && counterparts.includes(authEmail)) ||
      (authName.length >= 10 && haystack.includes(authName));
    if (despachoHit && counterparts.some((c) => isJudicialSender(c))) {
      signals.push("DESPACHO");
      values.push(authEmail || authName);
    }

    // 3. Partes y cliente — fuzzy sobre asunto/preview, con la lista negra de
    //    la identidad del titular intacta.
    const demandanteHit = partyNames(wi.demandantes).find(
      (n) => haystack.includes(n) && !isOwnerIdentityValue(n, owner),
    );
    if (demandanteHit) {
      signals.push("PARTE_DEMANDANTE");
      values.push(demandanteHit);
    }
    const demandadoHit = partyNames(wi.demandados).find(
      (n) => haystack.includes(n) && !isOwnerIdentityValue(n, owner),
    );
    if (demandadoHit) {
      signals.push("PARTE_DEMANDADA");
      values.push(demandadoHit);
    }
    const clienteHit = partyNames(wi.client_name).find(
      (n) => haystack.includes(n) && !isOwnerIdentityValue(n, owner),
    );
    if (clienteHit) {
      signals.push("CLIENTE");
      values.push(clienteHit);
    }

    // Una sola señal NUNCA sugiere (así muere el envenenamiento por despacho).
    if (signals.length < MIN_SIGNALS_WITHOUT_RADICADO) continue;

    const matchedBy: MatchedBy = signals.includes("PARTE_DEMANDADA") ||
        signals.includes("PARTE_DEMANDANTE")
      ? "PARTE"
      : signals.includes("CLIENTE")
      ? "CLIENTE"
      : "DESPACHO";

    push({
      work_item_id: wi.id,
      organization_id: wi.organization_id,
      matched_by: matchedBy,
      matched_value: values.join(" + ").slice(0, 200),
      // Techo por debajo del umbral de confirmación: sin radicado, nada se
      // auto-confirma jamás.
      confidence: signals.length >= 3 ? 0.8 : 0.7,
      match_signals: signals,
      message_bases: messageBasesList,
    });
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
          match_signals: ["RADICADO_PARCIAL"],
          message_bases: messageBasesList,
        });
      }
    }
  }

  const all = [...results.values()];
  const nameBased = all.filter((r) => r.matched_by === "CLIENTE" || r.matched_by === "PARTE");
  if (nameBased.length > NAME_FANOUT_CAP) {
    // Ambigüedad: N sugerencias hermanas son ruido. Los matches por radicado
    // (precisos) quedan exentos del cap.
    console.warn(
      `[emailMatcher] name fan-out cap: ${nameBased.length} WIs por nombre, mensaje descartado`,
      msg.internetMessageId ?? msg.id,
    );
    return all.filter((r) => r.matched_by !== "CLIENTE" && r.matched_by !== "PARTE");
  }
  return all;
}

/**
 * Vocabulario ratificado de memoriales. Ampliado con evidencia real del buzón:
 * los recursos (apelación, reposición, queja, súplica), la impugnación, la
 * contestación, las excepciones, los alegatos y los traslados son memoriales
 * igual que la subsanación.
 */
/**
 * ITERACIÓN 6 — única puerta de auto-confirmación. Solo la identidad por
 * radicado (completo, sin cero inicial, o parcial inequívoco) confirma sin
 * intervención humana. DESPACHO, PARTE y CLIENTE siempre quedan SUGGESTED.
 */
export function isAutoConfirmable(match: MatchResult): boolean {
  return match.matched_by.startsWith("RADICADO") && match.confidence >= 0.9;
}

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
  if (
    from.startsWith("notificacionessgde@") &&
    SGDE_TOKEN_SUBJECT_RE.test((msg.subject ?? "").trim())
  ) {
    return true;
  }
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

/* ------------------------------------------------------------------
 * Evidence subtypes (iteration 4 — email semantics engine)
 *
 * Mirrors public.classify_email_evidence_subtype / classify_memorial_subtype
 * in Postgres. Order of the rules is legally significant: "inadmite"
 * contains "admite", so INADMISION must be evaluated first.
 * ------------------------------------------------------------------ */
export type EvidenceSubtype =
  | "ACUSE_AUTOMATICO"
  | "ACCESO_EXPEDIENTE"
  | "ACTA_REPARTO"
  | "RECHAZO_COMPETENCIA"
  | "INADMISION"
  | "AUTO_ADMISORIO"
  | "FIJACION_ESTADO"
  | "DESISTIMIENTO"
  | "RECURSO_CONCEDIDO"
  | "FALLO_SENTENCIA"
  | "TRASLADO"
  | "REQUERIMIENTO"
  | "CITACION_AUDIENCIA"
  | "NOTIFICACION_PERSONAL"
  // Ley 906/2004 (sistema penal acusatorio) — vocabulario propio: estos actos
  // no tienen equivalente civil y antes caían en OTRO_JUDICIAL.
  | "IMPUTACION"
  | "MEDIDA_ASEGURAMIENTO"
  | "ESCRITO_ACUSACION"
  | "ACUSACION"
  | "ALLANAMIENTO"
  | "PREACUERDO"
  | "PRECLUSION"
  // Proceso ejecutivo (CGP). Vocabulario propio: sin estos subtipos, el auto
  // que libra mandamiento de pago o el que ordena seguir adelante la ejecución
  // caían en OTRO_JUDICIAL o, peor, en FALLO_SENTENCIA.
  | "MANDAMIENTO_PAGO"
  | "SEGUIR_ADELANTE"
  | "EXCEPCIONES_MERITO"
  | "LIQUIDACION_CREDITO"
  | "AVALUO"
  | "REMATE"
  | "OTRO_JUDICIAL";

export const EVIDENCE_SUBTYPE_RULES: Array<[EvidenceSubtype, RegExp]> = [
  ["ACUSE_AUTOMATICO", /^(respuesta autom[aá]tica|automatic reply|acuse)/i],
  [
    "ACCESO_EXPEDIENTE",
    /token validaci[oó]n|se le ha compartido informaci[oó]n de proceso|acceso a informaci[oó]n de proceso/i,
  ],
  ["ACTA_REPARTO", /acta *(de +)?reparto/i],
  // Iteración 11 — un rechazo/remisión por (falta de) competencia NO es una
  // inadmisión: no concede término de subsanación. Debe evaluarse ANTES que
  // INADMISION y que AUTO_ADMISORIO.
  [
    "RECHAZO_COMPETENCIA",
    /(rechaz[a-zóo]*|remi[st][a-zóo]*|remisi[oó]n|env[ií]a|conflicto)[^.]{0,60}(de +)?competencia|competencia[^.]{0,40}(rechaz|remi)/i,
  ],
  // Solo la inadmisión genuina abre SUBSANACION.
  ["INADMISION", /inadmit|inadmisi[oó]n|so pena de rechazo|t[eé]rmino para subsanar|para subsanar/i],
  // Ejecutivo (CGP). Evaluados antes de FALLO_SENTENCIA / TRASLADO / AUTO_ADMISORIO
  // porque comparten vocabulario ("sentencia", "traslado", "auto").
  [
    "MANDAMIENTO_PAGO",
    /mandamiento\s*(ejecutivo)?\s*(de\s*)?pago|l[ií]bra?se?\s+mandamiento|libra\s+mandamiento/i,
  ],
  ["SEGUIR_ADELANTE", /seguir\s+adelante(\s+(con\s+)?la\s+ejecuci[oó]n)?/i],
  ["REMATE", /remate|adjudicaci[oó]n\s+del?\s+bien/i],
  ["AVALUO", /aval[uú]o|aval[uú]a/i],
  ["LIQUIDACION_CREDITO", /liquidaci[oó]n\s+del?\s+cr[eé]dito|liquidaci[oó]n\s+de\s+costas/i],
  ["EXCEPCIONES_MERITO", /excepciones\s+de\s+m[eé]rito|traslado\s+de\s+(las\s+)?excepciones/i],
  // Penal (Ley 906). Evaluados antes de AUTO_ADMISORIO / TRASLADO / AUDIENCIA
  // porque comparten vocabulario ("admite", "traslado", "audiencia de…").
  ["PRECLUSION", /preclusi[oó]n|precluye/i],
  // Terminación anticipada: allanamiento a cargos y preacuerdos. Van antes de
  // ESCRITO_ACUSACION / ACUSACION porque comparten el vocabulario de acusación.
  [
    "ALLANAMIENTO",
    /allanamiento( +a +(los +)?cargos)?|aceptaci[oó]n +de +(los +)?cargos/i,
  ],
  [
    "PREACUERDO",
    /preacuerdo|negociaci[oó]n +con +la +fiscal[ií]a|sentencia +anticipada/i,
  ],
  [
    "MEDIDA_ASEGURAMIENTO",
    /medida +de +aseguramiento|detenci[oó]n +preventiva|imposici[oó]n +de +medida/i,
  ],
  [
    "ESCRITO_ACUSACION",
    /escrito +de +acusaci[oó]n|traslado +(del +)?escrito +de +acusaci[oó]n/i,
  ],
  // Audiencia de formulación de acusación (acto distinto del escrito).
  [
    "ACUSACION",
    /(audiencia|formulaci[oó]n) +de +acusaci[oó]n|acusaci[oó]n +(formulada|presentada|radicada)/i,
  ],
  [
    "IMPUTACION",
    /formulaci[oó]n +de +imputaci[oó]n|imputaci[oó]n|legalizaci[oó]n +de +captura/i,
  ],
  ["AUTO_ADMISORIO", /admite|auto admisorio|admisi[oó]n/i],
  ["FIJACION_ESTADO", /estado electr[oó]nico|fija[a-z]* +(el +)?estado/i],
  ["DESISTIMIENTO", /desistimiento/i],
  // Un auto que CONCEDE una impugnación/recurso ya interpuesto no es un fallo:
  // no abre término al recurrente, solo remite el expediente al superior.
  [
    "RECURSO_CONCEDIDO",
    /concede\s+(la\s+|el\s+|los\s+|las\s+)?(impugnaci[óo]n|apelaci[óo]n|recurso|recursos|alzada)/i,
  ],
  [
    "FALLO_SENTENCIA",
    /fallo|sentencia|resuelve|tutela +amparo|(niega|concede)\s+(el\s+|la\s+|las\s+|los\s+)?(amparo|tutela|pretensi[óo]n|pretensiones)/i,
  ],
  ["TRASLADO", /traslado/i],
  ["REQUERIMIENTO", /requerimiento|requiere/i],
  ["CITACION_AUDIENCIA", /audiencia|diligencia/i],
  ["NOTIFICACION_PERSONAL", /notifica[a-z]*.*(proceso|curador|personal|demanda)|curador ad litem/i],
];

/** Subclassify an inbound judicial notification. Requires a judicial sender. */
export function classifyEvidenceSubtype(
  subject: string | null | undefined,
  sender: string | null | undefined,
): EvidenceSubtype | null {
  if (!isJudicialSender((sender ?? "").toLowerCase())) return null;
  const s = subject ?? "";
  for (const [subtype, re] of EVIDENCE_SUBTYPE_RULES) {
    if (re.test(s)) return subtype;
  }
  return "OTRO_JUDICIAL";
}

export type MemorialSubtype =
  | "APELACION"
  | "IMPUGNACION"
  | "SUBSANACION"
  | "CONTESTACION"
  | "ALEGATOS"
  | "REPOSICION"
  | "EXCEPCIONES"
  | "DESACATO"
  | "CUMPLIMIENTO"
  | "PODER"
  | "RECURSO"
  | "TUTELA"
  | "MEMORIAL_GENERAL";

const MEMORIAL_SUBTYPE_RULES: Array<[MemorialSubtype, RegExp]> = [
  ["APELACION", /apelaci[oó]n|apela/i],
  ["IMPUGNACION", /impugnaci[oó]n|impugna/i],
  ["SUBSANACION", /subsan/i],
  ["CONTESTACION", /contestaci[oó]n|contesta/i],
  ["ALEGATOS", /alegatos/i],
  ["REPOSICION", /reposici[oó]n/i],
  ["EXCEPCIONES", /excepcion/i],
  ["DESACATO", /desacato/i],
  ["CUMPLIMIENTO", /cumplimiento/i],
  ["PODER", /poder|sustituci[oó]n/i],
  ["RECURSO", /recurso|queja|s[uú]plica|nulidad/i],
  ["TUTELA", /tutela|acci[oó]n de tutela/i],
  ["MEMORIAL_GENERAL", /memorial|solicit|radica/i],
];

/** Subclassify an outbound memorial by subject vocabulary. */
export function classifyMemorialSubtype(
  subject: string | null | undefined,
): MemorialSubtype | null {
  const s = subject ?? "";
  for (const [subtype, re] of MEMORIAL_SUBTYPE_RULES) {
    if (re.test(s)) return subtype;
  }
  return null;
}