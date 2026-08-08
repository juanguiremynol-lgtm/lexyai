/**
 * clase-motivo.ts — ITERATION 45.
 *
 * Frontend mirror of `public.clase_motivo_catalogo`. The provider says WHY a
 * clase de proceso is absent, and the distinction that matters to the user is
 * not the wording but whether a retry can change the answer:
 *
 *   · "no existe en el proveedor" and "detalle no expuesto" are CONCLUSIONS —
 *     retrying them forever manufactures a fake incident;
 *   · "aún no consultado", "lectura fallida" and "detalle no disponible" are
 *     INTERRUPTIONS — a retry is legitimate and is offered.
 *
 * ITER45: what the provider reports is that the detail is NOT EXPOSED. Calling
 * that "reserva sumarial" attributes a legal cause we cannot verify — reserva
 * is one possible cause among several (a restricted matter, a portal ACL, a
 * partial publication). We report the observation, not the interpretation.
 */

export interface ClaseMotivoInfo {
  label: string;
  descripcion: string;
  accionable: boolean;
}

export const CLASE_MOTIVO_CATALOGO: Record<string, ClaseMotivoInfo> = {
  PROCESO_PRIVADO: {
    label: "Detalle no expuesto por el proveedor",
    descripcion:
      "El proveedor alcanza el proceso y valida el radicado, pero no expone el detalle. La causa no está declarada: puede ser una restricción legal, una configuración del portal o una publicación parcial. No es una falla del sistema.",
    accionable: false,
  },
  PROCESO_NO_ENCONTRADO_EN_PROVEEDOR: {
    label: "No existe en el proveedor",
    descripcion: "El proveedor consultó y no halló el radicado. Reintentar no lo hace aparecer.",
    accionable: false,
  },
  NO_CONSULTADO_AUN: {
    label: "Aún no consultado",
    descripcion: "El proveedor todavía no ha leído la clase de este radicado.",
    accionable: true,
  },
  LECTURA_FALLIDA: {
    label: "Lectura fallida",
    descripcion: "La consulta al detalle falló por causa técnica. Un reintento puede resolverla.",
    accionable: true,
  },
  DETALLE_NO_DISPONIBLE: {
    label: "Detalle no disponible",
    descripcion: "El endpoint de detalle no respondió con la ficha del proceso.",
    accionable: true,
  },
  PROVIDER_UNAVAILABLE: {
    label: "Proveedor no disponible",
    descripcion: "Motivo heredado: el proveedor no pudo alcanzar el detalle.",
    accionable: true,
  },
  CONTRACT_BLOCK_ABSENT: {
    label: "Bloque de contrato ausente",
    descripcion: "Respuesta degradada: el bloque de clase no vino. Lectura no concluyente.",
    accionable: true,
  },
};

export function claseMotivoInfo(motivo: string | null | undefined): ClaseMotivoInfo | null {
  if (!motivo) return null;
  return CLASE_MOTIVO_CATALOGO[motivo.trim().toUpperCase()] ?? null;
}

export function claseMotivoLabel(motivo: string | null | undefined): string {
  return claseMotivoInfo(motivo)?.label ?? (motivo ?? "Sin motivo declarado");
}

/** Unknown motives are NOT retryable: we never invite an action we can't justify. */
export function isClaseMotivoAccionable(motivo: string | null | undefined): boolean {
  return claseMotivoInfo(motivo)?.accionable === true;
}

/**
 * A non-exposed detail whose revalidation is older than its TTL is itself a
 * warning: an unrefreshed observation is indistinguishable from a matter we
 * simply stopped reading.
 *
 * ITER45 — the TTL is ONE day, not seven. Exposure can change from one day to
 * the next, so a week-old reading is not a current fact about the matter.
 */
export const DETALLE_EXPOSICION_TTL_DIAS = 1;

export function isRevalidacionVencida(
  ultimaVerificacion: string | null | undefined,
  ttlDays: number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!ultimaVerificacion) return true;
  const t = Date.parse(ultimaVerificacion);
  if (Number.isNaN(t)) return true;
  const ttl = ttlDays && ttlDays > 0 ? ttlDays : DETALLE_EXPOSICION_TTL_DIAS;
  return now.getTime() - t > ttl * 24 * 60 * 60 * 1000;
}
