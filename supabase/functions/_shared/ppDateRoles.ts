/**
 * ppDateRoles.ts — LEAF module (no local imports). Pure resolution of the
 * modern Publicaciones Procesales date roles shared by the canonical mapper,
 * the provider adapter, bridge-reconcile and sync-publicaciones-by-work-item.
 * Roles are never filled from article date, providencia, title or query date.
 */

export const SPANISH_MONTHS: Record<string, string> = {
  ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04",
  MAYO: "05", JUNIO: "06", JULIO: "07", AGOSTO: "08",
  SEPTIEMBRE: "09", OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12",
};

export function parseDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);

  for (const pattern of [/^(\d{2})\/(\d{2})\/(\d{4})$/, /^(\d{2})-(\d{2})-(\d{4})$/]) {
    const m = dateStr.match(pattern);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }

  const spanishLong = dateStr.match(
    /^(\d{1,2})[\s-]+(?:de\s+)?([A-Za-zñÑáéíóúÁÉÍÓÚ]+)[\s-]+(?:de\s+)?(\d{4})$/,
  );
  if (spanishLong) {
    const day = spanishLong[1].padStart(2, "0");
    const month = SPANISH_MONTHS[
      spanishLong[2].toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    ];
    if (month) return `${spanishLong[3]}-${month}-${day}`;
  }
  return null;
}


/** A civil date is persisted only when it is a real calendar day in a
 * plausible judicial range. Anything else (e.g. digits sliced from a 23-digit
 * radicado such as 0131-10-01, or "sin-fecha") becomes NULL: an unknown date
 * is shown as "Fecha no informada", never replaced by today. The original
 * provider text stays in raw_data for traceability. */
export function plausibleCivilDate(d: string | null | undefined): string | null {
  const m = typeof d === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
  if (!m) return null;
  const [y, mo, day] = [+m[1], +m[2], +m[3]];
  if (y < 2000 || y > new Date().getUTCFullYear() + 1) return null;
  const t = new Date(Date.UTC(y, mo - 1, day));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== day) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}


/** Same contract as the UI/MCP (src/lib/publication-quality.ts): any truthy
 * raw asociacion_no_acreditada value (true, object, array, non-empty string)
 * is a warning. false/null/absent is NOT positive proof of attribution. */
export function hasUnaccreditedAssociationFlag(flag: unknown): boolean {
  return Boolean(flag);
}

/** The PP seven-column extractor explicitly labels FECHA AUTO and verifies the
 * court, case, article and row. fecha_iso alone is a fallback cascade and is
 * never enough to establish a decision date. */
export function attributedPPRowAutoDate(raw: Record<string, any>, radicado: string | null | undefined): string | null {
  const a = raw.documento_atribucion;
  const row = a?.fila_estado;
  const article = String(raw.estado?.article_id ?? '');
  if (!radicado || !/^\d{23}$/.test(radicado) || !radicado.endsWith('00') ||
      a?.radicado !== radicado || hasUnaccreditedAssociationFlag(a?.asociacion_no_acreditada) ||
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

export interface PPDateRoles {
  portal: string | null;
  fijacion: string | null;
  providencia: string | null;
  /** The payload declares fecha_publicacion_portal: unknown roles stay NULL. */
  explicit: boolean;
}

/** null = legacy payload with no explicit roles (mapper output unchanged). */
export function resolvePPDateRoles(raw: unknown, radicado: string | null | undefined): PPDateRoles | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const estado = r.estado && typeof r.estado === 'object' ? r.estado as Record<string, unknown> : undefined;
  const civil = (v: unknown) => typeof v === 'string' ? plausibleCivilDate(parseDate(v)) : null;
  const portal = civil(estado?.fecha_publicacion_portal);
  const fijacion = civil(estado?.fecha_fijacion_impresa);
  const providencia = civil(r.fecha_providencia_impresa) ?? attributedPPRowAutoDate(r, radicado);
  const explicit = !!estado && Object.prototype.hasOwnProperty.call(estado, 'fecha_publicacion_portal');
  if (!explicit && !portal && !fijacion && !providencia) return null;
  return { portal, fijacion, providencia, explicit };
}
