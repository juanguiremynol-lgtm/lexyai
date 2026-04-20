/**
 * Canonical portal keys for alert origin consolidation.
 * Maps raw provider sources (cpnu, samai, publicaciones, ...) to a stable label + style.
 */
export type PortalKey =
  | "CPNU"
  | "PP"
  | "SAMAI"
  | "SAMAI_ESTADOS"
  | "ICARUS"
  | "MANUAL"
  | "UNKNOWN";

export const PORTAL_LABEL: Record<PortalKey, string> = {
  CPNU: "CPNU",
  PP: "PP",
  SAMAI: "SAMAI",
  SAMAI_ESTADOS: "SAMAI Estados",
  ICARUS: "Importado",
  MANUAL: "Manual",
  UNKNOWN: "Origen N/D",
};

export const PORTAL_BADGE_CLASS: Record<PortalKey, string> = {
  CPNU: "bg-blue-500/15 text-blue-700 border-blue-300 dark:text-blue-300",
  PP: "bg-purple-500/15 text-purple-700 border-purple-300 dark:text-purple-300",
  SAMAI: "bg-emerald-500/15 text-emerald-700 border-emerald-300 dark:text-emerald-300",
  SAMAI_ESTADOS: "bg-teal-500/15 text-teal-700 border-teal-300 dark:text-teal-300",
  ICARUS: "bg-amber-500/15 text-amber-700 border-amber-300 dark:text-amber-300",
  MANUAL: "bg-slate-500/15 text-slate-700 border-slate-300 dark:text-slate-300",
  UNKNOWN: "bg-muted text-muted-foreground border-border",
};

const ALIASES: Record<string, PortalKey> = {
  CPNU: "CPNU",
  SAMAI: "SAMAI",
  SAMAI_ESTADOS: "SAMAI_ESTADOS",
  PUBLICACIONES: "PP",
  PP: "PP",
  ICARUS_IMPORT: "ICARUS",
  ICARUS: "ICARUS",
  MANUAL: "MANUAL",
};

export function normalizePortal(raw?: string | null): PortalKey {
  if (!raw) return "UNKNOWN";
  const key = raw.trim().toUpperCase();
  return ALIASES[key] ?? "UNKNOWN";
}

export const PORTAL_GROUP_ORDER: PortalKey[] = [
  "CPNU",
  "PP",
  "SAMAI",
  "SAMAI_ESTADOS",
  "ICARUS",
  "MANUAL",
  "UNKNOWN",
];