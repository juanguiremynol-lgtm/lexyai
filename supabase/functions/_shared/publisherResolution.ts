/**
 * Publisher vs authoring-despacho resolution for the public Publicaciones
 * Procesales portal, and case location inside multi-providencia PDF packages.
 *
 * Some courts do not publish under their own despacho code: a municipal
 * "Centro de Servicios Judiciales" (e.g. Rionegro 056157172000) publishes the
 * estados of several juzgados (e.g. 056154003002) as one PDF package. An exact
 * despacho search therefore returns zero. Resolution rules:
 *  - search first by the authoring despacho (12 first radicado digits);
 *  - then by municipality (5 first digits) and accept ONLY articles whose
 *    title names the authoring despacho (number + specialty + municipality);
 *  - inside the package, a case is located only on pages containing the full
 *    23-digit radicado (separators/line breaks tolerated) or the short
 *    "YYYY-NNNNN" form on a page that also names the authoring despacho.
 * Never associate a whole central publisher with every case of its municipality.
 */

const ORDINALS: Record<string, number> = {
  primero: 1, segundo: 2, tercero: 3, cuarto: 4, quinto: 5, sexto: 6, septimo: 7, octavo: 8, noveno: 9, decimo: 10,
};

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function authorDespachoCode(radicado: string): string | null {
  return /^\d{23}$/.test(radicado) ? radicado.slice(0, 12) : null;
}

export function municipalityCode(radicado: string): string | null {
  return /^\d{23}$/.test(radicado) ? radicado.slice(0, 5) : null;
}

/** Ordered portal search plan. The municipality step is a candidate search,
 * never an association: results must pass articleNamesAuthorDespacho. */
export function portalSearchPlan(radicado: string): Array<{ kind: 'author_despacho' | 'municipality'; code: string }> {
  const despacho = authorDespachoCode(radicado);
  const municipio = municipalityCode(radicado);
  if (!despacho || !municipio) return [];
  return [{ kind: 'author_despacho', code: despacho }, { kind: 'municipality', code: municipio }];
}

interface DespachoName { number: number; specialty: string[]; municipality: string }

const SPECIALTY_WORDS = ['CIVIL', 'MUNICIPAL', 'CIRCUITO', 'PROMISCUO', 'FAMILIA', 'LABORAL', 'PENAL', 'ADMINISTRATIVO', 'PEQUENAS', 'CAUSAS'];

/** Parses "JUZGADO 002 CIVIL MUNICIPAL DE RIONEGRO" / "02 CIVIL MUNICIPAL DE RIONEGRO". */
export function parseDespachoName(name: string): DespachoName | null {
  const text = normalizeText(name).replace(/^JUZGADO\s+/, '');
  const m = /^(\d{1,3}|[A-Z]+)\b\s*(?:\(\d+\)\s*)?(.*?)\s+DE\s+([A-Z ]+?)\s*$/.exec(text);
  if (!m) return null;
  const number = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : ORDINALS[m[1].toLowerCase()];
  if (!number) return null;
  const specialty = m[2].split(' ').filter((w) => SPECIALTY_WORDS.includes(w));
  if (!specialty.length) return null;
  return { number, specialty, municipality: m[3].trim() };
}

/** True only when the article title names exactly the authoring despacho. */
export function articleNamesAuthorDespacho(articleTitle: string, authorityName: string): boolean {
  const author = parseDespachoName(authorityName);
  if (!author) return false;
  const title = normalizeText(articleTitle);
  const re = /\b(\d{1,3})\s*(?:\(\d+\)\s*)?((?:CIVIL|MUNICIPAL|CIRCUITO|PROMISCUO|FAMILIA|LABORAL|PENAL|ADMINISTRATIVO|PEQUENAS|CAUSAS|DE|Y|\s)+?)\s+DE\s+([A-Z ]+?)(?:\s+DE\s+\d|\s*$|\s+-)/g;
  for (const m of title.matchAll(re)) {
    if (parseInt(m[1], 10) !== author.number) continue;
    const spec = m[2].split(' ').filter((w) => SPECIALTY_WORDS.includes(w));
    if (spec.join(' ') !== author.specialty.join(' ')) continue;
    if (m[3].trim() !== author.municipality) continue;
    return true;
  }
  return false;
}

function collapseDigitSeparators(text: string): string {
  return text.replace(/(?<=\d)[\s\-.]+(?=\d)/g, '');
}

/** 1-indexed pages of a package where this case appears. `authorIsPublisher`
 * is true only when the portal article was published under the case's own
 * despacho code (radicado digits 1-12); then the short form needs no page text
 * naming the despacho. A central publisher always requires page-level context. */
export function locateCaseInPackagePages(pageTexts: string[], radicado: string, authorityName: string, authorIsPublisher = false): number[] {
  if (!/^\d{23}$/.test(radicado)) return [];
  const year = radicado.slice(12, 16);
  const consecutive = parseInt(radicado.slice(16, 21), 10);
  const author = parseDespachoName(authorityName);
  const pages: number[] = [];
  pageTexts.forEach((raw, index) => {
    if (collapseDigitSeparators(raw).includes(radicado)) { pages.push(index + 1); return; }
    const text = normalizeText(raw);
    const namesAuthor = authorIsPublisher || !!author && text.includes(author.municipality)
      && new RegExp(`\\b0*${author.number}\\b`).test(text)
      && author.specialty.every((w) => text.includes(w));
    if (!namesAuthor) return;
    for (const m of text.matchAll(/\b(20\d{2})\s*-\s*(\d{1,5})\b/g)) {
      if (m[1] === year && parseInt(m[2], 10) === consecutive) { pages.push(index + 1); return; }
    }
  });
  return pages;
}

/** Every declared case page range must start on a page where the case is located. */
export function verifyDeclaredCasePages(located: number[], declared: Array<[number, number]>): boolean {
  if (!declared.length) return false;
  return declared.every(([from, to]) => from >= 1 && to >= from
    && located.some((p) => p >= from && p <= to));
}
