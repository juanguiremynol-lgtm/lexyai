import { parseDate, plausibleCivilDate } from './canonicalPublicacionMapper.ts';
import { durableVerdict, matchingCompletedHistory } from './ppDurableContract.ts';

export type HistoricalWindow = { backend_run_id:string; desde:string; hasta:string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Input is accepted only after the handler has verified trusted service auth. */
export function parseHistoricalWindow(value: unknown, now = Date.now()): HistoricalWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.backend_run_id !== 'string' || !UUID.test(v.backend_run_id) ||
      typeof v.desde !== 'string' || typeof v.hasta !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(v.hasta) ||
      plausibleCivilDate(v.desde) !== v.desde || plausibleCivilDate(v.hasta) !== v.hasta) return null;
  const start = Date.parse(`${v.desde}T00:00:00Z`), end = Date.parse(`${v.hasta}T00:00:00Z`);
  const today = new Date(now - 5 * 3600_000).toISOString().slice(0,10);
  if (start > end || v.hasta > today || end - start > 366 * 86400_000) return null;
  return { backend_run_id:v.backend_run_id, desde:v.desde, hasta:v.hasta };
}

function attributed(row: any, radicado: string): boolean {
  const a = row?.documento_atribucion;
  if (!a || a.radicado !== radicado || a.asociacion_no_acreditada) return false;
  const article = String(row?.estado?.article_id ?? '');
  if (!/^\d+$/.test(article)) return false;
  const f = a.fila_estado;
  const parts = String(f?.identidad_celda ?? '').match(/^(\d{4})\s*[-–—/]\s*(\d{5})$/);
  if (f?.metodo === 'pdfplumber_celdas_despacho_acreditado' &&
      f.prueba_despacho === 'PRINTED_COURT_AND_VERIFIED_DEPARTMENT' && f.despacho_acreditado === radicado.slice(0,12) &&
      radicado.endsWith('00') && parts?.[1] === radicado.slice(12,16) && parts?.[2] === radicado.slice(16,21) &&
      String(f.article_id) === article && [f.pagina,f.tabla,f.fila].every((n: unknown) => Number.isInteger(n) && (n as number)>0) &&
      f.id_origen === `${article}:p${f.pagina}:t${f.tabla}:r${f.fila}`) return true;
  const p = a.paquete;
  return p?.radicado === radicado && Array.isArray(p.paginas_caso) && p.paginas_caso.length > 0 &&
    p.paginas_caso.every((span:unknown) => Array.isArray(span) && span.length === 2 &&
      span.every((n:unknown) => Number.isInteger(n) && (n as number)>0) && span[1]>=span[0]);
}

/** /historico returns the entire stored inventory even for a run id. Its
 * certificate covers only the requested window: retain only attributable rows
 * in that window and never attach its certificate to all historical data. */
export function certifiedHistoricalRows(run: unknown, history: unknown, radicado: string,
  window: HistoricalWindow, now = Date.now()) {
  if (!/^\d{23}$/.test(radicado) || !run || typeof run !== 'object' || !history || typeof history !== 'object') return null;
  const r = run as Record<string, any>, h = history as Record<string, any>;
  const scope = (x:any) => x?.desde === window.desde && x?.hasta === window.hasta &&
    typeof x?.siguiente_desde === 'string' && x.siguiente_desde > window.hasta;
  const time = typeof r.intento_observado_en === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(r.intento_observado_en)
    ? Date.parse(r.intento_observado_en) : NaN;
  if (r.radicado !== radicado || durableVerdict(200,r,window.backend_run_id).kind !== 'complete' ||
      r.persistencia_completa !== true || r.alcance_efectivo_acreditado !== true || !scope(r.checkpoint) ||
      !Number.isFinite(time) || time > now + 60_000 ||
      !matchingCompletedHistory(window.backend_run_id,h,radicado) || h.persistencia_completa !== true ||
      !scope(h.ventana_solicitada) || h.intento_observado_en !== r.intento_observado_en || !Array.isArray(h.actuaciones)) return null;
  const selected: any[] = []; let outside = 0; let unverified = 0;
  for (const row of h.actuaciones) {
    const rawDate = row?.estado?.fecha_publicacion_portal ?? row?.estado?.fecha_publicacion;
    const date = typeof rawDate === 'string' ? plausibleCivilDate(parseDate(rawDate)) : null;
    if (!date) { unverified++; continue; }
    if (date < window.desde || date > window.hasta) { outside++; continue; }
    if (!attributed(row,radicado)) { unverified++; continue; }
    selected.push({ ...row, recuperacion_historica: { backend_run_id:window.backend_run_id,
      ventana:{ desde:window.desde, hasta:window.hasta }, observado_en:r.intento_observado_en,
      origen:'LECTURA_ALMACENADA_SIN_EXTRACCION', cobertura_documental:'no_evaluada' } });
  }
  // Refuse ambiguous inventory rather than silently calling it complete.
  if (unverified > 0) return null;
  return { body:{...h, actuaciones:selected}, accepted:selected.length, outside, sourceObservedAt:r.intento_observado_en as string };
}
