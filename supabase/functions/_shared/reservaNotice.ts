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

export const RESERVA_TITLE = "El proveedor reporta el expediente como reservado";

/**
 * JF1(a) — PROCESO_PRIVADO is a PROVIDER CLAIM, never an established fact.
 * The provider asserts it about the actuaciones channel only; we record the
 * claim. It does not establish that the expediente is reserved, and at least
 * one matter carrying it was verified by the lawyer as NOT reserved.
 */
export function reservaNotice(workflowType?: string | null): string {
  const canal = estadosChannelName(workflowType);
  const base =
    "El proveedor de actuaciones reporta este expediente como «proceso privado». " +
    "Es una afirmación del proveedor, no un hecho comprobado: la registramos tal cual y " +
    "no establece que el juzgado haya reservado el expediente.";
  if (!canal) {
    return `${base} Consúltelo directamente si necesita certeza.`;
  }
  return `${base} Todo proceso debe publicar sus estados por obligación legal, y este se sigue leyendo por ${canal}.`;
}

/** Short form for tables and digest cells. */
export function reservaNoticeShort(workflowType?: string | null): string {
  const canal = estadosChannelName(workflowType);
  return canal
    ? `El proveedor reporta «proceso privado» en actuaciones (afirmación suya, sin comprobar); los estados se siguen leyendo por ${canal}.`
    : "El proveedor reporta «proceso privado» en actuaciones (afirmación suya, sin comprobar).";
}
