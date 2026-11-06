/** Independent clocks for providencias and fijaciones; GET time is irrelevant. */
export function validStoredSamaiRead(data: any, radicado: string, now = Date.now()) {
  const day = (ms: number) => new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);
  const fresh = (value: unknown, hours: number, sameDay = false) => {
    const ms = typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(ms) && ms <= now + 60_000 && now - ms <= hours * 3600_000
      && (!sameDay || day(ms) === day(now));
  };
  const rows = data?.actuaciones ?? data?.estados;
  const scope = data?.fijaciones;
  return data?.radicado === radicado && /^\d{23}$/.test(radicado)
    && data?.stored_read_only === true && data?.provider_queries === 0
    && data?.consulta_completa === true && data?.persistencia_completa === true
    && Array.isArray(rows) && data?.total_found === rows.length
    && rows.every((r: any) => r?.Radicacion === radicado && r?.categoria === 'ESTADO')
    && fresh(data?.consultado_en, 24) && fresh(data?.providencias_consultadas_en, 24)
    && fresh(data?.fijaciones_desplegable_leido_en, 20, true)
    && Number.isInteger(scope?.visible_dates) && scope.visible_dates >= 0
    && scope.covered_dates === scope.visible_dates
    && (scope.visible_dates === 0 || fresh(data?.fijaciones_fecha_mas_antigua_leida_en, 20, true));
}

/** Compare the configured service bases, retaining path and port boundaries. */
function serviceBase(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** A native stored-read attempt already owns this exact publication operation.
 * Its error must remain visible instead of triggering a second /snapshot path.
 * Only the common PLATFORM route is covered. Organization/BYO instances and
 * broader BOTH routes can carry additional authorization or operations.
 */
export function redundantSamaiPublicationRoute(input: {
  connectorKey: string | null | undefined;
  scope: string | null | undefined;
  instanceBaseUrl: string | null | undefined;
  instanceScope: string | null | undefined;
  instanceOrganizationId: string | null | undefined;
  organizationRoute: boolean;
  nativeReadBaseUrl: string | null;
}): boolean {
  if (input.connectorKey !== 'SAMAI_ESTADOS' || input.scope !== 'PUBS'
      || input.organizationRoute || input.instanceScope !== 'PLATFORM'
      || input.instanceOrganizationId !== null) return false;
  const nativeBase = serviceBase(input.nativeReadBaseUrl);
  return nativeBase !== null && nativeBase === serviceBase(input.instanceBaseUrl);
}
