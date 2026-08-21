/**
 * providerStrategy.ts — Centralized provider selection rules per work item category.
 * 
 * Single source of truth used by:
 * - sync-by-radicado (wizard LOOKUP + SYNC_AND_APPLY)
 * - sync-by-work-item (ongoing sync)
 * - providerCoverageMatrix.ts (compatibility gates)
 *
 * ┌────────────┬──────────────────────────────┬──────────────────────────────┐
 * │ Category   │ Actuaciones (primary→fallback)│ Estados (primary→fallback)   │
 * ├────────────┼──────────────────────────────┼──────────────────────────────┤
 * │ CGP        │ CPNU → SAMAI, TUTELAS        │ PUBLICACIONES → SAMAI_EST,TUT│
 * │ LABORAL    │ CPNU → SAMAI, TUTELAS        │ PUBLICACIONES → SAMAI_EST,TUT│
 * │ CPACA      │ SAMAI → CPNU, TUTELAS        │ SAMAI_ESTADOS → PUBS, TUT    │
 * │ TUTELA     │ ALL (merge all)              │ ALL (merge all)              │
 * │ INDETERMIN.│ CPNU + SAMAI (merge)         │ PUBS + SAMAI_EST (merge)     │
 * │ PENAL_906  │ CPNU → TUTELAS, SAMAI        │ PUBLICACIONES → SAMAI_EST,TUT│
 * │ PETICION   │ (none)                       │ (none)                       │
 * │ GOV_PROC   │ (none)                       │ (none)                       │
 * └────────────┴──────────────────────────────┴──────────────────────────────┘
 *
 * Found semantics:
 *   FOUND_COMPLETE  — match + actuaciones/estados retrieved
 *   FOUND_PARTIAL   — match (metadata/parties) but some endpoints failed/timed out
 *   NOT_FOUND       — no provider returned a match for this radicado
 */

export type ProviderKey = "CPNU" | "SAMAI" | "TUTELAS" | "PUBLICACIONES" | "SAMAI_ESTADOS";

/**
 * Outcome of consulting the provider set for one data kind.
 *
 *   FOUND_COMPLETE  — match + actuaciones/estados retrieved
 *   FOUND_PARTIAL   — match (metadata/parties) but some endpoints failed/timed out
 *   NOT_FOUND       — every provider ANSWERED and none had the radicado (incl. empty)
 *   UNAVAILABLE     — no provider ever answered: timeout, 5xx, network error or
 *                     rate limit. This is NOT an absence of judicial activity.
 *                     It is an absence of knowledge and must never be collapsed
 *                     into NOT_FOUND, because NOT_FOUND authorises fallback and
 *                     reports "sin novedades" to the lawyer.
 */
export type FoundStatus = "FOUND_COMPLETE" | "FOUND_PARTIAL" | "NOT_FOUND" | "UNAVAILABLE";

/**
 * Error codes that mean "the provider did not answer", as opposed to
 * "the provider answered and had nothing".
 *
 * Retry semantics and fallback semantics are SEPARATE: these codes justify
 * retrying the SAME provider, they never justify accepting a DIFFERENT
 * provider's answer as complete.
 */
export const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "PROVIDER_TIMEOUT",
  "FORCED_TIMEOUT",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
  "PROVIDER_ERROR",
  "PROVIDER_RATE_LIMITED",
  "SCRAPING_STUCK",
  "UPSTREAM_ROUTE_MISSING",
  "UNKNOWN_ERROR",
]);

/** True when the code means the provider never delivered an answer. */
export function isTransientProviderFailure(code: string | null | undefined): boolean {
  if (!code) return false;
  return TRANSIENT_ERROR_CODES.has(code);
}

/**
 * Codes that mean the provider ANSWERED and had nothing for this radicado.
 * Only these authorise the NOT_FOUND verdict (and therefore fallback).
 */
export const ANSWERED_ABSENCE_CODES: ReadonlySet<string> = new Set([
  "NOT_FOUND",
  "PROVIDER_NOT_FOUND",
  "RADICADO_NOT_FOUND",
  "PROVIDER_EMPTY_RESULT",
  "EMPTY",
  "NO_RESULTS",
]);

export function isAnsweredAbsence(code: string | null | undefined): boolean {
  if (!code) return false;
  return ANSWERED_ABSENCE_CODES.has(code);
}

/** A transient failure may justify retrying the SAME provider. */
export const isRetryableSameProvider = isTransientProviderFailure;

