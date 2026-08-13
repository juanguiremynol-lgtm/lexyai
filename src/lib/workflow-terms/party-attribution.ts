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

export type TermAttribution =
  | "PROPIO"
  | "PROPIO_EN_REPRESENTACION"
  | "CONTRAPARTE"
  | "JUEZ"
  | "DESCONOCIDO";

/** Party a curador ad litem / apoderado de oficio acts for. */
export type RepresentedParty = "DEMANDANTE" | "DEMANDADO";

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

function sideOf(
  role: ClientPartyRole | null | undefined,
  represents?: RepresentedParty | null,
): ProceduralSide | null {
  if (role === "DEMANDANTE" || role === "ACCIONANTE") return "ACTIVA";
  if (role === "DEMANDADO" || role === "ACCIONADO") return "PASIVA";
  // A curador ad litem has no capacity of his own: he borrows the side of the
  // party he was appointed for, and only once that party is stated.
  if (role === "APODERADO_DE_OFICIO" && represents) {
    return represents === "DEMANDANTE" ? "ACTIVA" : "PASIVA";
  }
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
  opts: { isJudgeSide?: boolean; represents?: RepresentedParty | null } = {},
): TermAttribution {
  const bound = normalizeBoundPartyRole(boundPartyRole);
  if (opts.isJudgeSide || bound === "JUEZ") return "JUEZ";
  const own: TermAttribution =
    clientRole === "APODERADO_DE_OFICIO" ? "PROPIO_EN_REPRESENTACION" : "PROPIO";
  if (bound === "AMBAS") return clientRole ? own : "PROPIO";
  if (!clientRole) return "DESCONOCIDO";
  const side = sideOf(clientRole, opts.represents ?? null);
  if (!side) return "DESCONOCIDO";
  if (bound === "DEMANDANTE") return side === "ACTIVA" ? own : "CONTRAPARTE";
  if (bound === "DEMANDADO") return side === "PASIVA" ? own : "CONTRAPARTE";
  return "DESCONOCIDO";
}

/** Only a term attributed to our client may be actioned or alerted on. */
export function isActionableForClient(attribution: TermAttribution): boolean {
  return attribution === "PROPIO" || attribution === "PROPIO_EN_REPRESENTACION";
}

/**
 * Attribution of a STORED deadline row.
 *
 * ITER51 — the bound party is now materialised on `work_item_deadlines`, so a
 * row that still carries no resolvable rule is genuinely unattributed. We say
 * DESCONOCIDO instead of assuming the term is our client's: presenting the
 * counterparty's window as his own is the failure this module exists to stop.
 */
export function attributeStoredDeadline(
  row:
    | {
        bound_party_role?: string | null;
        attribution?: string | null;
        is_judge_side?: boolean | null;
      }
    | null
    | undefined,
  clientRole: ClientPartyRole | null | undefined,
  represents?: RepresentedParty | null,
): TermAttribution {
  const stored = typeof row?.attribution === "string" ? row.attribution.toUpperCase() : "";
  if (stored === "CONTRAPARTE" || stored === "JUEZ") return stored as TermAttribution;
  const bound = row?.bound_party_role;
  if (!bound || bound === "DESCONOCIDO") return "DESCONOCIDO";
  return attributeTerm(bound, clientRole, {
    isJudgeSide: row?.is_judge_side === true,
    represents: represents ?? null,
  });
}

export const ATTRIBUTION_COPY: Record<TermAttribution, string> = {
  PROPIO: "Término a cargo de su cliente.",
  PROPIO_EN_REPRESENTACION:
    "Término a cargo de la parte que usted representa como curador ad litem / apoderado de oficio.",
  CONTRAPARTE: "Término de la contraparte — informativo, no requiere acción suya.",
  JUEZ: "Término a cargo del despacho — informativo, no requiere acción suya.",
  DESCONOCIDO:
    "Verifique a quién corresponde este término — indique la calidad en que actúa su cliente.",
};

