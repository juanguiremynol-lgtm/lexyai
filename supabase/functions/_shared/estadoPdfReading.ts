import { getDocument } from 'npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs';
import type { EstadoPdfReading } from './estadoAttachmentRecovery.ts';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Read text and content operators of every page. This is deliberately NOT
 * described as rendering, a signature check or proof of complete integrity. */
export async function readEstadoPdf(bytes: Uint8Array, onlyPages?: number[]): Promise<EstadoPdfReading> {
  if (!bytes.length || bytes.length > 40 * 1024 * 1024) throw new Error('pdf_size_outside_worker_limit');
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('pdf_header_missing');
  if (!new TextDecoder().decode(bytes.slice(-2048)).includes('%%EOF')) throw new Error('pdf_end_missing');
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, stopAtErrors: true });
  const timer = setTimeout(() => void task.destroy(), 30_000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 1000) throw new Error('pdf_page_count_outside_worker_limit');
    const pageTexts: string[] = [];
    // Large multi-providencia packages exceed the Edge CPU budget when every
    // page is parsed. When the case pages are declared, only those are read;
    // the whole-file SHA256 still binds the exact original package.
    const subset = onlyPages?.length ? new Set(onlyPages.filter((p) => p >= 1 && p <= pdf.numPages)) : null;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (subset && !subset.has(pageNumber)) { pageTexts.push(''); continue; }
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      await page.getOperatorList();
      pageTexts.push(text.items.map((item: any) => typeof item.str === 'string' ? item.str : '').join(' '));
      page.cleanup();
    }
    return { sha256: await sha256(bytes), bytes: bytes.length, pages: pdf.numPages, pagesRead: subset ? subset.size : pageTexts.length, textSha256: await sha256(new TextEncoder().encode(pageTexts.join('\n'))), method: subset ? `pdfjs-4.10.38-text-and-operators-declared-pages:${[...subset].join(',')}; no-render-or-signature-check` : 'pdfjs-4.10.38-text-and-operators-every-page; no-render-or-signature-check', pageTexts };
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
