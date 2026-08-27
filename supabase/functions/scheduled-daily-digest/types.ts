/**
 * Shared shapes for the consolidated daily digest (HH1/HH2/HH3).
 *
 * DOCTRINE — HH2(e): providers establish what the COURT did; firm email
 * evidence establishes what the FIRM did. This digest renders ONLY
 * provider-sourced judicial evidence (work_item_acts / work_item_publicaciones)
 * plus the firm's own calendar (audiencias, términos). Inbound/outbound firm
 * email is deliberately absent: it must never be rendered as a court act.
 */

/**
 * KK3 — document presence is THREE states, never two.
 * The provider returns COALESCE(documentos,'[]'), so an empty list means
 * either "no documents" or "nobody asked". Only the observation timestamp
 * (actuaciones) / an explicit availability flag (estados) separates them.
 */
export type DocumentAvailability = "DISPONIBLE" | "SIN_DOCUMENTO" | "NO_CONSULTADO";

/** An act in the expediente. Distinct evidence class from an estado. */
export interface ActuacionRow {
  id: string;
  work_item_id: string;
  /** Provider that established the act. */
  source: string | null;
  act_date: string | null;
  detected_at: string | null;
  description: string | null;
  act_type: string | null;
  annotation: string | null;
  despacho: string | null;
  documents: DigestDocument[];
  document_availability: DocumentAvailability;
}

/** A publication fixed on the list. Distinct evidence class from an actuación. */
export interface EstadoRow {
  id: string;
  work_item_id: string;
  /** Provider that published the estado. */
  source: string | null;
  title: string | null;
  fecha_fijacion: string | null;
  fecha_actuacion: string | null;
  detected_at: string | null;
  observacion: string | null;
  documents: DigestDocument[];
  document_availability: DocumentAvailability;
}

export interface DigestDocument {
  label: string;
  /** Tokenised download URL served by the `digest-document` function. */
  url: string;
}



export interface HearingRow {
  id: string;
  work_item_id: string;
  title: string | null;
  scheduled_at: string;
  location: string | null;
  is_virtual: boolean | null;
  virtual_link: string | null;
}

export interface DeadlineRow {
  id: string;
  work_item_id: string;
  label: string | null;
  deadline_type: string | null;
  deadline_date: string;
  status: string;
  overdue: boolean;
  days_left: number;
  /** NN2 — computed by `public.v_deadline_attribution`, never re-derived here. */
  attribution: "PROPIO" | "CONTRAPARTE" | "JUEZ" | "DESCONOCIDO" | string;
  bound_party_role: string | null;
}

export const BOUND_PARTY_SHORT: Record<string, string> = {
  DEMANDANTE: "demandante",
  DEMANDADO: "demandado",
  RECURRENTE: "recurrente",
  OPOSITOR: "no recurrente",
  JUEZ: "despacho",
  AMBAS: "ambas partes",
  DESCONOCIDO: "parte no determinada",
};

export interface WorkItemInfo {
  id: string;
  title: string | null;
  radicado: string | null;
  authority_name: string | null;
  demandantes: string | null;
  demandados: string | null;
  workflow_type: string | null;
  /** LL1(a) — clase de proceso as reported by the provider / registry. */
  clase_proceso: string | null;
  last_successful_sync_at: string | null;
  /**
   * LL1(b) — live, non-archived tallies per provider, computed from Supabase's
   * own act/publication rows. Acts and estados stay in separate buckets (HH2).
   */
  providerCounts?: {
    acts: Record<string, number>;
    estados: Record<string, number>;
  };
  /**
   * YY2 — one sentence describing how THIS court behaves, derived from
   * `public.despacho_behavior_statement`. Never hand-written, never shown
   * unless the profile reached the evidence threshold.
   */
  courtBehavior?: string | null;
}

/**
 * YY3 — a finding recovered after a collection defect. It is reconciliation,
 * not novedad: delivered exactly once and never counted with the day's news.
 */
export interface ReconciliationNoticeRow {
  id: string;
  work_item_id: string | null;
  headline: string;
  detail: string;
  rows_count: number;
  from_date: string | null;
  to_date: string | null;
}

/**
 * JJ1(c) — the firm-side evidence channel. An expired mailbox connection means
 * the class of evidence that proves what the FIRM did is blind. It is rendered
 * at the very top of the digest, never as a background condition.
 */
export interface ConnectionIssueRow {
  mailbox: string | null;
  status: string;
  severity: "CRITICAL" | "WARNING";
  headline: string;
  detail: string;
  since: string | null;
}

/**
 * OO1 — matters hidden from this digest by `monitoring_suspended_at`.
 *
 * SEMANTICS (OO2a): `monitoring_suspended_at` gates VISIBILITY only. The
 * provider is still consulted and everything it publishes is still stored,
 * as long as `lifecycle_state = 'ACTIVE'` (which is what gates INGESTION).
 * `reading_active` carries that distinction into the render: when it is false
 * a real gap IS accumulating for that matter and the row must say so.
 */
