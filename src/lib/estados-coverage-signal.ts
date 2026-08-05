/**
 * Iteration 33 — "actuaciones without estados" as a first-class signal.
 *
 * Doctrine: a work item of ANY workflow that receives actuaciones from an
 * external provider but holds zero estados/publicaciones from the corresponding
 * estados provider is suspect until proven otherwise. Silence from the estados
 * side is not evidence that no estado exists.
 *
 * Only the first class is anomalous: a "fijación en estado" in the acts stream
 * is positive proof that an estado was posted. Everything else is inconclusive
 * (visible, never alerted) or expected silence.
 *
 * This module mirrors the SQL classifier `classify_work_item_estados_signal`.
 */

export type EstadosSignalClass =
  | "CUBIERTO"
  | "ESTADOS_ESPERADOS_AUSENTES"
  | "ESTADOS_SIN_FIJACION_CONOCIDA"
  | "SIN_COBERTURA_DECLARADA";

export interface EstadosSignal {
  work_item_id: string;
  workflow_type: string | null;
  radicado: string | null;
  despacho: string | null;
  signal_class: EstadosSignalClass;
  estados_provider: string | null;
  acts_count: number;
  pubs_count: number;
  fijacion_count: number;
  unmatched_fijacion_count: number;
  recent_unmatched_count: number;
  last_fijacion_date: string | null;
  evidence: { unmatched_fijaciones?: Array<{ act_id: string; act_date: string | null; title?: string | null }> };
  computed_at: string;
}

export const ESTADOS_SIGNAL_LABEL: Record<EstadosSignalClass, string> = {
  CUBIERTO: "Cubierto",
  ESTADOS_ESPERADOS_AUSENTES: "Estados esperados y ausentes",
  ESTADOS_SIN_FIJACION_CONOCIDA: "Sin fijación conocida",
  SIN_COBERTURA_DECLARADA: "Silencio esperado",
};

export const ESTADOS_SIGNAL_EXPLANATION: Record<EstadosSignalClass, string> = {
  CUBIERTO:
    "Las fijaciones registradas en las actuaciones tienen su estado publicado correspondiente.",
  ESTADOS_ESPERADOS_AUSENTES:
    "Las actuaciones registran una fijación en estado, pero el proveedor de estados no entregó la publicación correspondiente. Se trata como anomalía real.",
  ESTADOS_SIN_FIJACION_CONOCIDA:
    "Hay actuaciones pero ninguna fijación registrada y ningún estado recibido. No es concluyente: queda en observación, sin alerta.",
  SIN_COBERTURA_DECLARADA:
    "El despacho está declarado como no publicador de estados electrónicos. El silencio es esperado.",
};

export function estadosSignalTone(cls: EstadosSignalClass): string {
  switch (cls) {
    case "CUBIERTO":
      return "border-emerald-500/50 text-emerald-600";
    case "ESTADOS_ESPERADOS_AUSENTES":
      return "border-amber-500/60 text-amber-600";
    case "ESTADOS_SIN_FIJACION_CONOCIDA":
      return "border-slate-400/50 text-slate-500";
    case "SIN_COBERTURA_DECLARADA":
      return "border-sky-500/50 text-sky-600";
    default:
      return "border-muted-foreground/40 text-muted-foreground";
  }
}

/** Only a source that normally answers and stopped is anomalous. */
export function estadosSignalAlerts(signal: Pick<EstadosSignal, "signal_class" | "recent_unmatched_count">): boolean {
  return signal.signal_class === "ESTADOS_ESPERADOS_AUSENTES" && signal.recent_unmatched_count > 0;
}

const FIJACION_RE = /fijaci[oó]n\s+(en\s+)?estado|fijacion\s+estado|fijado\s+en\s+estado/i;

/** Mirror of the SQL text test used to detect a fijación act. */
export function actIsFijacionEstado(title?: string | null, description?: string | null): boolean {
  const text = `${title ?? ""} ${description ?? ""}`;
  return FIJACION_RE.test(text);
}
