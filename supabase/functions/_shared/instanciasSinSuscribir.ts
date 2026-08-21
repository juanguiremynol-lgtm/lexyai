/**
 * instanciasSinSuscribir.ts — ITERATION 60 (A).
 *
 * GCP's sweep discovered 23-digit recurso streams that exist upstream but that
 * nobody subscribed. The endpoint is
 *   GET {cpnu_jobs}/instancias/sin-suscribir
 * and each row is a SUPERIOR-instance key whose base-21 is one of OUR matters.
 *
 * Two rules decide what we do with each row, and both are decisions of
 * doctrine, not of convenience:
 *
 *  1. NEVER create a second work item. The stream is subscribed AGAINST the
 *     base-21 work item (iteration 59). No base ⇒ nothing to attach it to.
 *  2. NEVER re-animate a matter the user closed. `lifecycle_state <> ACTIVE`
 *     means we do not subscribe — but the discovery is NOT discarded: live
 *     activity at a superior on an archived matter is exactly the signal the
 *     user needs to see, so it is recorded as OMITIDO_BASE_INACTIVA.
 *
 * Upstream `base_activa` is advisory only. OUR lifecycle table is the truth;
 * where the two disagree the disagreement itself is recorded.
 */

import { instanciaGradoForConsecutivo, radicadoBase21, type InstanciaGrado } from "./recursoStreams.ts";

export interface InstanciaSinSuscribir {
  radicado_23: string;
  radicado_base_21: string;
  consecutivo: string;
  instancia: InstanciaGrado;
  despacho: string | null;
  fecha_ultima_actuacion_proveedor: string | null;
  descubierto_por: string | null;
  acto_disparador: string | null;
  workflow_type_base: string | null;
  base_activa_upstream: boolean | null;
}

export type SubscriptionDecision =
  | "SUSCRIBIR"
  | "OMITIDO_BASE_INACTIVA"
  /** CC4 — the base matter was deleted by the lawyer. Its appellate suffixes
   *  are not unfinished business: never subscribed, never surfaced. */
  | "OMITIDO_BASE_ELIMINADA"
  | "OMITIDO_SIN_WORK_ITEM"
  | "OMITIDO_ES_PRIMERA_INSTANCIA";


function s(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Parse the upstream envelope. Unusable rows are dropped, never guessed. */
export function parseInstanciasSinSuscribir(body: unknown): InstanciaSinSuscribir[] {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const list = Array.isArray(root.instancias)
    ? root.instancias
    : Array.isArray(root.items)
    ? root.items
    : Array.isArray(body)
    ? (body as unknown[])
    : [];

  const out: InstanciaSinSuscribir[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const rad = (s(r.radicado_23) ?? s(r.radicacion) ?? s(r.radicado) ?? "").replace(/\D/g, "");
    if (rad.length !== 23) continue;

    const declaredBase = (s(r.radicado_base_21) ?? "").replace(/\D/g, "") || null;
    const derivedBase = radicadoBase21(rad);
    // A declared base that contradicts the key is a contract violation: reject
    // the row rather than merge two different processes into one work item.
    if (declaredBase && derivedBase && declaredBase !== derivedBase) continue;
    const base = declaredBase ?? derivedBase;
    if (!base) continue;

    const rawConsec = s(r.instancia) ?? s(r.consecutivo_recurso) ?? s(r.consecutivo);
    const consecutivo = rawConsec && /^\d{1,2}$/.test(rawConsec)
      ? rawConsec.padStart(2, "0")
      : rad.slice(21);

    out.push({
      radicado_23: rad,
      radicado_base_21: base,
      consecutivo,
      instancia: instanciaGradoForConsecutivo(consecutivo),
      despacho: s(r.despacho),
      fecha_ultima_actuacion_proveedor: s(r.fecha_ultima_actuacion_proveedor),
      descubierto_por: s(r.descubierto_por),
      acto_disparador: s(r.acto_disparador),
      workflow_type_base: s(r.workflow_type_base),
      base_activa_upstream: typeof r.base_activa === "boolean" ? r.base_activa : null,
    });
  }
  return out;
}

/**
 * Decide what to do with one discovered instance given OUR base work item.
 * `lifecycleState` is null when no base work item exists.
 */
export function decideSubscription(
  inst: InstanciaSinSuscribir,
  lifecycleState: string | null | undefined,
): SubscriptionDecision {
  if (inst.instancia !== "SEGUNDA") return "OMITIDO_ES_PRIMERA_INSTANCIA";
  if (!lifecycleState) return "OMITIDO_SIN_WORK_ITEM";
  // CC4 — deletion is the lawyer's decision and needs no justification. A
  // deleted base takes its appellate streams with it: not subscribed, and not
  // reported as a signal anywhere.
  if (lifecycleState === "DELETED") return "OMITIDO_BASE_ELIMINADA";
  if (lifecycleState !== "ACTIVE") return "OMITIDO_BASE_INACTIVA";
  return "SUSCRIBIR";
}

/** true when an omitted discovery still deserves the user's attention. */
export function isSilentSuperiorActivity(decision: SubscriptionDecision): boolean {
  return decision === "OMITIDO_BASE_INACTIVA";
}

