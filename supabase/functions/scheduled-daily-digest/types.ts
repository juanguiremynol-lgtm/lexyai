/**
 * Shared shapes for the consolidated daily digest (HH1/HH2/HH3).
 *
 * DOCTRINE — HH2(e): providers establish what the COURT did; firm email
 * evidence establishes what the FIRM did. This digest renders ONLY
 * provider-sourced judicial evidence (work_item_acts / work_item_publicaciones)
 * plus the firm's own calendar (audiencias, términos). Inbound/outbound firm
 * email is deliberately absent: it must never be rendered as a court act.
 */

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

export interface DigestPayload {
  recipientName: string | null;
  windowFrom: string;
  windowTo: string;
  monitoredCount: number;
  silentCount: number;
  actuaciones: ActuacionRow[];
  estados: EstadoRow[];
  hearings: HearingRow[];
  deadlines: DeadlineRow[];
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