export interface SuspendedItemRow {
  id: string;
  radicado: string | null;
  title: string | null;
  workflow_type: string | null;
  suspended_at: string | null;
  reason: string | null;
  /** lifecycle_state === 'ACTIVE' → the provider is still being read. */
  reading_active: boolean;
  lifecycle_state: string | null;
  /** Movement accumulated since the suspension date (by event date). */
  acts_since: number;
  estados_since: number;
  last_movement_at: string | null;
}


/** JJ3 — PETICION / GOV_PROCEDURE are not judicial and get no scraper. */
export const NON_JUDICIAL_WORKFLOWS = ["PETICION", "GOV_PROCEDURE"] as const;

export function isNonJudicial(wt: string | null | undefined): boolean {
  return !!wt && (NON_JUDICIAL_WORKFLOWS as readonly string[]).includes(wt);
}

/**
 * D3 — a matter whose provider history landed inside the digest window
 * because it was read for the first time (or reactivated). These rows are
 * NOT novedades: they are the expediente's past arriving late.
 */
export interface ImportedHistoryRow {
  work_item_id: string;
  rows: number;
  acts: number;
  estados: number;
  from_year: number | null;
  to_year: number | null;
}

export interface DigestPayload {
  recipientName: string | null;
  windowFrom: string;
  windowTo: string;
  /** Judicial matters under provider monitoring. */
  monitoredCount: number;
  /** JJ3(d) — counted separately, NEVER merged with the judicial figure. */
  nonJudicialCount: number;
  silentCount: number;
  actuaciones: ActuacionRow[];
  estados: EstadoRow[];
  hearings: HearingRow[];
  deadlines: DeadlineRow[];
  /** JJ3(b) — deadlines of non-judicial matters, in their own section. */
  nonJudicialDeadlines: DeadlineRow[];
  /** D3 — rows detected in the window that are initial import, not novedad. */
  importedHistory: ImportedHistoryRow[];
  /** YY3 — one-time reconciliation notices pending delivery. */
  reconciliations: ReconciliationNoticeRow[];

  connectionIssues: ConnectionIssueRow[];
  suspended: SuspendedItemRow[];
  /**
   * TT6 — collection quality per source for this window. The digest may state
   * an unqualified "sin novedades" only while every entry is `authoritative`.
   */
  sourceQuality: SourceQualityRow[];
  /** true when at least one source did not reach authoritative coverage. */
  coverageIncomplete: boolean;
  workItems: Map<string, WorkItemInfo>;
  appBaseUrl: string;
  linkExpiryDays: number;
}

/**
 * TT5 — per-source collection accounting, as returned by
 * `public.source_collection_quality`. `usable_confirmed_count` counts answered
 * reads only (success + success_empty + not_found); PENDING_UPSTREAM never
 * counts as coverage.
 */
export interface SourceQualityRow {
  source: string;
  label: string;
  expected_count: number;
  attempted_count: number;
  usable_confirmed_count: number;
  success_count: number;
  success_empty_count: number;
  not_found_count: number;
  /** Provider answered that the process is private; not authoritative coverage. */
  restricted_count: number;
  pending_upstream_count: number;
  error_count: number;
  state:
    | "SOURCE_HEALTHY_COMPLETE"
    | "SOURCE_HEALTHY_WITH_NOT_FOUND"
    | "SOURCE_DEGRADED_PARTIAL"
    | "SOURCE_DEGRADED_SYSTEMIC"
    | "SOURCE_RUN_FAILED"
    | "SOURCE_STALE";
  /** TT6 — may a zero count on this source be read as "sin novedades"? */
  authoritative: boolean;
  /**
   * YY1(e) — the denominator BEFORE the learned despacho profiles removed the
   * matters whose court is evidenced not to use this channel, and how many
   * they removed. Both travel to the reader: a profile may never shrink the
   * portfolio silently.
   */
  expected_before_profile?: number;
  excluded_by_profile?: number;
}


/**
 * HH2(b)/(c) — provider labels. The digest names the source explicitly; it
 * never says "el sistema" or collapses two providers into one word.
 */
export const ESTADO_SOURCE_LABELS: Record<string, string> = {
  publicaciones: "Publicaciones Procesales",
  samai_estados: "SAMAI Estados",
};

export const ACTUACION_SOURCE_LABELS: Record<string, string> = {
  cpnu: "CPNU",
  samai: "SAMAI",
  icarus_import: "Importación Icarus",
  manual: "Registro manual",
};

export function estadoSourceLabel(source: string | null | undefined): string {
  if (!source) return "Fuente no registrada";
  return ESTADO_SOURCE_LABELS[source] ?? source;
}

export function actuacionSourceLabel(source: string | null | undefined): string {
  if (!source) return "Fuente no registrada";
  return ACTUACION_SOURCE_LABELS[source] ?? source;
}
