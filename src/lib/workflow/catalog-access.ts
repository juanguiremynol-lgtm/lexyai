/**
 * Fase 5 / A.1 — the catalog fails loudly.
 *
 * A read error and an empty catalog are BOTH faults. Neither may be turned
 * into "there are no stages": a compiled mirror standing in for an unreadable
 * catalog is exactly how Fase 4 degraded silently. Every catalog consumer runs
 * its result through `assertCatalogRows`, which throws and records a health
 * event so the fault is visible instead of cosmetic.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { logHealthEvent } from "@/lib/system-health";

export class CatalogUnreadableError extends Error {
  readonly table: string;
  readonly cause?: string;
  constructor(table: string, cause?: string) {
    super(
      `No fue posible leer el catálogo «${table}». La pantalla no puede continuar sin él.`,
    );
    this.name = "CatalogUnreadableError";
    this.table = table;
    this.cause = cause;
  }
}

/** Catalog tables that must never answer empty for a governed workflow. */
export const CATALOG_TABLES = [
  "workflow_stages_global",
  "workflow_stage_transitions",
  "workflow_event_catalog",
  "deadline_rules",
  "peticion_subtypes",
  "gov_procedure_regimes",
  "workflow_overlays",
  "workflow_overlay_stage_applicability",
] as const;

export function assertCatalogRows<T>(
  table: string,
  data: T[] | null | undefined,
  error: PostgrestError | { message: string } | null,
  options: { allowEmpty?: boolean } = {},
): T[] {
  if (error) {
    void logHealthEvent("CATALOG_UNREADABLE", "ERROR", {
      message: `Lectura fallida de ${table}: ${error.message}`,
      metadata: { table, reason: "QUERY_ERROR" },
    });
    throw new CatalogUnreadableError(table, error.message);
  }
  if (!data || (data.length === 0 && !options.allowEmpty)) {
    void logHealthEvent("CATALOG_UNREADABLE", "ERROR", {
      message: `El catálogo ${table} respondió sin filas.`,
      metadata: { table, reason: "EMPTY_RESULT" },
    });
    throw new CatalogUnreadableError(table, "EMPTY_RESULT");
  }
  return data;
}
