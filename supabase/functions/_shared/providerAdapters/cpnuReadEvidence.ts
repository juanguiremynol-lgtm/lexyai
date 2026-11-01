/** Source outcomes are independent of HTTP success and cache ingestion time. */
export function cpnuSourceObservation(data: Record<string, unknown>): string | undefined {
  const nested = (data.data ?? {}) as Record<string, unknown>;
  const value = data.fetchedAt ?? nested.fetchedAt;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return undefined;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

export function cpnuNegativeEvidence(data: Record<string, unknown>): string | undefined {
  const nested = (data.data ?? {}) as Record<string, unknown>;
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
