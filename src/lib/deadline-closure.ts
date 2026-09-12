/**
 * deadline-closure — LV2/LV4. What a closed or uncomputed term actually says.
 *
 * `FULFILLED_BY_EMAIL_EVIDENCE` was carrying three unrelated facts under one
 * name: a term an email closed, a term that expired before the engine existed,
 * and a term whose expiry was found by back-detection. Only the first involves
 * evidence at all, and even that evidence is correspondence — the lawyer wrote
 * to the court, which is not the same as discharging the term. The other two
 * must never claim evidence.
 *
 * A term with no `deadline_date` is a fourth case: it was never computed, so it
 * is neither fulfilled, nor expired, nor pending, and it stays out of every
 * count that implies a live deadline.
 */

export const CLOSURE_LABELS: Record<string, string> = {
  CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR: "CERRADO POR CORRESPONDENCIA — SIN VERIFICAR",
  VENCIDO_ANTES_DEL_MOTOR: "VENCIDO ANTES DEL MOTOR",
  VENCIDO_RETRODETECTADO: "VENCIDO — DETECTADO DESPUÉS",
};

export const CLOSURE_EXPLANATIONS: Record<string, string> = {
  CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR:
    "Se cerró porque se envió un correo al despacho dentro de la ventana del término. " +
    "Eso es correspondencia, no constancia de cumplimiento. Confírmelo o reábralo usted.",
  VENCIDO_ANTES_DEL_MOTOR:
    "El término ya estaba vencido cuando el motor empezó a calcular. No lo cerró ninguna evidencia.",
  VENCIDO_RETRODETECTADO:
    "El vencimiento se detectó después, al revisar hacia atrás. No lo cerró ninguna evidencia.",
};

export const SIN_FECHA_LABEL = "SIN FECHA — REQUIERE REVISIÓN";
export const SIN_FECHA_EXPLANATION =
  "El término no tiene fecha de vencimiento calculada: no se computó. " +
  "No está vencido ni corriendo, y no se cuenta como término vivo.";

/** The three statuses the old single status was hiding. */
export const CLOSURE_STATUSES = Object.keys(CLOSURE_LABELS);

export function isClosureStatus(status: string | null | undefined): boolean {
  return !!status && status in CLOSURE_LABELS;
}

/** Only correspondence closures are his to confirm or reopen. */
export function isCorrespondenceClosure(status: string | null | undefined): boolean {
  return status === "CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR";
}

/** A term that was never computed. Never counted as live. */
export function isUncomputed(d: { deadline_date: string | null }): boolean {
  return !d.deadline_date;
}
