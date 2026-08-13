/**
 * party-capacity.ts — ITER56.
 *
 * One-time onboarding to confirm, across the whole portfolio, the capacity in
 * which our client acts. Pure logic lives here so the screen renders it and
 * the tests assert it without touching the network.
 *
 * The design point: attention goes where the machine is least sure. A verbatim
 * match does not merit deliberation, a partial one does, and a matter with no
 * proposal at all needs a REMEDY, not a prompt.
 */
import {
  attributeTerm,
  type ClientPartyRole,
  type RepresentedParty,
} from "./party-attribution";

export const HIGH_CONFIDENCE_THRESHOLD = 0.9;

/** Curador ad litem matters: the capacity is borrowed, never collapsed to a side. */
export const CURADOR_AD_LITEM_RADICADOS = [
  "11001311001320240075200",
  "05376311200120220031700",
] as const;

export type CapacitySection = "ALTA_CONFIANZA" | "REVISION" | "SIN_PROPUESTA";

export type NoProposalReason =
  | "SIN_CLIENTE"
  | "SIN_PARTES"
  | "CURADOR_AD_LITEM"
  | "SIN_COINCIDENCIA";

export interface CapacityRowInput {
  id: string;
  radicado: string | null;
  clientName: string | null;
  hasClient: boolean;
  demandantes: string | null;
  demandados: string | null;
  role: ClientPartyRole | null;
  confidence: number;
  basis: string | null;
  represents: RepresentedParty | null;
}

export function classifyCapacityRow(row: CapacityRowInput): CapacitySection {
  if (!row.role) return "SIN_PROPUESTA";
  return row.confidence >= HIGH_CONFIDENCE_THRESHOLD ? "ALTA_CONFIANZA" : "REVISION";
}

export function noProposalReason(row: CapacityRowInput): NoProposalReason {
  if (row.radicado && (CURADOR_AD_LITEM_RADICADOS as readonly string[]).includes(row.radicado)) {
    return "CURADOR_AD_LITEM";
  }
  if (!row.hasClient) return "SIN_CLIENTE";
  const empty = (s: string | null) => !s || !s.trim();
  if (empty(row.demandantes) && empty(row.demandados)) return "SIN_PARTES";
  return "SIN_COINCIDENCIA";
}

export const NO_PROPOSAL_COPY: Record<NoProposalReason, { title: string; remedy: string }> = {
  SIN_CLIENTE: {
    title: "Sin cliente vinculado",
    remedy: "Asocie el cliente: al hacerlo se propone la calidad automáticamente.",
  },
  SIN_PARTES: {
    title: "Partes vacías en el proveedor",
    remedy: "El proveedor no reporta partes. Declare la calidad manualmente.",
  },
  CURADOR_AD_LITEM: {
    title: "Curaduría ad litem",
    remedy:
      "El curador no tiene calidad propia: toma la de la parte para la que fue designado. Indique a quién representa.",
  },
  SIN_COINCIDENCIA: {
    title: "Sin coincidencia con las partes",
    remedy: "El nombre del cliente no coincide con ninguna parte. Declare la calidad manualmente.",
  },
};

export interface DeadlineAttributionInput {
  bound_party_role: string | null;
  is_judge_side?: boolean | null;
}

export interface AttributionConsequence {
  propio: number;
  contraparte: number;
  juez: number;
  desconocido: number;
  /** Terms that stop being the client's responsibility once the role is accepted. */
  changed: number;
}

/**
 * What accepting this role would do to the matter's stored terms. Shown BEFORE
 * confirming so an inversion is caught here rather than propagated.
 */
export function computeAttributionConsequence(
  deadlines: DeadlineAttributionInput[],
  role: ClientPartyRole | null,
  represents: RepresentedParty | null,
): AttributionConsequence {
  const out: AttributionConsequence = {
    propio: 0,
    contraparte: 0,
    juez: 0,
    desconocido: 0,
    changed: 0,
  };
  for (const d of deadlines) {
    const attr = attributeTerm(d.bound_party_role, role, {
      isJudgeSide: d.is_judge_side === true,
      represents,
    });
    if (attr === "PROPIO" || attr === "PROPIO_EN_REPRESENTACION") out.propio++;
    else if (attr === "CONTRAPARTE") out.contraparte++;
    else if (attr === "JUEZ") out.juez++;
    else out.desconocido++;
  }
  out.changed = out.contraparte + out.juez;
  return out;
}

export function consequenceCopy(c: AttributionConsequence): string {
  if (c.propio + c.contraparte + c.juez + c.desconocido === 0) {
    return "Sin términos registrados en este expediente.";
  }
  const parts: string[] = [];
  if (c.contraparte > 0) parts.push(`${c.contraparte} término(s) pasarían a la contraparte`);
  if (c.juez > 0) parts.push(`${c.juez} quedarían a cargo del despacho`);
  if (c.propio > 0) parts.push(`${c.propio} seguirían a cargo de su cliente`);
  if (parts.length === 0) return "Ningún término cambiaría de atribución.";
  return parts.join(" · ");
}
