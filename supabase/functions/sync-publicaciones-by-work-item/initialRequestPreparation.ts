/** Preparation only. Not wired to fetch/POST: root must approve the exact
 * historical range from the stored-info contract before runtime adoption.
 * ProcesarRequest supports these fields according to root's OpenAPI review. */
export function prepareInitialHistoricalRequest(input: { radicado: string; fecha_inicio: string; fecha_fin: string }) {
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (!/^\d{23}$/.test(input.radicado) || !validDay(input.fecha_inicio) || !validDay(input.fecha_fin)
    || input.fecha_inicio > input.fecha_fin) throw new Error("INITIAL_HISTORICAL_SCOPE_REQUIRED");
  return { radicado: input.radicado, fecha_inicio: input.fecha_inicio, fecha_fin: input.fecha_fin };
}