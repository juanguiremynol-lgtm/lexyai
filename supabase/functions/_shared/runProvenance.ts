/**
 * runProvenance.ts — ITERATION 55, item A.
 *
 * GCP now emits the run provenance authoritatively on every actuación /
 * publicación it writes:
 *
 *   run_type          'initial_load' | 'daily' | 'full_sweep' | null
 *   previous_scan_at  NULL on the radicado's first pass (the discriminator)
 *   provider_observed_at
 *
 * THE ONE CAVEAT THAT MUST NOT BE GOT WRONG (GCP): `run_type IS NULL` is
 * UNKNOWN provenance, never initial load and never daily. The rows written
 * before their provenance migration (2038 CPNU, 162 PP) were deliberately
 * left NULL, and the PP `/procesar-radicado` + `/lookup` background scrape
 * wrote no provenance at all. A reader that turns NULL into a classification
 * invents history.
 *
 * Our own 30-minute-after-creation window survives ONLY as a fallback for
 * rows that arrive without provider provenance, and only for rows detected
 * after the provenance migration — otherwise an old NULL row re-ingested
 * today would be relabelled as an initial load.
 */

export type IngestRunMode = "INITIAL_LOAD" | "DAILY" | "FULL_SWEEP";
export type RunModeSource = "PROVIDER" | "WINDOW_FALLBACK" | "UNKNOWN";

/** Instant GCP's provenance migration landed. Rows detected before it may
 *  legitimately carry no `run_type`; the window fallback is gated on it. */
export const PROVENANCE_MIGRATION_AT = "2026-08-13T00:00:00.000Z";

export interface ProviderRunProvenance {
  run_type?: string | null;
  previous_scan_at?: string | null;
  provider_observed_at?: string | null;
}

const RUN_TYPE_MAP: Record<string, IngestRunMode> = {
  initial_load: "INITIAL_LOAD",
  first_scan: "INITIAL_LOAD",
  daily: "DAILY",
  incremental: "DAILY",
  full_sweep: "FULL_SWEEP",
  historical: "FULL_SWEEP",
};

/** Pull provenance out of a provider unit, wherever it hides. */
export function extractRunProvenance(unit: unknown): ProviderRunProvenance {
  const u = (unit ?? {}) as Record<string, unknown>;
  const raw = (u.raw_data ?? {}) as Record<string, unknown>;
  const pick = (k: string): string | null => {
    const v = u[k] ?? raw[k];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  return {
    run_type: pick("run_type"),
    previous_scan_at: pick("previous_scan_at"),
    provider_observed_at: pick("provider_observed_at"),
  };
}

/**
 * The provider's own classification. Returns null for UNKNOWN provenance —
 * never a guess.
 */
export function providerRunMode(p: ProviderRunProvenance | null | undefined): IngestRunMode | null {
  const rt = typeof p?.run_type === "string" ? p.run_type.trim().toLowerCase() : "";
  if (!rt) return null;
  return RUN_TYPE_MAP[rt] ?? null;
}

export interface ResolveRunModeInput extends ProviderRunProvenance {
  /** work item creation instant — the fallback anchor. */
  work_item_created_at?: string | null;
  /** when we detected the row (defaults to now). */
  detected_at?: string | null;
  /** minutes after creation still considered the first load. */
  window_minutes?: number;
}

export interface ResolvedRunMode {
  mode: IngestRunMode | null;
  source: RunModeSource;
}

/**
 * Resolve the run mode: provider first, 30-minute window only as fallback,
 * UNKNOWN when neither can speak.
 */
export function resolveIngestRunMode(input: ResolveRunModeInput): ResolvedRunMode {
  const fromProvider = providerRunMode(input);
  if (fromProvider) return { mode: fromProvider, source: "PROVIDER" };

  const detectedIso = input.detected_at ?? new Date().toISOString();
  const detected = Date.parse(detectedIso);
  const migration = Date.parse(PROVENANCE_MIGRATION_AT);
  // A row that predates the provenance migration has UNKNOWN provenance.
  // Do not let the window relabel it.
  if (!Number.isFinite(detected) || detected < migration) return { mode: null, source: "UNKNOWN" };

  const created = input.work_item_created_at ? Date.parse(input.work_item_created_at) : NaN;
  if (!Number.isFinite(created)) return { mode: null, source: "UNKNOWN" };

  const windowMs = (input.window_minutes ?? 30) * 60_000;
  if (detected <= created + windowMs) {
    return { mode: "INITIAL_LOAD", source: "WINDOW_FALLBACK" };
  }
  return { mode: null, source: "UNKNOWN" };
}
