import { strict as assert } from 'node:assert';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { readEstadoPdf } from './estadoPdfReading.ts';

Deno.test('PDF.js reads every page of an actual generated PDF; hash is traceability', async () => {
  const document = await PDFDocument.create();
  for (let i = 0; i < 3; i++) document.addPage().drawText(`Documento de prueba, pagina ${i + 1}`);
  const evidence = await readEstadoPdf(await document.save());
  assert.equal(evidence.pages, 3);
  assert.equal(evidence.pagesRead, 3);
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.method, /no-render-or-signature-check/);
});

Deno.test('PDF header and EOF without a valid document never become available', async () => {
  await assert.rejects(() => readEstadoPdf(new TextEncoder().encode('%PDF-1.7\nnot a PDF object tree\n%%EOF')));
});

Deno.test('truncated document is rejected despite its PDF header', async () => {
  const document = await PDFDocument.create();
  document.addPage();
  const bytes = await document.save();
  await assert.rejects(() => readEstadoPdf(bytes.slice(0, Math.floor(bytes.length / 2))));
});
