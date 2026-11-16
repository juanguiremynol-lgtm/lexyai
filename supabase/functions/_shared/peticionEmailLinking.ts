/**
 * peticionEmailLinking.ts — deterministic linking rules for administrative
 * matters (PETICION / GOV_PROCEDURE), which have no 23-digit judicial radicado.
 *
 * Only unequivocal identity auto-confirms:
 *   - an internetMessageId already CONFIRMED on the matter,
 *   - a conversationId inherited from exactly one CONFIRMED matter,
 *   - the authority's official tracking identifier stored on exactly one matter.
 * An exact authority mailbox is only a reviewable SUGGESTION. Authority names,
 * gov.co domains, generic subjects and date proximity never link anything.
 *
 * Classification is a review hint: nothing here proves official receipt, sets
 * a legal anchor, or declares a substantive answer (RESPUESTA_DE_FONDO).
 * Pure module: no I/O, mirrored by tests in peticionEmailLinking_test.ts.
 */
import type { GraphMessage } from "./emailMatcher.ts";

export const ADMIN_WORKFLOWS = new Set(["PETICION", "GOV_PROCEDURE"]);

export type AdminMatchedBy = "MENSAJE" | "CONVERSACION" | "IDENTIFICADOR_OFICIAL" | "DESPACHO";
export type AdminEmailClass =
  | "ENVIO"
  | "ACUSE_RECIBO"
  | "RADICADO_ASIGNADO"
  | "TRASLADO_COMPETENCIA"
  | "REQUERIMIENTO"
  | "PRORROGA"
  | "POSIBLE_RESPUESTA"
  | "OTRO";

export interface AdminWorkItem {
  id: string;
  organization_id: string | null;
  workflow_type: string | null;
  authority_email: string | null;
  authority_radicado: string | null;
  email_linking_enabled: boolean | null;
  lifecycle_state: string | null;
}

export interface AdminLinkContext {
  items: AdminWorkItem[];
  /** internet_message_id -> work_item_ids with a CONFIRMED link. */
  confirmedByInternetId: Map<string, Set<string>>;
  /** conversation_id -> work_item_ids with a CONFIRMED link. */
  confirmedByConversation: Map<string, Set<string>>;
  selfAddress?: string | null;
}

