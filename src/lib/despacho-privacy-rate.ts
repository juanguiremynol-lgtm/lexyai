/**
 * despacho-privacy-rate.ts — ITERATION 46 (B).
 *
 * PROCESO_PRIVADO is a PER-MATTER, MUTABLE mark. GCP's enumeration of
 * neighbouring consecutivos settles it: in Barranquilla ~47% of matters carry
 * the mark, and all six despachos measured there are mixed — none fully marked,
 * none fully clear. So the district is a RATE, never a property, and a rate can
 * never license a conclusion about a specific matter.
 *
 * The rate exists for exactly one purpose: INTERPRETATION. It tells the lawyer
 * whether a mark is routine here or genuinely unusual. It must never suppress a
 * coverage alarm, never be written into `despacho_coverage` (whose `publishes`
 * is boolean, and would be false for half of Atlántico), and never be used to
 * pre-judge an unread matter.
 */

export type PrivacyRateScope = "DESPACHO" | "DISTRITO";

export interface DespachoPrivacyRate {
  scope: PrivacyRateScope;
  scope_key: string;
  scope_label: string;
  flagged: number;
  total: number;
  /** Anonymous per-despacho counts when the measurement resolved despachos. */
  despacho_distribution?: Array<{ flagged: number; total: number }> | null;
  measured_at?: string | null;
  notes?: string | null;
}

/** First 12 CUI digits identify ciudad + especialidad + despacho. */
export function despachoKeyFromRadicado(radicado: string | null | undefined): string | null {
  const d = (radicado ?? "").replace(/\D/g, "");
  return d.length >= 12 ? d.slice(0, 12) : null;
}

/** First 5 CUI digits identify the municipality / district. */
export function distritoKeyFromRadicado(radicado: string | null | undefined): string | null {
  const d = (radicado ?? "").replace(/\D/g, "");
  return d.length >= 5 ? d.slice(0, 5) : null;
}

/** Despacho measurement wins over district; neither is required. */
export function resolvePrivacyRate(
  radicado: string | null | undefined,
  rates: readonly DespachoPrivacyRate[],
): DespachoPrivacyRate | null {
  const despacho = despachoKeyFromRadicado(radicado);
  const distrito = distritoKeyFromRadicado(radicado);
  return (
    rates.find((r) => r.scope === "DESPACHO" && despacho && r.scope_key === despacho) ??
    rates.find((r) => r.scope === "DISTRITO" && distrito && r.scope_key === distrito) ??
    null
  );
}

export function privacyRatePct(rate: Pick<DespachoPrivacyRate, "flagged" | "total">): number {
  if (!rate.total) return 0;
  return Math.round((rate.flagged / rate.total) * 100);
}

/**
 * Spanish, attributed, and honest about the sample. Only ever shown NEXT TO an
 * already-observed mark — never as a prediction about an unread matter.
 */
export function privacyRateCopy(rate: DespachoPrivacyRate | null): string | null {
  if (!rate || rate.total <= 0) return null;
  const pct = privacyRatePct(rate);
  const donde = rate.scope === "DESPACHO" ? "este despacho" : "este distrito";

  if (rate.flagged === 0) {
    return `Inusual en ${donde}: el proveedor no marcó como privado ninguno de los ${rate.total} procesos medidos en ${rate.scope_label}.`;
  }

  const mixto =
    Array.isArray(rate.despacho_distribution) &&
    rate.despacho_distribution.length > 0 &&
    rate.despacho_distribution.every((d) => d.flagged > 0 && d.flagged < d.total)
      ? " Los despachos medidos allí son todos mixtos: ninguno marcado por completo, ninguno limpio por completo, así que la marca no se puede atribuir al despacho."
      : "";

  const frecuencia = pct >= 30 ? "Frecuente" : "Poco frecuente";
  return `${frecuencia} en ${donde}: el proveedor marca como privados ${rate.flagged} de ${rate.total} procesos medidos en ${rate.scope_label} (${pct}%).${mixto}`;
}

/** Guard rail, asserted by test: a rate may never silence a coverage alarm. */
export function privacyRateMaySuppressAlarm(): false {
  return false;
}
