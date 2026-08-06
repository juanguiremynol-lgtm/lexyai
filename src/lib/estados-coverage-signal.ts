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
  | "SIN_COBERTURA_DECLARADA"
  | "SIN_COBERTURA_EN_ESA_FECHA"
  | "ESTADO_SIN_DOCUMENTO"
  | "REMITIDO_A_SUPERIOR";

/**
 * Iteration 35 — how much a coverage-window edge is worth as evidence.
 *
 * The source only retains ~120 days, so the first and last dates we observe
 * are usually artefacts of that retention, not of the despacho's behaviour.
 * Only a GENUINE edge (or NEVER_PUBLISHED) may silence a missing estado.
 */
export type CoverageEdgeConfidence = "GENUINE" | "CENSORED" | "NEVER_PUBLISHED" | "OPEN";

export interface CoverageWindow {
  publishes_from?: string | null;
  publishes_until?: string | null;
  from_confidence?: CoverageEdgeConfidence | null;
  until_confidence?: CoverageEdgeConfidence | null;
  /** {"YYYY-MM": n} observed publications per month, when known. */
  monthly_presence?: Record<string, number> | null;
}

/**
 * Iteration 34 — the estados provider a matter may be judged against.
 * Mirror of the SQL helper `estados_provider_for_workflow`. Comparing a CPACA
 * matter against Publicaciones Procesales is a category error: its estados
 * come from SAMAI Estados, so absence from PP is correct by design.
 */
export function estadosProviderForWorkflow(workflowType?: string | null): string | null {
  switch ((workflowType ?? "").toUpperCase()) {
    case "CPACA":
      return "samai_estados";
    case "CGP":
    case "LABORAL":
    case "PENAL_906":
    case "EJECUTIVO":
    case "TUTELA":
    case "INDETERMINADO":
      return "publicaciones";
    default:
      return null;
  }
}

/**
 * Iteration 34 — the daily path only reaches MONITOREO_MAX_DIAS back; older
 * fijaciones are HISTORICO's job. Mirror of the SQL horizon.
 */
export const DAILY_REACH_DAYS = 120;

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
  out_of_window_count?: number;
  sin_documento_count?: number;
  remitido_count?: number;
  remision_date?: string | null;
  alertable_unmatched_count?: number;
  last_fijacion_date: string | null;
  evidence: {
    unmatched_fijaciones?: Array<{ act_id: string; act_date: string | null; title?: string | null }>;
    fuera_de_ventana?: Array<{ act_id: string; act_date: string | null; description?: string | null }>;
    estados_sin_documento?: Array<{ act_id: string; act_date: string | null; description?: string | null }>;
    remitidas?: Array<{ act_id: string; act_date: string | null; description?: string | null; remision_date?: string | null }>;
  };
  computed_at: string;
}

export const ESTADOS_SIGNAL_LABEL: Record<EstadosSignalClass, string> = {
  CUBIERTO: "Cubierto",
  ESTADOS_ESPERADOS_AUSENTES: "Estados esperados y ausentes",
  ESTADOS_SIN_FIJACION_CONOCIDA: "Sin fijación conocida",
  SIN_COBERTURA_DECLARADA: "Silencio esperado",
  SIN_COBERTURA_EN_ESA_FECHA: "Fuera de la cobertura de la fuente",
  ESTADO_SIN_DOCUMENTO: "Estado sin documento",
  REMITIDO_A_SUPERIOR: "Remitido a otro despacho",
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
  SIN_COBERTURA_EN_ESA_FECHA:
    "La fijación es anterior a la primera publicación conocida del despacho en la fuente, o posterior a la última. No es una anomalía: está fuera de la cobertura temporal de la fuente.",
  ESTADO_SIN_DOCUMENTO:
    "Estado fijado sin documento publicado por el despacho — el término corre. El estado existe y sirve como anclaje del término, pero el despacho nunca cargó la planilla.",
  REMITIDO_A_SUPERIOR:
    "El expediente salió del despacho de origen (remisión al superior o por competencia). Las fijaciones posteriores corresponden al despacho receptor: la ausencia de estados en el despacho de origen es correcta, no una falla del proveedor.",
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
    case "SIN_COBERTURA_EN_ESA_FECHA":
      return "border-sky-500/50 text-sky-600";
    case "ESTADO_SIN_DOCUMENTO":
      return "border-indigo-500/50 text-indigo-600";
    case "REMITIDO_A_SUPERIOR":
      return "border-violet-500/50 text-violet-600";
    default:
      return "border-muted-foreground/40 text-muted-foreground";
  }
}

