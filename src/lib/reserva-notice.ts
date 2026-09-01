/**
 * JD2 — what a reserva means, and what it does NOT mean.
 *
 * A despacho marking an expediente as reserved is a court decision about the
 * ACTUACIONES detail. Every despacho in Colombia is obliged to publish ESTADOS,
 * so the estados channel (Publicaciones Procesales for the CGP family, SAMAI
 * Estados for CPACA) is unaffected and keeps being read every day.
 *
 * These strings must never read as a degradation or a failure. The edge-side
 * mirror lives in `supabase/functions/_shared/reservaNotice.ts` and is kept
 * byte-identical by `src/test/jd1-reserva-does-not-silence-estados.test.ts`.
 */

export type EstadosChannelName = "Publicaciones Procesales" | "SAMAI Estados";

/** Human name of the estados channel a matter is read by. Null = no channel. */
export function estadosChannelName(workflowType?: string | null): EstadosChannelName | null {
  switch ((workflowType ?? "").toUpperCase()) {
    case "CPACA":
      return "SAMAI Estados";
    case "CGP":
    case "LABORAL":
    case "PENAL_906":
    case "EJECUTIVO":
    case "TUTELA":
    case "INDETERMINADO":
      return "Publicaciones Procesales";
    default:
      return null;
  }
}

export const RESERVA_TITLE = "Expediente reservado por el juzgado";

/**
 * The per-matter sentence. `canal` is named explicitly so the lawyer knows
 * where the information he still receives is coming from.
 */
export function reservaNotice(workflowType?: string | null): string {
  const canal = estadosChannelName(workflowType);
  const base =
    "El juzgado marcó este expediente como reservado: el detalle de actuaciones no es público.";
  if (!canal) {
    return `${base} No es una falla de Andrómeda ni una pérdida de cobertura.`;
  }
  return `${base} Los estados sí se publican por obligación legal y se siguen leyendo por ${canal}.`;
}

/** Short form for tables and digest cells. */
export function reservaNoticeShort(workflowType?: string | null): string {
  const canal = estadosChannelName(workflowType);
  return canal
    ? `Expediente reservado en actuaciones; los estados se siguen leyendo por ${canal}.`
    : "Expediente reservado en actuaciones.";
}
