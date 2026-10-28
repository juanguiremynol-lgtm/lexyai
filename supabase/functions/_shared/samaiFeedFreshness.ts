/** Source observation, not the time at which our stored feed was read. */
export function assessSamaiFeed(
  data: Record<string, unknown>, radicado: string, now = new Date(),
): { ok: true; observedAt: string } | { ok: false; code: string } {
  if (data.radicado !== radicado) return { ok: false, code: 'SAMAI_CASE_MISMATCH' };
  if (!Array.isArray(data.actuaciones) && !Array.isArray(data.feedCombinado)) {
    return { ok: false, code: 'SAMAI_INVALID_FEED' };
  }
  const sources = data.fuentes_frescura;
  const exp = sources && typeof sources === 'object' && !Array.isArray(sources)
    ? (sources as Record<string, unknown>).expediente : null;
  if (!exp || typeof exp !== 'object' || Array.isArray(exp)) {
    return { ok: false, code: 'SAMAI_SOURCE_OBSERVATION_MISSING' };
  }
  const source = exp as Record<string, unknown>;
  const observed = typeof source.ultima_consulta_exitosa === 'string'
    ? new Date(source.ultima_consulta_exitosa) : new Date(NaN);
  if (!Number.isFinite(observed.getTime())) return { ok: false, code: 'SAMAI_SOURCE_OBSERVATION_MISSING' };
  if (source.consulta_exitosa_ultimo_intento !== true || source.ultimo_resultado !== 'ok') {
    return { ok: false, code: 'SAMAI_SOURCE_LAST_ATTEMPT_FAILED' };
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  if (observed.getTime() > now.getTime() + 300_000 || formatter.format(observed) !== formatter.format(now)) {
    return { ok: false, code: 'SAMAI_SOURCE_OBSERVATION_STALE' };
  }
  return { ok: true, observedAt: observed.toISOString() };
}
