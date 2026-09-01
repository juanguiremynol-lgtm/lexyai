/**
 * JD2 — edge-side mirror of `src/lib/reserva-notice.ts`.
 * A reserva speaks only about the ACTUACIONES channel. Estados are a legal
 * obligation of every despacho and keep being read.
 */

export type EstadosChannelName = "Publicaciones Procesales" | "SAMAI Estados";

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

export function reservaNotice(workflowType?: string | null): string {
  const canal = estadosChannelName(workflowType);
  const base =
    "El juzgado marcó este expediente como reservado: el detalle de actuaciones no es público.";
  if (!canal) {
    return `${base} No es una falla de Andrómeda ni una pérdida de cobertura.`;
  }
  return `${base} Los estados sí se publican por obligación legal y se siguen leyendo por ${canal}.`;
}

export function reservaNoticeShort(workflowType?: string | null): string {
  const canal = estadosChannelName(workflowType);
  return canal
    ? `Expediente reservado en actuaciones; los estados se siguen leyendo por ${canal}.`
    : "Expediente reservado en actuaciones.";
}
