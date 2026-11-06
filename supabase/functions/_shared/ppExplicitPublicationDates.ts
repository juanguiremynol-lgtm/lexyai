import {
  toCanonicalPubRow, canonicalPubIdentityFromRow, parseDate, plausibleCivilDate, SPANISH_MONTHS,
  pubArticleIdFromRow,
  type ProviderPubUnit, type CanonicalPubContext, type CanonicalPubRow,
} from './canonicalPublicacionMapper.ts';

/** The PP seven-column extractor explicitly labels FECHA AUTO and verifies the
 * court, case, article and row. fecha_iso alone is a fallback cascade and is
 * never enough to establish a decision date. */
export function attributedPPRowAutoDate(raw: Record<string, any>, radicado: string | null | undefined): string | null {
  const a = raw.documento_atribucion;
  const row = a?.fila_estado;
  const article = String(raw.estado?.article_id ?? '');
  if (!radicado || !/^\d{23}$/.test(radicado) || !radicado.endsWith('00') ||
      a?.radicado !== radicado || a?.asociacion_no_acreditada ||
      row?.metodo !== 'pdfplumber_celdas_despacho_acreditado' ||
      row?.prueba_despacho !== 'PRINTED_COURT_AND_VERIFIED_DEPARTMENT' ||
      row?.despacho_acreditado !== radicado.slice(0, 12) || !/^\d+$/.test(article) ||
      String(row?.article_id ?? '') !== article) return null;
  const match = String(row.identidad_celda ?? '').match(/^(\d{4})\s*[-–—/]\s*(\d{5})$/);
  if (!match || match[1] !== radicado.slice(12, 16) || match[2] !== radicado.slice(16, 21)) return null;
  const { pagina, tabla, fila } = row;
  if (![pagina, tabla, fila].every(n => Number.isInteger(n) && n > 0) ||
      row.id_origen !== `${article}:p${pagina}:t${tabla}:r${fila}`) return null;
  const sourceDate = typeof raw.fecha === 'string' ? plausibleCivilDate(parseDate(raw.fecha)) : null;
  const resolvedDate = typeof raw.fecha_iso === 'string' ? plausibleCivilDate(parseDate(raw.fecha_iso)) : null;
  const cell = String(row.fecha_celda ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const m = cell.match(/^([A-Z]+)\s+(\d{1,2})\s*\/\s*(\d{4})$/);
  const month = m && SPANISH_MONTHS[m[1]];
  const cellDate = month && m ? plausibleCivilDate(`${m[3]}-${month}-${m[2].padStart(2,'0')}`) : null;
  return sourceDate && sourceDate === resolvedDate && sourceDate === cellDate ? sourceDate : null;
}

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
  const providencia = civil(raw.fecha_providencia_impresa) ?? attributedPPRowAutoDate(raw, ctx.source_radicado);
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
