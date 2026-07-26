/**
 * provider-chain-labels.ts — UI-only labels for the ratified provider matrix.
 *
 * PRESENTATION ONLY. No routing logic lives here: the effective chain is
 * resolved by resolveProviderChain.ts / the edge sync functions. This module
 * exists so diagnostic screens stop showing a universal "CPNU + SAMAI" chain
 * for every work item and instead show the chain that actually applies to the
 * work item's category.
 *
 * Ratified matrix (Opción A):
 *   CGP / LABORAL / PENAL_906 → actuaciones CPNU · estados PP
 *   CPACA                     → actuaciones SAMAI · estados SAMAI_ESTADOS (fallback CPNU)
 *   TUTELA                    → cascada CPNU · SAMAI · PP · SAMAI Estados
 */

export interface ProviderChainLabel {
  /** Compact one-line chain, e.g. "CPNU · PP" */
  short: string;
  /** Chain for actuaciones only */
  acts: string;
  /** Chain for estados/publicaciones only */
  pubs: string;
  /** Full sentence for tooltips */
  description: string;
}

const CHAINS: Record<string, ProviderChainLabel> = {
  CGP: {
    short: "CPNU · PP",
    acts: "CPNU",
    pubs: "Publicaciones Procesales",
    description:
      "Actuaciones desde CPNU; estados desde Publicaciones Procesales.",
  },
  LABORAL: {
    short: "CPNU · PP",
    acts: "CPNU",
    pubs: "Publicaciones Procesales",
    description:
      "Actuaciones desde CPNU; estados desde Publicaciones Procesales.",
  },
  PENAL_906: {
    short: "CPNU · PP",
    acts: "CPNU",
    pubs: "Publicaciones Procesales",
    description:
      "Publicaciones Procesales es la fuente primaria de notificación; CPNU aporta las actuaciones.",
  },
  CPACA: {
    short: "SAMAI · SAMAI_ESTADOS (fallback CPNU)",
    acts: "SAMAI (fallback CPNU si SAMAI responde vacío o not_found)",
    pubs: "SAMAI Estados · Publicaciones Procesales",
    description:
      "Actuaciones desde SAMAI, con fallback a CPNU solo cuando SAMAI responde vacío o not_found; estados desde SAMAI Estados.",
  },
  TUTELA: {
    short: "CPNU · SAMAI · PP · SAMAI Estados",
    acts: "CPNU · SAMAI",
    pubs: "Publicaciones Procesales · SAMAI Estados",
    description:
      "La tutela no tiene proveedor propio: consulta en cascada CPNU, SAMAI, Publicaciones Procesales y SAMAI Estados.",
  },
};

const MANUAL: ProviderChainLabel = {
  short: "Sin sincronización externa",
  acts: "Registro manual",
  pubs: "Registro manual",
  description:
    "Esta categoría se gestiona manualmente: no consulta proveedores judiciales externos.",
};

/** Categories managed manually (no external judicial provider). */
export const MANUAL_WORKFLOWS = ["PETICION", "GOV_PROCEDURE", "GENERIC"];

export function getProviderChainLabel(
  workflowType?: string | null,
): ProviderChainLabel {
  if (!workflowType) return CHAINS.CGP;
  const key = workflowType.toUpperCase();
  if (MANUAL_WORKFLOWS.includes(key)) return MANUAL;
  return CHAINS[key] ?? CHAINS.CGP;
}

/** Short chain string, e.g. "CPNU · PP". */
export function getProviderChainShort(workflowType?: string | null): string {
  return getProviderChainLabel(workflowType).short;
}

/** Full matrix, for legends in diagnostic/preflight panels. */
export const PROVIDER_MATRIX_LEGEND: Array<{ category: string; chain: string }> = [
  { category: "CGP · Laboral · Penal", chain: CHAINS.CGP.short },
  { category: "CPACA", chain: CHAINS.CPACA.short },
  { category: "Tutela", chain: CHAINS.TUTELA.short },
];
