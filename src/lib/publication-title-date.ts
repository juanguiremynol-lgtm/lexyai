import { civilDate, formatCivilDate } from "./civil-date";

/** The suffix is provider text, not an independently verified decision date. */
export function publicationTitleDateDiscrepancy(title: unknown, fechaProvidencia: unknown) {
  if (typeof title !== "string" || !/^providencia\b/i.test(title.trim())) return null;
  const suffix = /\s+—\s+(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\s*$/.exec(title);
  const fechaTitulo = suffix ? civilDate(suffix[1]) : null;
  const fechaGuardada = civilDate(fechaProvidencia);
  if (!fechaTitulo || !fechaGuardada || fechaTitulo === fechaGuardada) return null;
  return { fecha_titulo: fechaTitulo, fecha_providencia: fechaGuardada };
}

export function publicationTitleDateNotice(title: unknown, fechaProvidencia: unknown): string | null {
  const d = publicationTitleDateDiscrepancy(title, fechaProvidencia);
  return d
    ? `La fecha en el nombre (${formatCivilDate(d.fecha_titulo)}) difiere de la fecha del auto guardada (${formatCivilDate(d.fecha_providencia)}). Consulte el documento.`
    : null;
}