/* ────────────────────────────────────────────────────────────────────────────
 * AA1 — GCP HTTP contract → attempt outcome.
 *
 * GCP's scraper distinguishes silence from absence, and that distinction was
 * being discarded upstream. The mapping is EXPLICIT — never inferred from body
 * shape when an explicit field exists:
 *
 *   500 + success:false               → UNAVAILABLE  (provider never answered)
 *   200 + success:true  + found:false → ANSWERED_ABSENCE (genuine not-found)
 *   200 + success:true  + found:true  → ANSWERED_DATA
 *   404 "Job no encontrado"           → UNAVAILABLE  (job store lost the job to
 *                                       autoscaling; retry the SAME provider)
 *   404 (any other)                   → ANSWERED_ABSENCE
 *   429 / 5xx / network               → UNAVAILABLE
 *   200 + success:false               → UNAVAILABLE  (explicit failure flag wins)
 * ────────────────────────────────────────────────────────────────────────── */

export type GcpOutcome =
  | "ANSWERED_DATA"
  | "ANSWERED_ABSENCE"
  /** BB3c — the provider answered that the matter exists but is legally
   *  restricted (reserva / proceso privado). This is NOT an absence: nothing
   *  is missing, the detail is lawfully withheld. It never authorises a
   *  fallback and it must never be recorded as EMPTY. */
  | "RESTRICTED_BY_PROVIDER"
  | "UNAVAILABLE"
  | "UNCLASSIFIED";

export interface GcpResponseShape {
  httpStatus: number | null | undefined;
  success?: boolean | null;
  found?: boolean | null;
  message?: string | null;
  /** GCP scraper rev. 00024-kiw: explicit reason a matter yielded no detail. */
  motivoAusencia?: string | null;
}

const JOB_LOST_RE = /job\s+no\s+encontrad|job\s+not\s+found/i;
const RESTRICTED_RE = /proceso[_\s-]?privado|reserva/i;

export function classifyGcpResponse(r: GcpResponseShape): {
  outcome: GcpOutcome;
  errorCode: string | null;
  reason: string;
} {
  const s = r.httpStatus ?? null;

  // The explicit reason field is authoritative wherever it appears — a
  // restricted matter is an answer, not silence and not an absence.
  if (RESTRICTED_RE.test(r.motivoAusencia ?? "")) {
    return {
      outcome: "RESTRICTED_BY_PROVIDER",
      errorCode: "PROCESO_PRIVADO",
      reason: `motivoAusencia=${r.motivoAusencia}`,
    };
  }


  if (s === 404 && JOB_LOST_RE.test(r.message ?? "")) {
    return { outcome: "UNAVAILABLE", errorCode: "PROVIDER_JOB_LOST", reason: "404 job store lost the job (autoscaling)" };
  }
  if (s === 404) {
    return { outcome: "ANSWERED_ABSENCE", errorCode: "PROVIDER_NOT_FOUND", reason: "404 answered absence" };
  }
  if (s === 429) {
    return { outcome: "UNAVAILABLE", errorCode: "PROVIDER_RATE_LIMITED", reason: "429 rate limited" };
  }
  if (s !== null && s >= 500) {
    return { outcome: "UNAVAILABLE", errorCode: "UPSTREAM_ERROR", reason: `${s} + success:${r.success ?? "n/a"}` };
  }
  if (s === null) {
    return { outcome: "UNAVAILABLE", errorCode: "NETWORK_ERROR", reason: "no HTTP response" };
  }
  if (s >= 200 && s < 300) {
    // The explicit success flag is authoritative when present.
    if (r.success === false) {
      return { outcome: "UNAVAILABLE", errorCode: "PROVIDER_ERROR", reason: "200 + success:false" };
    }
    if (r.success === true || r.success == null) {
      if (r.found === false) {
        return { outcome: "ANSWERED_ABSENCE", errorCode: "PROVIDER_NOT_FOUND", reason: "200 + success:true + found:false" };
      }
      return { outcome: "ANSWERED_DATA", errorCode: null, reason: "200 + success:true" };
    }
  }
  if (s === 401 || s === 403) {
    return { outcome: "UNAVAILABLE", errorCode: "UPSTREAM_AUTH", reason: `${s} auth rejected` };
  }
  return { outcome: "UNCLASSIFIED", errorCode: "UNCLASSIFIED_PROVIDER_SHAPE", reason: `unmapped HTTP ${s}` };
}

/**
 * UNCLASSIFIED must never be optimistically read as an absence — an unmapped
 * shape asserts nothing, so it is handled exactly like UNAVAILABLE and is
 * surfaced for review.
 */
export function gcpOutcomeAuthorisesFallback(o: GcpOutcome): boolean {
  return o === "ANSWERED_ABSENCE";
}