export interface AdminLinkDecision {
  work_item_id: string;
  organization_id: string | null;
  link_status: "CONFIRMED" | "SUGGESTED";
  matched_by: AdminMatchedBy;
  matched_value: string;
  confidence: number;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Official identifiers compare on uppercase alphanumerics only. */
export function normalizeOfficialId(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function counterparts(msg: GraphMessage, self: string): string[] {
  const all = [
    lower(msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address),
    ...(msg.toRecipients ?? []).map((r) => lower(r.emailAddress?.address)),
  ];
  return all.filter((a) => a && a !== self);
}

/** Token-bounded presence of an official identifier inside subject/preview. */
export function containsOfficialId(msg: GraphMessage, officialId: string): boolean {
  const id = normalizeOfficialId(officialId);
  if (id.length < 5 || !/\d/.test(id)) return false; // too weak to be identity
  const text = `${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`.toUpperCase();
  for (const token of text.split(/[^A-Z0-9\-\/\.]+/)) {
    if (normalizeOfficialId(token) === id) return true;
  }
  return false;
}

export function eligibleAdminItems(items: AdminWorkItem[]): AdminWorkItem[] {
  return items.filter((w) =>
    ADMIN_WORKFLOWS.has((w.workflow_type ?? "").toUpperCase()) &&
    w.email_linking_enabled === true &&
    (w.lifecycle_state ?? "ACTIVE") === "ACTIVE"
  );
}

export function decideAdministrativeLinks(
  msg: GraphMessage,
  ctx: AdminLinkContext,
): AdminLinkDecision[] {
  const items = eligibleAdminItems(ctx.items);
  if (items.length === 0) return [];
  const byId = new Map(items.map((w) => [w.id, w]));
  const out = new Map<string, AdminLinkDecision>();
  const put = (d: AdminLinkDecision) => {
    const prev = out.get(d.work_item_id);
    if (!prev || (prev.link_status === "SUGGESTED" && d.link_status === "CONFIRMED") ||
      (prev.link_status === d.link_status && d.confidence > prev.confidence)) {
      out.set(d.work_item_id, d);
    }
  };
  const self = lower(ctx.selfAddress);

  // 1. Same message already confirmed (another copy: Sent vs. received cc).
  const imid = msg.internetMessageId ?? "";
  for (const wi of imid ? ctx.confirmedByInternetId.get(imid) ?? [] : []) {
    const w = byId.get(wi);
    if (w) put({ work_item_id: w.id, organization_id: w.organization_id, link_status: "CONFIRMED", matched_by: "MENSAJE", matched_value: imid.slice(0, 200), confidence: 1 });
  }

  // 2. Conversation inherited from CONFIRMED links: unique => confirm.
  const conv = msg.conversationId ?? "";
  const convWis = [...(conv ? ctx.confirmedByConversation.get(conv) ?? [] : [])].filter((id) => byId.has(id));
  for (const wi of convWis) {
    const w = byId.get(wi)!;
    put({
      work_item_id: w.id, organization_id: w.organization_id,
      link_status: convWis.length === 1 ? "CONFIRMED" : "SUGGESTED",
      matched_by: "CONVERSACION", matched_value: "conversación confirmada",
      confidence: convWis.length === 1 ? 0.95 : 0.6,
    });
  }

  // 3. Official tracking identifier stored on the matter: unique => confirm.
  const idHits = items.filter((w) => w.authority_radicado && containsOfficialId(msg, w.authority_radicado));
  for (const w of idHits) {
    put({
      work_item_id: w.id, organization_id: w.organization_id,
      link_status: idHits.length === 1 ? "CONFIRMED" : "SUGGESTED",
      matched_by: "IDENTIFICADOR_OFICIAL", matched_value: w.authority_radicado!.slice(0, 200),
      confidence: idHits.length === 1 ? 0.95 : 0.6,
    });
  }

  // 4. Exact authority mailbox as counterpart: suggestion only, never confirm.
  const cps = counterparts(msg, self);
  for (const w of items) {
    const addr = lower(w.authority_email);
    if (addr && cps.includes(addr)) {
      put({ work_item_id: w.id, organization_id: w.organization_id, link_status: "SUGGESTED", matched_by: "DESPACHO", matched_value: addr, confidence: 0.6 });
    }
  }
  return [...out.values()];
}

const RX: [AdminEmailClass, RegExp][] = [
  ["TRASLADO_COMPETENCIA", /traslad[oa]\s+(?:por|de)\s+competencia|remisi[oó]n\s+por\s+competencia|remit\w*\s+por\s+competencia|art[ií]culo\s+21\s+de\s+la\s+ley\s+1755/i],
  ["PRORROGA", /pr[oó]rroga|ampliaci[oó]n\s+del\s+t[eé]rmino|no\s+es\s+posible\s+(?:dar\s+)?respuesta\s+dentro/i],
  ["REQUERIMIENTO", /requerimiento|se\s+le\s+requiere|requerimos|completar\s+la\s+petici[oó]n|aclarar\s+(?:su|la)\s+(?:petici[oó]n|solicitud)|desistimiento\s+t[aá]cito/i],
  ["RADICADO_ASIGNADO", /n[uú]mero\s+de\s+radicad[oa]|n[uú]mero\s+de\s+radicaci[oó]n|radicad[oa]\s+(?:con\s+(?:el\s+)?)?(?:n[uú]mero|no\.?|n°|#)|qued[oó]\s+radicad[oa]|se\s+radic[oó]/i],
  ["ACUSE_RECIBO", /acuse\s+de\s+recibo|se\s+acusa\s+recibo|acusamos\s+recibo|confirmaci[oó]n\s+de\s+recibido|hemos\s+recibido\s+su|recibimos\s+su/i],
  ["POSIBLE_RESPUESTA", /\brespuesta\b|damos\s+respuesta|da\s+respuesta|en\s+atenci[oó]n\s+a\s+su/i],
];

/** Review hint only. Sent mail is always ENVIO; never returns RESPUESTA_DE_FONDO. */
export function classifyAdministrativeEmail(msg: GraphMessage, direction: "sent" | "received"): AdminEmailClass {
  if (direction === "sent") return "ENVIO";
  const text = `${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`;
  for (const [cls, re] of RX) if (re.test(text)) return cls;
  return "OTRO";
}

/** Candidate official identifier quoted by the authority. Proposal only. */
export function extractProposedOfficialId(msg: GraphMessage): string | null {
  const text = `${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`;
  const m = text.match(/radica(?:do|da|ci[oó]n)\s*(?:n[uú]mero|no\.?|n°|#)?\s*:?\s*([A-Z0-9][A-Z0-9\-\/]{4,30})/i);
  if (!m) return null;
  const id = m[1].replace(/[\.\-\/]+$/, "");
  return /\d/.test(id) ? id : null;
}

/** Event code recorded on peticion_events for a CONFIRMED link. */
export function eventCodeFor(cls: AdminEmailClass): string {
  return cls === "ENVIO" ? "EMAIL_ENVIO_OBSERVADO" : "EMAIL_NOVEDAD_PROPUESTA";
}

/** Bogotá calendar date of an ISO timestamp (YYYY-MM-DD). */
export function bogotaDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 5 * 3600_000).toISOString().slice(0, 10);
}
