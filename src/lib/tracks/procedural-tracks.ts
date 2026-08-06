/**
 * procedural-tracks.ts — "Ejecutivo a continuación" track model (iteration 32, part C).
 *
 * CGP art. 306: when a judgment orders payment of a sum of money, delivery of
 * unsequestered movables or performance of an obligation to do, the creditor
 * asks for execution WITHOUT a new demand, before the SAME judge and inside the
 * SAME file. Same radicado, same expediente — so this cannot be a second work
 * item: a duplicate radicado_base_21 would break the bridge, the matcher and the
 * ledger.
 *
 * It is therefore modelled as an ordered sequence of PROCEDURAL TRACKS on the
 * single work item: [DECLARATIVO (CGP), EJECUTIVO_A_CONTINUACION (EJECUTIVO)].
 * Each track has its own phase catalogue, deadline rules, current phase and
 * start event. Actuaciones and publicaciones keep flowing to the same work item
 * and are attributed to the track that was open on their date.
 */
import type { WorkflowType } from "@/lib/workflow-constants";
import { getWorkflowPhases, mapStageToCanonicalPhase, type CanonicalPhase } from "@/lib/workflow-phases";

export type TrackKind = "DECLARATIVO" | "EJECUTIVO_A_CONTINUACION" | "EJECUTIVO_AUTONOMO";
export type TrackStatus = "ACTIVE" | "CLOSED";

export interface ProceduralTrack {
  id: string;
  work_item_id: string;
  track_kind: TrackKind;
  workflow_type: WorkflowType;
  regimen: string | null;
  sequence_index: number;
  current_phase: string | null;
  status: TrackStatus;
  started_at: string | null;
  closed_at: string | null;
  opened_by_event: string | null;
  notes: string | null;
}

export const TRACK_LABELS: Record<TrackKind, string> = {
  DECLARATIVO: "Declarativo",
  EJECUTIVO_A_CONTINUACION: "Ejecutivo a continuación (art. 306 CGP)",
  EJECUTIVO_AUTONOMO: "Ejecutivo",
};

/** The implicit track every work item has before any transition is recorded. */
export function implicitTrack(
  workItemId: string,
  workflowType: WorkflowType,
  stage: string | null | undefined,
): ProceduralTrack {
  return {
    id: `implicit:${workItemId}`,
    work_item_id: workItemId,
    track_kind: workflowType === "EJECUTIVO" ? "EJECUTIVO_AUTONOMO" : "DECLARATIVO",
    workflow_type: workflowType,
    regimen: null,
    sequence_index: 0,
    current_phase: mapStageToCanonicalPhase(workflowType, stage),
    status: "ACTIVE",
    started_at: null,
    closed_at: null,
    opened_by_event: null,
    notes: null,
  };
}

export function sortTracks(tracks: ProceduralTrack[]): ProceduralTrack[] {
  return [...tracks].sort((a, b) => a.sequence_index - b.sequence_index);
}

export function activeTrack(tracks: ProceduralTrack[]): ProceduralTrack | null {
  const sorted = sortTracks(tracks).filter((t) => t.status === "ACTIVE");
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/** Phase catalogue of the ACTIVE track — stage suggestions must respect it. */
export function activeTrackPhases(tracks: ProceduralTrack[], fallback: WorkflowType): CanonicalPhase[] {
  const track = activeTrack(tracks);
  return getWorkflowPhases(track?.workflow_type ?? fallback);
}

/**
 * Attribute a dated event (actuación / publicación) to the track that was open
 * on its date. Events before the first track's start belong to track 0.
 */
export function trackForDate(tracks: ProceduralTrack[], isoDate: string | null | undefined): ProceduralTrack | null {
  const sorted = sortTracks(tracks);
  if (!sorted.length) return null;
  if (!isoDate) return sorted[0];
  const d = isoDate.slice(0, 10);
  let match = sorted[0];
  for (const t of sorted) {
    if (t.started_at && t.started_at.slice(0, 10) <= d) match = t;
  }
  return match;
}

/* ------------------------------------------------------------------
 * C2 — transition SUGGESTION. Never auto-opens.
 * ------------------------------------------------------------------ */

export interface TrackTransitionSuggestion {
  kind: TrackKind;
  workflowType: WorkflowType;
  message: string;
  citation: string;
  triggerText: string | null;
  triggerDate: string | null;
}

const MANDAMIENTO_RE =
  /(libra|librar|librese|líbrese)\s+mandamiento|mandamiento\s+(ejecutivo\s*)?(de\s*)?pago|mandamiento\s+de\s+pago/i;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Detects "auto que libra mandamiento de pago" inside an existing DECLARATIVE
 * matter and returns a SUGGESTION. The caller renders it as a question; the
 * user confirms. Nothing auto-applies (iteration 19 invariant).
 */
export function suggestEjecutivoAContinuacion(params: {
  workflowType: WorkflowType;
  tracks: ProceduralTrack[];
  latestActText?: string | null;
  latestActDate?: string | null;
  /**
   * ITER37 — the mandamiento must be searched across the recent acts, not only
   * the latest one: a "Fijación Estado" the day after would otherwise mask it
   * and the whole executive path becomes unreachable. Oldest→newest.
   */
  recentActs?: { text: string | null; at: string | null }[];
  /** True when the user recorded that the art. 306 request was filed. */
  art306RequestFiled?: boolean;
}): TrackTransitionSuggestion | null {
  const { workflowType, tracks, latestActText, latestActDate, recentActs, art306RequestFiled } =
    params;
  // Only inside a declarative matter; an autonomous executive matter is already
  // an executive workflow and needs no track.
  if (workflowType === "EJECUTIVO") return null;
  if (tracks.some((t) => t.track_kind === "EJECUTIVO_A_CONTINUACION")) return null;

  const candidates = [
    ...(recentActs ?? []),
    { text: latestActText ?? null, at: latestActDate ?? null },
  ].filter((c) => !!c.text);
  // Most recent mandamiento wins as the trigger.
  const trigger =
    [...candidates].reverse().find((c) => MANDAMIENTO_RE.test(normalize(c.text as string))) ?? null;
  const hasMandamiento = !!trigger;
  if (!hasMandamiento && !art306RequestFiled) return null;

  return {
    kind: "EJECUTIVO_A_CONTINUACION",
    workflowType: "EJECUTIVO",
    message: hasMandamiento
      ? "Se detectó auto que libra mandamiento de pago en un proceso declarativo; ¿abrir seguimiento como ejecutivo a continuación?"
      : "Registró la solicitud de ejecución a continuación (art. 306 CGP); ¿abrir el tramo ejecutivo en este mismo expediente?",
    citation: "CGP, art. 306",
    triggerText: trigger?.text ?? latestActText ?? null,
    triggerDate: trigger?.at ?? latestActDate ?? null,
  };
}

/**
 * C5 — a track change is NOT a stage regression. The monotonic guard of
 * iteration 19 applies WITHIN a track: the executive track legitimately starts
 * at its own beginning (MANDAMIENTO_PAGO) even though the declarative track
 * ended at SENTENCIA.
 */
export function isRegressionAcrossTracks(
  fromTrackId: string | null,
  toTrackId: string | null,
): boolean {
  if (!fromTrackId || !toTrackId) return false;
  return fromTrackId === toTrackId;
}
