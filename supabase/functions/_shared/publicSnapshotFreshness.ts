/** Source observation time, never the time a stored snapshot was served. */
export function publicSnapshotIncomplete(data: unknown, now = Date.now()): boolean {
  if (!data || typeof data !== 'object') return true;
  const body = data as Record<string, unknown>;
  const search = (body.busqueda ?? {}) as Record<string, unknown>;
  if (body.persistencia_completa === false || body.consulta_completa === false || /PARTIAL|PARCIAL|INDETERMINADO|PARSE_MISMATCH|CATEGORIA_NO_RECONOCIDA/.test(String(body.run_status ?? ''))) return true;
  if (search.fuente !== 'db') return false;
  const observed = Date.parse(String(search.ultima_sync ?? ''));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' });
  return search.procesado === false || !Number.isFinite(observed) || observed > now + 60_000 ||
    day.format(new Date(observed)) !== day.format(new Date(now)) || now - observed > 26 * 60 * 60_000;
}
export function publicSnapshotCompleted(data: unknown, now = Date.now()): boolean {
  if (publicSnapshotIncomplete(data, now)) return false;
  const body = data as Record<string, unknown>;
  return /^(SUCCESS_EMPTY|SUCCESS_WITH_DATA|OK)$/i.test(String(body.run_status ?? ''));
}