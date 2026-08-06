/**
 * laboral-terms.ts — Laboral regime resolution, TIC notification anchor and
 * "al despacho" suspension (iteration 40).
 *
 * Ley 2452 de 2025 (art. 330) applies only to processes INITIATED on or after
 * 2 April 2026. CSJ Sala Laboral STL9085-2026 settles that the anchor is the
 * FILING of the demand and that the scope is "global y sin ninguna excepción":
 * a matter never mixes regimes — not per stage, not per instance, not per
 * recurso. Corte Constitucional Auto 550 de 2026 ratifies.
 */
import { addBusinessDays } from "@/lib/colombian-holidays";
import {
  LEY_2452_VIGENCIA,
  resolveLaboralRegimen,
  type LaboralRegimen,
} from "@/lib/workflow-phases";
import type { SuspensionWindow, PenalAnchor } from "@/lib/penal906/penal906-terms";
import type { WorkflowDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

export { LEY_2452_VIGENCIA, resolveLaboralRegimen };
export type { LaboralRegimen };

export const LABORAL_REGIMEN_UNKNOWN_MESSAGE =
  "Régimen no determinable — indique la fecha de radicación de la demanda.";

export interface LaboralRegimenResolution {
  regimen: LaboralRegimen | null;
  /** Explanation rendered in the UI; never a guess. */
  basis: string;
  computes: boolean;
}

/**
 * Resolves the regime from the filing date ONLY. Any other input (current
 * stage, instance, recurso date) is deliberately not accepted.
 */
export function resolveLaboralRegimenForMatter(
  filingDate: string | null | undefined,
): LaboralRegimenResolution {
  const regimen = resolveLaboralRegimen(filingDate);
  if (!regimen) {
    return { regimen: null, basis: LABORAL_REGIMEN_UNKNOWN_MESSAGE, computes: false };
  }
  const iso = (filingDate as string).slice(0, 10);
  return {
    regimen,
    basis:
      regimen === "LABORAL_2452"
        ? `Demanda radicada el ${iso}, en vigencia de la Ley 2452 de 2025 (${LEY_2452_VIGENCIA}).`
        : `Demanda radicada el ${iso}, antes del ${LEY_2452_VIGENCIA}: se tramita íntegramente por el CPTSS de 1948 (art. 330 Ley 2452; CSJ STL9085-2026).`,
    computes: true,
  };
}

/**
 * Single-regime filter. Rules of the other regime are dropped outright, so no
 * code path can mix regimes inside one matter.
 */
export function filterRulesToRegimen<T extends Pick<WorkflowDeadlineRule, "regimen">>(
  rules: T[],
  regimen: LaboralRegimen | null,
): T[] {
  if (!regimen) return [];
  return rules.filter((r) => !r.regimen || r.regimen === regimen);
}

function iso(date: string): string {
  return date.slice(0, 10);
}

function plusBusinessDays(isoDate: string, days: number): string {
  return addBusinessDays(new Date(`${isoDate}T00:00:00`), days).toISOString().slice(0, 10);
}

export interface TicNotification {
  /** Date the electronic message was sent. */
  sentAt: string;
  /**
   * Date the initiator received, acknowledged or could otherwise verify
   * delivery. Often unknown — the engine then falls back to the deeming rule.
   */
  acknowledgedAt?: string | null;
}

export interface TicAnchorResult extends PenalAnchor {
  type: "ANCHOR_NOTIFICACION_TIC";
  /** Which of the two moments the date rests on. */
  restsOn: "ACUSE_VERIFICABLE" | "PRESUNCION_2_DIAS";
  basis: string;
}

/**
 * Two-stage TIC computation (arts. 208/209 Ley 2452 de 2025):
 *   send → +2 business days = deemed notified;
 *   terms run from the day AFTER acknowledgement / verifiable delivery.
 * When acknowledgement is unknown we use the deeming date and say so.
 */
export function resolveTicAnchor(
  notification: TicNotification,
  event = "NOTIFICACION_PERSONAL_TIC",
): TicAnchorResult {
  const sent = iso(notification.sentAt);
  const deemed = plusBusinessDays(sent, 2);
  const ack = notification.acknowledgedAt ? iso(notification.acknowledgedAt) : null;
  const base = ack ?? deemed;
  const start = plusBusinessDays(base, 1);
  return {
    type: "ANCHOR_NOTIFICACION_TIC",
    event,
    date: start,
    restsOn: ack ? "ACUSE_VERIFICABLE" : "PRESUNCION_2_DIAS",
    basis: ack
      ? `Mensaje enviado el ${sent}; acuse verificable el ${ack}; el término corre desde el día siguiente (${start}).`
      : `Mensaje enviado el ${sent}; sin acuse verificable, la notificación se entiende surtida a los 2 días hábiles (${deemed}) y el término corre desde el día siguiente (${start}).`,
  };
}

const AL_DESPACHO_RE = /\bal\s+despacho\b|paso\s+al\s+despacho|ingres[oa]\s+al\s+despacho/i;
const A_SECRETARIA_RE = /\ba\s+secretari[ao]\b|sali[oó]\s+del\s+despacho|paso\s+a\s+secretaria/i;

function normalize(text: string): string {
  return (text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Derives "al despacho" suspension windows from the act record (art. 324:
 * terms do not run while the file is al despacho). A window with no return act
 * stays open-ended, and the engine then refuses to compute a date.
 */
export function deriveAlDespachoSuspensions(
  events: { at: string; text: string }[],
): SuspensionWindow[] {
  const sorted = [...events]
    .filter((e) => !!e.at)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const out: SuspensionWindow[] = [];
  let open: string | null = null;
  for (const e of sorted) {
    const text = normalize(e.text);
    if (open === null && AL_DESPACHO_RE.test(text)) {
      open = iso(e.at);
    } else if (open !== null && A_SECRETARIA_RE.test(text)) {
      out.push({ from: open, until: iso(e.at), reason: "Expediente al despacho (art. 324)" });
      open = null;
    }
  }
  if (open !== null) {
    out.push({ from: open, until: null, reason: "Expediente al despacho (art. 324) — sin retorno a secretaría" });
  }
  return out;
}