/**
 * Only a source that normally answers and stopped is anomalous, AND only when
 * the daily pipeline could actually resolve it (iteration 34, item 5) — an
 * alert the daily path cannot possibly close is noise.
 */
export function estadosSignalAlerts(
  signal: Pick<EstadosSignal, "signal_class" | "recent_unmatched_count"> & {
    alertable_unmatched_count?: number;
  },
): boolean {
  if (signal.signal_class !== "ESTADOS_ESPERADOS_AUSENTES") return false;
  if (signal.recent_unmatched_count <= 0) return false;
  return (signal.alertable_unmatched_count ?? signal.recent_unmatched_count) > 0;
}

/**
 * Mirror of the SQL helper `despacho_window_covers` (iteration 35).
 *
 * Window membership is not proof that an estado is missing, and a window edge
 * is only evidence when it is GENUINE. A CENSORED edge is an artefact of the
 * source's 120-day retention and must never silence an orphan fijación.
 */
export function isWithinCoverageWindow(
  date: string | null | undefined,
  window: CoverageWindow | null | undefined,
): boolean {
  if (!date || !window) return true;
  const from = window.from_confidence ?? "OPEN";
  const until = window.until_confidence ?? "OPEN";
  if (from === "NEVER_PUBLISHED" || until === "NEVER_PUBLISHED") return false;
  if (window.publishes_from && date < window.publishes_from && from === "GENUINE") return false;
  if (window.publishes_until && date > window.publishes_until && until === "GENUINE") return false;
  const presence = window.monthly_presence;
  if (presence && Object.keys(presence).length > 0) {
    // Sparse census: only an explicitly measured zero is evidence. An absent
    // key means GCP did not supply that month, never "zero publications".
    const month = date.slice(0, 7);
    if (Object.prototype.hasOwnProperty.call(presence, month) && presence[month] === 0) return false;
  }
  return true;
}

/** Mirror of the SQL helper `pub_matches_provider`. */
export function pubMatchesProvider(source: string | null | undefined, provider: string | null): boolean {
  const s = (source ?? "").toLowerCase();
  if (provider === "samai_estados") return s.startsWith("samai");
  if (provider === "publicaciones") return !s.startsWith("samai");
  return false;
}

/** Mirror of the SQL helper `estados_signal_norm`: lowercase, accent-stripped. */
export function estadosSignalNorm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Mirror of the SQL predicate `act_is_fijacion_estado(description, act_type)`:
 * the normalised text contains both "fijacion" and "estado".
 */
export function actIsFijacionEstado(description?: string | null, actType?: string | null): boolean {
  const text = estadosSignalNorm(`${description ?? ""} ${actType ?? ""}`);
  return text.includes("fijacion") && text.includes("estado");
}

/**
 * Mirror of the SQL predicate `act_is_remision_expediente`: the file leaving
 * the despacho, whether to the superior or to another judge by competence.
 */
export function actIsRemisionExpediente(description?: string | null, actType?: string | null): boolean {
  const t = estadosSignalNorm(`${description ?? ""} ${actType ?? ""}`);
  if (t.includes("envio a superior")) return true;
  if (t.includes("envio a otro despacho") || t.includes("envio a otros despachos")) return true;
  if (t.includes("salida finalizando instancia")) return true;
  if (t.includes("remision expediente")) return true;
  return (
    t.includes("remi") &&
    (t.includes("superior") ||
      t.includes("competencia") ||
      t.includes("incompeten") ||
      t.includes("otro despacho") ||
      t.includes("otros despachos") ||
      t.includes("otro juzgado"))
  );
}