/**
 * ITER53 — ONE attribution, computed once, rendered everywhere.
 *
 * Every surface (Acción requerida, Términos del expediente, the unattributed
 * block) must read the SAME resolution for the same row. Three sections
 * disagreeing about one term is worse than any of them being silent, and a
 * chip showing the CLIENT's role next to a term that binds the other party
 * inverts the meaning of the matter.
 */

/** Short, term-facing names — never the client's own capacity. */
const BOUND_PARTY_SHORT: Record<BoundPartyRole, string> = {
  DEMANDANTE: "demandante",
  DEMANDADO: "demandado",
  RECURRENTE: "recurrente",
  OPOSITOR: "no recurrente",
  JUEZ: "despacho",
  AMBAS: "ambas partes",
  DESCONOCIDO: "parte no determinada",
};

/**
 * Bound-party values that were filled by a generic catalogue fallback rather
 * than by a ratified rule. They state a default, not an attribution, so they
 * may never present a term as the client's own action (A4).
 */
export const UNESTABLISHED_BOUND_SOURCES = new Set(["CATALOGO_GENERICO"]);

export interface TermAttributionInput {
  boundPartyRole?: string | null;
  isJudgeSide?: boolean | null;
  /** How the bound party got onto the row (`work_item_deadlines.bound_party_source`). */
  boundPartySource?: string | null;
  /** Attribution frozen on the row when it was created. */
  storedAttribution?: string | null;
}

export interface ResolvedTermAttribution {
  attribution: TermAttribution;
  boundPartyRole: BoundPartyRole;
  /** One sentence about WHOSE term it is. Always about the bound party. */
  statement: string;
  actionable: boolean;
  /** True only when the capacity of the client is what blocks the attribution. */
  needsClientCapacity: boolean;
}

export function resolveTermAttribution(
  input: TermAttributionInput,
  clientRole: ClientPartyRole | null | undefined,
  represents?: RepresentedParty | null,
): ResolvedTermAttribution {
  const bound = normalizeBoundPartyRole(input.boundPartyRole);
  const judge = input.isJudgeSide === true || bound === "JUEZ";
  const unestablished =
    !judge && UNESTABLISHED_BOUND_SOURCES.has((input.boundPartySource ?? "").toUpperCase());

  const stored = typeof input.storedAttribution === "string" ? input.storedAttribution.toUpperCase() : "";
  let attribution: TermAttribution;
  if (judge) attribution = "JUEZ";
  else if (unestablished) attribution = "DESCONOCIDO";
  else if (stored === "CONTRAPARTE") attribution = "CONTRAPARTE";
  else if (bound === "DESCONOCIDO") attribution = "DESCONOCIDO";
  else attribution = attributeTerm(bound, clientRole, { isJudgeSide: false, represents: represents ?? null });

  const actionable = isActionableForClient(attribution);
  const needsClientCapacity = attribution === "DESCONOCIDO" && !clientRole;

  let statement: string;
  if (attribution === "JUEZ") statement = ATTRIBUTION_COPY.JUEZ;
  else if (attribution === "PROPIO") statement = ATTRIBUTION_COPY.PROPIO;
  else if (attribution === "PROPIO_EN_REPRESENTACION") statement = ATTRIBUTION_COPY.PROPIO_EN_REPRESENTACION;
  else if (attribution === "CONTRAPARTE")
    statement = `Término de la contraparte (${BOUND_PARTY_SHORT[bound]}) — informativo, no requiere acción suya.`;
  else if (bound !== "DESCONOCIDO" && !unestablished)
    statement = `Término a cargo de ${BOUND_PARTY_ROLE_LABELS[bound]} — confirme la calidad de su cliente para saber si le corresponde.`;
  else
    statement =
      "Parte no determinada — verifique a quién corresponde este término antes de actuar sobre él.";

  return { attribution, boundPartyRole: bound, statement, actionable, needsClientCapacity };
}
