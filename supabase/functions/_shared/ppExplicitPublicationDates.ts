import {
  toCanonicalPubRow, canonicalPubIdentityFromRow, parseDate, plausibleCivilDate, SPANISH_MONTHS,
  pubArticleIdFromRow,
  type ProviderPubUnit, type CanonicalPubContext, type CanonicalPubRow,
} from './canonicalPublicacionMapper.ts';
import { officialPortalRecoveryHash, publicPpDocumentCorrespondence } from './estadoAttachmentRecovery.ts';
import { verifyDeclaredCasePages } from './publisherResolution.ts';

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

interface OfficialStateCandidate {
  id: string; raw_data?: Record<string, any>; tipo_publicacion?: string | null;
  hash_fingerprint?: string; is_archived?: boolean; pdf_available?: boolean;
  pdf_storage_path?: string; pdf_url?: string; fecha_fijacion?: string;
  fecha_providencia?: string; published_at?: string;
}

/** Independent evidence from the official portal recovery and the provider's
 * rendered original. Never apply this title-independent identity to orders. */
export function officialStateReplay(row: CanonicalPubRow, candidates: OfficialStateCandidate[]) {
  const unit = row.raw_data as ProviderPubUnit;
  const raw = (unit.raw_data ?? {}) as Record<string, any>;
  const radicado = row.source_radicado;
  const article = pubArticleIdFromRow(row);
  if (row.source !== 'publicaciones' || row.tipo_publicacion !== 'Estado Electrónico' ||
      !radicado || !/^\d{23}$/.test(radicado) || !article || !/^\d+$/.test(article)) return null;
  const states = candidates.filter(c => c.tipo_publicacion === row.tipo_publicacion && pubArticleIdFromRow(c) === article);
  if (states.length !== 1) return null;
  const old = states[0], stored = old.raw_data;
  if (!old.id || !old.hash_fingerprint || old.hash_fingerprint === row.hash_fingerprint ||
      old.is_archived !== false || !old.pdf_available || !old.pdf_storage_path ||
      stored?.fuente !== 'portal_oficial_publicaciones_procesales' ||
      !Array.isArray(stored.recuperacion_oficial) || stored.recuperacion_oficial.length !== 1) return null;

  const rec = stored.recuperacion_oficial[0], state = raw.estado;
  const attribution = raw.documento_atribucion;
  const printed = state?.fecha_fijacion_impresa, portal = state?.fecha_publicacion_portal;
  if (!rec || !state || !printed || !portal || plausibleCivilDate(printed) !== printed ||
      plausibleCivilDate(portal) !== portal || old.fecha_fijacion?.slice(0,10) !== printed ||
      old.published_at?.slice(0,10) !== portal || rec.fecha !== printed ||
      (row.fecha_providencia != null && old.fecha_providencia?.slice(0,10) !== row.fecha_providencia.slice(0,10)) ||
      !unit.estado_numero || stored.estado_numero !== unit.estado_numero ||
      String(rec.article_id) !== article || attribution?.radicado !== radicado ||
      attribution.asociacion_no_acreditada || !Array.isArray(attribution.originales)) return null;

  const url = rec.url, sha = rec.sha256, archive = raw.gcs_url_pdf_estado;
  const source = typeof url === 'string' ? URL.parse(url) : null;
  const recovery = typeof url === 'string' && officialPortalRecoveryHash(old, url);
  const linked = row.pdf_url && publicPpDocumentCorrespondence(row, row.pdf_url);
  if (!recovery || !source || source.username || source.password ||
      !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(source.searchParams.get('uuid') ?? '') ||
      url !== state.pdf_url || old.pdf_url !== url || recovery.expected_sha256 !== sha ||
      !linked || linked.document_kind !== 'estado' || linked.article_id !== article ||
      linked.source_gcs_url !== archive || !archive.endsWith(`/${sha}.pdf`) ||
      !Number.isSafeInteger(rec.bytes) || rec.bytes <= 0 ||
      !Number.isSafeInteger(rec.paginas) || rec.paginas <= 0) return null;
  const originals = attribution.originales.filter((o: Record<string, unknown>) => o?.tipo === 'estado');
  if (originals.length !== 1 || originals[0].metodo !== 'pymupdf_render' || originals[0].lectura_comprobada !== true ||
      originals[0].url_origen !== url || originals[0].url_original !== archive ||
      originals[0].paginas_renderizadas !== rec.paginas ||
      (rec.paquete && rec.paquete.radicado !== radicado)) return null;
  return { id:old.id, path:old.pdf_storage_path, url, sha, article, printed,
    bytes:rec.bytes, pages:rec.paginas, court:rec.id_despacho, radicado, casePages:rec.paquete?.paginas_caso };
}

type OfficialStateProof = NonNullable<ReturnType<typeof officialStateReplay>>;

/** The downloaded queue entry binds the persisted file's SHA and size to
 * the source recovery. A sample reading is sufficient for file identity. */
export function officialAttachmentMatches(proof: OfficialStateProof, entries: Array<Record<string, any>>): boolean {
  if (entries.length !== 1) return false;
  const q = entries[0], v = q.validation_evidence, r = v?.reading, c = v?.correspondence;
  if (proof.casePages && (v?.paquete?.verificado !== true || v.paquete.radicado !== proof.radicado ||
      !Array.isArray(v.paquete.paginas_localizadas) ||
      !proof.casePages.every((range: unknown) => Array.isArray(range) && range.length === 2 &&
        range.every(n => Number.isSafeInteger(n) && n > 0 && n <= proof.pages)) ||
      !verifyDeclaredCasePages(v.paquete.paginas_localizadas, proof.casePages))) return false;
  return q.status === 'downloaded' && q.publicacion_id === proof.id && !!q.id && v?.queue_id === q.id &&
    v.publicacion_id === proof.id && q.storage_path === proof.path && q.remote_url === proof.url &&
    v.state === 'verified' && v.source_url === proof.url && r?.sha256 === proof.sha &&
    r.bytes === proof.bytes && r.pages === proof.pages && Number.isInteger(r.pagesRead) &&
    r.pagesRead > 0 && r.pagesRead <= r.pages && c?.method === 'official_portal_recovery' &&
    c.expected_sha256 === proof.sha && c.id_despacho === proof.court &&
    String(c.article_id) === proof.article && c.fecha === proof.printed;
}
