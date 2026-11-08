/** Whether a digest day has anything the lawyer must see. Manual-review
 * terms are content: a day with only reviews must never be EMPTY_NO_EMAIL. */
export function digestHasContent(p: { rowCount: number; manualReviewCount: number; coverageIncomplete: boolean }): boolean {
  return p.rowCount + p.manualReviewCount > 0 || p.coverageIncomplete;
}

/** Missing or unusable coverage evidence must never be presented as silence. */
export function digestCoverageIncomplete(rows: readonly {
  authoritative: boolean;
  check_failed?: boolean;
  expected_count: number;
  usable_confirmed_count: number;
}[]): boolean {
  return rows.length === 0 || rows.some((row) =>
    !row.authoritative || row.check_failed === true ||
    !Number.isFinite(row.expected_count) || row.expected_count < 0 ||
    !Number.isFinite(row.usable_confirmed_count) || row.usable_confirmed_count < 0 ||
    (row.expected_count > 0 && row.usable_confirmed_count < row.expected_count)
  );
}

/** The subject reflects actual evidence even when no judicial items were found. */
export function digestSubject(p: {
  critical: boolean;
  estados: number;
  actuaciones: number;
  coverageIncomplete: boolean;
}): string {
  const novedades = p.estados + p.actuaciones;
  const warning = p.coverageIncomplete ? " · cobertura por verificar" : "";
  if (p.critical) {
    return `Andromeda — ⚠ Conexión de correo caída · ${novedades} novedad${novedades === 1 ? "" : "es"}${warning}`;
  }
  if (novedades > 0) {
    return `Andromeda — ${novedades} novedad${novedades === 1 ? "" : "es"} (${p.estados} estados · ${p.actuaciones} actuaciones)${warning}`;
  }
  return p.coverageIncomplete
    ? "Andromeda — Resumen diario · cobertura por verificar"
    : "Andromeda — Resumen diario: audiencias y términos";
}
