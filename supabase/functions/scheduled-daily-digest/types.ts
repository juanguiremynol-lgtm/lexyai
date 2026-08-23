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
}

export interface WorkItemInfo {
  id: string;
  title: string | null;
  radicado: string | null;
  authority_name: string | null;
  demandantes: string | null;
  demandados: string | null;
  workflow_type: string | null;
  last_successful_sync_at: string | null;
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
 * JJ2(c) — matters the lawyer believes are monitored and are NOT. This is a
 * section ABOUT their absence; they never appear in novedades.
 */
export interface SuspendedItemRow {
  id: string;
  radicado: string | null;
  title: string | null;
  workflow_type: string | null;
  suspended_at: string | null;
  reason: string | null;
}

/** JJ3 — PETICION / GOV_PROCEDURE are not judicial and get no scraper. */
export const NON_JUDICIAL_WORKFLOWS = ["PETICION", "GOV_PROCEDURE"] as const;

export function isNonJudicial(wt: string | null | undefined): boolean {
  return !!wt && (NON_JUDICIAL_WORKFLOWS as readonly string[]).includes(wt);
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
  connectionIssues: ConnectionIssueRow[];
  suspended: SuspendedItemRow[];
  workItems: Map<string, WorkItemInfo>;
  appBaseUrl: string;
  linkExpiryDays: number;
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
