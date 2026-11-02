import {
  toCanonicalPubRow, canonicalPubIdentityFromRow, parseDate, plausibleCivilDate,
  pubArticleIdFromRow,
  type ProviderPubUnit, type CanonicalPubContext, type CanonicalPubRow,
} from './canonicalPublicacionMapper.ts';

/** Additive PP evidence only; legacy units and SAMAI keep their exact mapping. */
export function ppExplicitPublicationDates(unit: ProviderPubUnit, ctx: CanonicalPubContext): CanonicalPubRow {
  const row = toCanonicalPubRow(unit, ctx);
  if (row.source !== 'publicaciones') return row;
  const raw = unit.raw_data ?? {};
  const estado = raw.estado as Record<string, unknown> | undefined;
  const civil = (value: unknown) => typeof value === 'string'
    ? plausibleCivilDate(parseDate(value)) : null;
  const portal = civil(estado?.fecha_publicacion_portal);
  const fijacion = civil(estado?.fecha_fijacion_impresa);
  const providencia = civil(raw.fecha_providencia_impresa);
  if (!portal && !fijacion && !providencia) return row;
  const noon = (date: string) => new Date(`${date}T12:00:00Z`).toISOString();
  if (portal) row.published_at = noon(portal);
  if (fijacion) row.fecha_fijacion = noon(fijacion);
  if (providencia) row.fecha_providencia = noon(providencia);
  row.hash_fingerprint = canonicalPubIdentityFromRow(row, ctx.work_item_id);
  return row;
}

/** A changed date is not evidence of a new native publication. Fail closed
 * on prior native rows instead of re-keying or choosing an ambiguous match. */
export function conflictingPPNativeRows(row: CanonicalPubRow, candidates: Array<{
  id: string; raw_data?: unknown; tipo_publicacion?: string | null; hash_fingerprint?: string;
}>): string[] {
  const article = pubArticleIdFromRow(row);
  if (!article) return [];
  return candidates.filter(candidate =>
    pubArticleIdFromRow(candidate) === article &&
    candidate.tipo_publicacion === row.tipo_publicacion &&
    candidate.hash_fingerprint !== row.hash_fingerprint
  ).map(candidate => candidate.id);
}

export function hasExplicitPPDates(unit: ProviderPubUnit): boolean {
  const raw = unit.raw_data ?? {};
  const estado = raw.estado as Record<string, unknown> | undefined;
  return [raw.fecha_providencia_impresa, estado?.fecha_publicacion_portal, estado?.fecha_fijacion_impresa]
    .some(value => typeof value === 'string' && plausibleCivilDate(parseDate(value)) !== null);
}