export interface CategoryStrategy {
  /** If true, query all providers in parallel and merge. Used for TUTELA. */
  alwaysMergeAll: boolean;
  /** Primary providers for actuaciones + basic metadata (despacho, parties, fecha) */
  primaryActuaciones: ProviderKey[];
  /** Fallback providers for actuaciones (queried only if ALL primaries return NOT_FOUND) */
  fallbackActuaciones: ProviderKey[];
  /** Primary providers for estados tab */
  primaryEstados: ProviderKey[];
  /** Fallback providers for estados (queried only if ALL primaries return NOT_FOUND) */
  fallbackEstados: ProviderKey[];
}

const STRATEGY_MAP: Record<string, CategoryStrategy> = {
  CGP: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["SAMAI", "TUTELAS"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
  LABORAL: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["SAMAI", "TUTELAS"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
  CPACA: {
    alwaysMergeAll: false,
    primaryActuaciones: ["SAMAI"],
    fallbackActuaciones: ["CPNU", "TUTELAS"],
    primaryEstados: ["SAMAI_ESTADOS"],
    fallbackEstados: ["PUBLICACIONES", "TUTELAS"],
  },
  TUTELA: {
    alwaysMergeAll: true,
    primaryActuaciones: ["CPNU", "SAMAI", "TUTELAS"],
    fallbackActuaciones: [],
    primaryEstados: ["PUBLICACIONES", "SAMAI_ESTADOS", "TUTELAS"],
    fallbackEstados: [],
  },
  PENAL_906: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["TUTELAS", "SAMAI"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
  // Subject matter not determined yet (mixed-competence court). Monitoring
  // stays active and merges every provider, exactly like TUTELA.
  INDETERMINADO: {
    alwaysMergeAll: true,
    primaryActuaciones: ["CPNU", "SAMAI"],
    fallbackActuaciones: ["TUTELAS"],
    primaryEstados: ["PUBLICACIONES", "SAMAI_ESTADOS"],
    fallbackEstados: ["TUTELAS"],
  },
  PETICION: {
    alwaysMergeAll: false,
    primaryActuaciones: [],
    fallbackActuaciones: [],
    primaryEstados: [],
    fallbackEstados: [],
  },
  GOV_PROCEDURE: {
    alwaysMergeAll: false,
    primaryActuaciones: [],
    fallbackActuaciones: [],
    primaryEstados: [],
    fallbackEstados: [],
  },
};

/**
 * Returns the provider strategy for a given category/workflow_type.
 */
export function getCategoryStrategy(workflowType: string): CategoryStrategy {
  return STRATEGY_MAP[workflowType] || STRATEGY_MAP["CGP"];
}

/**
 * Determines the FoundStatus based on provider results.
 *
 * @param hasMetadataMatch - At least one provider returned a radicado match (parties/despacho/fecha)
 * @param hasActuaciones - At least one provider returned actuaciones/estados data
 * @param allProvidersFailed - No provider ever answered (timeout/5xx/network/rate limit)
 */
export function determineFoundStatus(
  hasMetadataMatch: boolean,
  hasActuaciones: boolean,
  allProvidersFailed: boolean,
): FoundStatus {
  // A run where nobody answered asserts nothing about the expediente.
  if (allProvidersFailed && !hasMetadataMatch && !hasActuaciones) return "UNAVAILABLE";
  if (!hasMetadataMatch && !hasActuaciones) return "NOT_FOUND";
  if (hasMetadataMatch && hasActuaciones) return "FOUND_COMPLETE";
  // Has metadata but no actuaciones (e.g., CPNU returned parties but actuaciones 406)
  return "FOUND_PARTIAL";
}

/**
 * Determines if fallback should trigger.
 *
 * Founding invariant: fallback advances ONLY on an ANSWERED absence —
 * NOT_FOUND (which subsumes an empty answer). It must NEVER advance on
 * UNAVAILABLE, because accepting another provider's answer after the primary
 * failed to answer converts "we could not ask" into "there are no novedades".
 * FOUND_PARTIAL does NOT trigger fallback either.
 */
export function shouldTriggerFallback(primaryStatus: FoundStatus): boolean {
  return primaryStatus === "NOT_FOUND";
}


/**
 * Returns all unique provider keys for a category (for Tutela: all providers).
 */
export function getAllProvidersForCategory(workflowType: string): ProviderKey[] {
  const strategy = getCategoryStrategy(workflowType);
  const all = new Set<ProviderKey>([
    ...strategy.primaryActuaciones,
    ...strategy.fallbackActuaciones,
    ...strategy.primaryEstados,
    ...strategy.fallbackEstados,
  ]);
  return Array.from(all);
}
