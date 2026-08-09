/**
 * party-attribution.ts — whose term is it? (iteration 50)
 *
 * A term computed by the engine binds SOMEBODY: the party who must pay or
 * excepcionar, the appellant, the opposing party in a traslado, or the judge.
 * Showing the counterparty's window as our client's action inverts the whole
 * meaning of the matter, so attribution is explicit and never guessed:
 * when the client's capacity is unknown we say so instead of assuming.
 */

/** Capacity in which OUR client acts on the matter (explicit, user-settable). */
export type ClientPartyRole =
  | "DEMANDANTE"
  | "DEMANDADO"
  | "ACCIONANTE"
  | "ACCIONADO"
  | "VICTIMA"
  | "TERCERO"
  | "APODERADO_DE_OFICIO";

/** Canonical party a deadline rule binds. */
export type BoundPartyRole =
  | "DEMANDANTE"
  | "DEMANDADO"
  | "RECURRENTE"
  | "OPOSITOR"
  | "JUEZ"
  | "AMBAS"
  | "DESCONOCIDO";

export type TermAttribution = "PROPIO" | "CONTRAPARTE" | "JUEZ" | "DESCONOCIDO";

export const CLIENT_PARTY_ROLE_LABELS: Record<ClientPartyRole, string> = {
  DEMANDANTE: "Demandante",
  DEMANDADO: "Demandado",
  ACCIONANTE: "Accionante (tutela)",
  ACCIONADO: "Accionado (tutela)",
  VICTIMA: "Víctima",
  TERCERO: "Tercero interviniente",
  APODERADO_DE_OFICIO: "Apoderado de oficio / curador ad litem",
};

export const CLIENT_PARTY_ROLES = Object.keys(CLIENT_PARTY_ROLE_LABELS) as ClientPartyRole[];

export const BOUND_PARTY_ROLE_LABELS: Record<BoundPartyRole, string> = {
  DEMANDANTE: "la parte demandante",
  DEMANDADO: "la parte demandada",
  RECURRENTE: "la parte recurrente",
  OPOSITOR: "la parte no recurrente",
  JUEZ: "el despacho",
  AMBAS: "ambas partes",
  DESCONOCIDO: "parte no determinada",
};

/** Active side (demandante/accionante) vs passive side (demandado/accionado). */
type ProceduralSide = "ACTIVA" | "PASIVA";

function sideOf(role: ClientPartyRole | null | undefined): ProceduralSide | null {
  if (role === "DEMANDANTE" || role === "ACCIONANTE") return "ACTIVA";
  if (role === "DEMANDADO" || role === "ACCIONADO") return "PASIVA";
  // Víctima, tercero and curador ad litem do not map onto a side without more
  // information; inferring one is exactly the error this module prevents.
  return null;
}

export function isClientPartyRole(v: unknown): v is ClientPartyRole {
  return typeof v === "string" && (CLIENT_PARTY_ROLES as string[]).includes(v);
}

export function normalizeBoundPartyRole(v: unknown): BoundPartyRole {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  return (["DEMANDANTE", "DEMANDADO", "RECURRENTE", "OPOSITOR", "JUEZ", "AMBAS"] as const).find(
    (r) => r === s,
  ) ?? "DESCONOCIDO";
}

/**
 * Attributes a term to our client, the counterparty or the court.
 *
 * RECURRENTE/OPOSITOR resolve to DESCONOCIDO on purpose: which side appealed
 * depends on the act, not on the party's capacity.
 */
export function attributeTerm(
  boundPartyRole: BoundPartyRole | string | null | undefined,
  clientRole: ClientPartyRole | null | undefined,
  opts: { isJudgeSide?: boolean } = {},
): TermAttribution {
  const bound = normalizeBoundPartyRole(boundPartyRole);
  if (opts.isJudgeSide || bound === "JUEZ") return "JUEZ";
  if (bound === "AMBAS") return "PROPIO";
  if (!clientRole) return "DESCONOCIDO";
  const side = sideOf(clientRole);
  if (!side) return "DESCONOCIDO";
  if (bound === "DEMANDANTE") return side === "ACTIVA" ? "PROPIO" : "CONTRAPARTE";
  if (bound === "DEMANDADO") return side === "PASIVA" ? "PROPIO" : "CONTRAPARTE";
  return "DESCONOCIDO";
}

/** Only a term attributed to our client may be actioned or alerted on. */
export function isActionableForClient(attribution: TermAttribution): boolean {
  return attribution === "PROPIO";
}

export const ATTRIBUTION_COPY: Record<TermAttribution, string> = {
  PROPIO: "Término a cargo de su cliente.",
  CONTRAPARTE: "Término de la contraparte — informativo, no requiere acción suya.",
  JUEZ: "Término a cargo del despacho — informativo, no requiere acción suya.",
  DESCONOCIDO:
    "Verifique a quién corresponde este término — indique la calidad en que actúa su cliente.",
};
