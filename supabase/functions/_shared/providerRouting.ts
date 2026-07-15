/**
 * providerRouting.ts — Deterministic per-category provider resolver.
 *
 * SINGLE SOURCE OF TRUTH for which external provider services a work item
 * category MAY consult, per the Doctor's strict routing rule:
 *
 *   ┌──────────┬──────────────────────────┬──────────────────────────────┐
 *   │ Workflow │ Actuaciones providers    │ Estados providers            │
 *   ├──────────┼──────────────────────────┼──────────────────────────────┤
 *   │ CPACA    │ [SAMAI → CPNU] (fb empty)│ [SAMAI_ESTADOS]              │
 *   │ CGP      │ [CPNU]                   │ [PP]                         │
 *   │ PENAL_906│ [CPNU]                   │ [PP]                         │
 *   │ LABORAL  │ [CPNU]                   │ [PP]                         │
 *   │ TUTELA   │ [CPNU ∪ SAMAI]  (UNION)  │ [PP ∪ SAMAI_ESTADOS] (UNION) │
 *   └──────────┴──────────────────────────┴──────────────────────────────┘
 *
 * Semantics of the returned arrays:
 *   • For CGP / LABORAL / PENAL_906 the array has EXACTLY ONE element —
 *     the exclusive provider for that workflow.
 *   • For CPACA the array is [SAMAI, CPNU] with CASCADE (not UNION)
 *     semantics: SAMAI is queried first; CPNU is queried ONLY when SAMAI
 *     returns EMPTY / NOT_FOUND. Transient errors on SAMAI (timeout/5xx)
 *     DO NOT trigger the CPNU fallback — SAMAI is retried instead.
 *     Ratified by the Doctor 2026-07-15 (caso 05001333301520260011300 —
 *     juzgados administrativos con expediente aún no migrado a SAMAI que
 *     sí existen en CPNU). Espejo exacto de la regla de fallback de tutelas.
 *   • For TUTELA the array lists MULTIPLE providers with UNION semantics:
 *     every provider MUST be queried on every sync and their results are
 *     merged + deduplicated by hash_fingerprint. This is NOT a cascade —
 *     never stop after the first non-empty answer. Tutela is CONSTITUTIONAL
 *     jurisdiction, so a single expediente may be split across an ordinary
 *     judge (CPNU / PP) AND an administrative judge (SAMAI / SAMAI_ESTADOS)
 *     — e.g. primera instancia en juez ordinario, impugnación en juez
 *     administrativo. Only the union guarantees full coverage.
 *   • If one provider errs transiently and the other succeeds, the sync
 *     result is PARTIAL (persist what came in, retry the failed one).
 *     Never report SUCCESS when a provider errored.
 *
 * Hard corollaries — enforced by every dispatcher via this resolver:
 *   • CPACA NEVER queries PP (estados stay SAMAI_ESTADOS exclusivo).
 *   • CPACA MAY query CPNU only as EMPTY-fallback for actuaciones.
 *   • CGP / LABORAL / PENAL_906 NEVER query SAMAI or SAMAI_ESTADOS.
 *   • TUTELA queries all four providers on every sync (UNION), and the
 *     four are all legitimate — never treat any of them as ROUTING_SKIP.
 *
 * All sync dispatchers (sync-by-work-item, sync-publicaciones-by-work-item,
 * syncOrchestrator, provider-sync-external-provider, cpnu-job-poller, and
 * any adapter selector) MUST derive provider selection from `resolveProviders`
 * — no ad-hoc lists, no silent defaults.
 *
 * Related docs:
 *   • .memory/business/workflow-aware-provider-selection-rules.md
 *   • docs/sync-routing-map.md
 */

export type ActuacionesProvider = "CPNU" | "SAMAI";
export type EstadosProvider = "PP" | "SAMAI_ESTADOS";

export interface ProviderRouting {
  /** Ordered cascade of actuaciones providers (primary first). Empty = ineligible. */
  actuaciones: ActuacionesProvider[];
  /** Ordered cascade of estados providers (primary first). Empty = ineligible. */
  estados: EstadosProvider[];
  eligible: boolean;
  reason: string;
}

/**
 * Canonical routing table. `null` means the category has no external judicial
 * provider for that data kind (internal-only state, e.g. PETICION).
 */
