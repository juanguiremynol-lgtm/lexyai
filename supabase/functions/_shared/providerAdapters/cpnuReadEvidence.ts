/** Source outcomes are independent of HTTP success and cache ingestion time. */
export function cpnuSourceObservation(data: Record<string, unknown>): string | undefined {
  const nested = (data.data ?? {}) as Record<string, unknown>;
  const value = data.fetchedAt ?? nested.fetchedAt ??
    (data.proveedor_consultado === true ? data.ultima_consulta_proveedor_en : undefined);
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return undefined;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

/** An old judicial event is compatible with a fresh complete source read.
 * Keep regression/count guards: a recent clock cannot cure missing rows.
 */
export function cpnuObservedSnapshotIsCurrent(input: {
  observedAt?: string; complete: boolean; snapshotMaxDate: string | null;
  dbMaxDate?: string | null; count: number; historicalCount?: number;
}, now = Date.now()): boolean {
  const at = input.observedAt ? Date.parse(input.observedAt) : NaN;
  return input.complete && Number.isFinite(at) && now >= at && now-at <= 86400000 &&
    !(input.dbMaxDate && (!input.snapshotMaxDate || input.snapshotMaxDate < input.dbMaxDate)) &&
    !(input.historicalCount && input.historicalCount > 10 && input.count < input.historicalCount*0.5);
}

export function cpnuNegativeEvidence(data: Record<string, unknown>): string | undefined {
  const nested = (data.data ?? {}) as Record<string, unknown>;
  if (data.motivo === 'PROCESO_NO_ENCONTRADO_EN_PROVEEDOR' &&
      data.interpretacion === 'PROVEEDOR_NO_TIENE_EL_PROCESO' &&
      data.proveedor_consultado === true && cpnuSourceObservation(data))
    return 'CPNU_PROVIDER_NOT_FOUND';
  if (data.found === false || data.expediente_encontrado === false || nested.found === false)
    return 'RECORD_NOT_FOUND';
  if (data.restringido === true || nested.restringido === true || data.contractStatus === 'RESTRICTED_BY_PROVIDER')
    return 'PROCESO_PRIVADO';
  if (data.success === false || data.status === 'error' || data.error)
    return 'PENDING_UPSTREAM';
  const errors = data.erroresDetalle ?? nested.erroresDetalle;
  if (data.detalleCompleto === false || nested.detalleCompleto === false || Array.isArray(errors) && errors.length > 0)
    return 'PENDING_UPSTREAM';
  return undefined;
}

/** Read an adapter verdict together with its evidence. A missing cache entry
 * cannot establish that the judicial provider does not have the case. */
export function cpnuNonDataOutcome(result: {
  provider: string; ok: boolean; error?: string; httpStatus?: number;
  sourceObservedAt?: string; scrapingInitiated?: boolean;
} | null | undefined) {
  if (!result || result.provider !== 'cpnu' || result.ok || result.scrapingInitiated) return null;
  const { error, httpStatus } = result;
  if (error === 'CPNU_PROVIDER_NOT_FOUND' && httpStatus === 410 && result.sourceObservedAt)
    return { code: 'PROVIDER_NOT_FOUND', attempt: 'not_found' } as const;
  if (error === 'PROCESO_PRIVADO' && httpStatus === 200)
    return { code: 'PROCESO_PRIVADO', attempt: 'restricted' } as const;
  if (error === 'RECORD_NOT_FOUND' && (httpStatus === 200 || httpStatus === 404))
    return { code: 'RECORD_NOT_FOUND', attempt: 'not_found' } as const;
  if (error === 'CPNU_SNAPSHOT_MISSING' && httpStatus === 404 ||
      error === 'PENDING_UPSTREAM' && httpStatus === 200)
    return { code: 'PENDING_UPSTREAM', attempt: 'error' } as const;
  return null;
}