const ROUTING_TABLE: Record<string, ProviderRouting> = {
  // CPACA — SAMAI primary, CPNU fallback on empty/not_found only.
  CPACA:     { actuaciones: ["SAMAI", "CPNU"], estados: ["SAMAI_ESTADOS"],       eligible: true, reason: "CPACA_SAMAI_PRIMARY_CPNU_FALLBACK" },
  CGP:       { actuaciones: ["CPNU"],          estados: ["PP"],                  eligible: true, reason: "CGP_ROUTE" },
  LABORAL:   { actuaciones: ["CPNU"],          estados: ["PP"],                  eligible: true, reason: "LABORAL_ROUTE" },
  PENAL_906: { actuaciones: ["CPNU"],          estados: ["PP"],                  eligible: true, reason: "PENAL_906_ROUTE" },
  // TUTELA — constitutional jurisdiction: UNION of all providers.
  // Every provider is queried on every sync; results are deduped by
  // hash_fingerprint. Order in the array is informational only (used for
  // tie-breaking / trace ordering) — it does NOT imply cascade semantics.
  TUTELA:    { actuaciones: ["CPNU", "SAMAI"], estados: ["PP", "SAMAI_ESTADOS"], eligible: true, reason: "TUTELA_UNION" },
  // Internal-only categories — never dispatch to any external provider
  PETICION:       { actuaciones: [], estados: [], eligible: false, reason: "INTERNAL_ONLY" },
  GOV_PROCEDURE:  { actuaciones: [], estados: [], eligible: false, reason: "INTERNAL_ONLY" },
};

/**
 * Resolve the deterministic provider routing for a work item category.
 *
 * Unknown categories return {eligible:false} — the caller MUST treat this as
 * ineligible and log a warning. NEVER silently default to CPNU/PP.
 */
export function resolveProviders(
  workflowType: string | null | undefined,
): ProviderRouting {
  if (!workflowType) {
    console.warn("[providerRouting] resolveProviders called with empty workflow_type — treating as ineligible");
    return { actuaciones: [], estados: [], eligible: false, reason: "MISSING_WORKFLOW_TYPE" };
  }
  const entry = ROUTING_TABLE[workflowType];
  if (!entry) {
    console.warn(`[providerRouting] Unknown workflow_type=${workflowType} — treating as ineligible until classified`);
    return { actuaciones: [], estados: [], eligible: false, reason: `UNKNOWN_WORKFLOW_${workflowType}` };
  }
  return entry;
}

// ── Cascade helpers (never use ad-hoc lists elsewhere) ──
// Semantics: "is provider X anywhere in the cascade of this workflow?"
// True for both PRIMARY and FALLBACK positions. Use these instead of
// equality checks so TUTELA's fallback slots are respected.

export function actsChainIncludes(wt: string | null | undefined, p: ActuacionesProvider): boolean {
  return resolveProviders(wt).actuaciones.includes(p);
}
export function estadosChainIncludes(wt: string | null | undefined, p: EstadosProvider): boolean {
  return resolveProviders(wt).estados.includes(p);
}

/** Back-compat helpers — semantics widened to "in cascade" (was "equals primary"). */
export function usesSamaiActs(wt: string | null | undefined): boolean { return actsChainIncludes(wt, "SAMAI"); }
export function usesCpnuActs(wt: string | null | undefined): boolean { return actsChainIncludes(wt, "CPNU"); }
export function usesSamaiEstados(wt: string | null | undefined): boolean { return estadosChainIncludes(wt, "SAMAI_ESTADOS"); }
export function usesPpEstados(wt: string | null | undefined): boolean { return estadosChainIncludes(wt, "PP"); }

/** Primary providers (position 0 of cascade). Null if category ineligible. */
export function primaryActs(wt: string | null | undefined): ActuacionesProvider | null {
  return resolveProviders(wt).actuaciones[0] ?? null;
}
export function primaryEstados(wt: string | null | undefined): EstadosProvider | null {
  return resolveProviders(wt).estados[0] ?? null;
}

/**
 * Convenience — categories eligible for the PP (Publicaciones Procesales)
 * estados pipeline (PP appears anywhere in cascade). Derived from ROUTING_TABLE.
 */
export const PP_ESTADOS_WORKFLOWS: readonly string[] = Object.entries(ROUTING_TABLE)
  .filter(([, r]) => r.estados.includes("PP"))
  .map(([wt]) => wt);

/**
 * Convenience — categories eligible for the SAMAI_ESTADOS estados pipeline
 * (SAMAI_ESTADOS appears anywhere in cascade — primary for CPACA, fallback for TUTELA).
 */
export const SAMAI_ESTADOS_WORKFLOWS: readonly string[] = Object.entries(ROUTING_TABLE)
  .filter(([, r]) => r.estados.includes("SAMAI_ESTADOS"))
  .map(([wt]) => wt);