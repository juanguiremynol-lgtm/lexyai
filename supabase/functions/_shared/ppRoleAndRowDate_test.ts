import { strict as assert } from 'node:assert';
import { explodeProviderPublicaciones, findDocumentByType, legacyPPStateRoleCollision } from './canonicalPublicacionMapper.ts';
import { attributedPPRowAutoDate, ppExplicitPublicationDates } from './ppExplicitPublicationDates.ts';

const rad = '05001400300120250012300';
const context = { work_item_id:'11111111-1111-4111-8111-111111111111', organization_id:'org', source:'publicaciones', source_radicado:rad };

Deno.test('explicit state role wins over an earlier auto named estado', () => {
  const raw = { estado:{ article_id:'123456', numero:'38', fecha_publicacion:'15/10/2026' }, documentos_pdf:[
    { tipo:'auto', titulo:'Auto estado 38', fecha:'14/10/2026', pdf_url:'https://example.invalid/auto.pdf' },
    { tipo:'estado', titulo:'Planilla', fecha:'15/10/2026', pdf_url:'https://example.invalid/state.pdf' },
  ] };
  assert.equal(legacyPPStateRoleCollision(raw), true);
  assert.equal(findDocumentByType(raw, 'estado').pdf_url, 'https://example.invalid/state.pdf');
  const unit = explodeProviderPublicaciones([raw])[0];
  const row = ppExplicitPublicationDates(unit, context);
  assert.match(row.fecha_fijacion!, /^2026-10-15/);
  assert.match(row.fecha_providencia!, /^2026-10-14/);
  assert.equal(row.pdf_url, 'https://example.invalid/state.pdf');
});

Deno.test('an auto with estado in its title is never selected as the state document', () => {
  const raw = { estado:{article_id:'1', numero:'30', fecha_publicacion:'12/03/2026'}, documentos_pdf:[
    {tipo:'auto', titulo:'Auto estado 30', fecha:'11/03/2026', pdf_url:'https://example.invalid/auto.pdf'}] };
  const state = explodeProviderPublicaciones([raw])[0];
  assert.equal(findDocumentByType(raw, 'estado'), null);
  assert.equal(state.planilla_sin_documento, true);
  assert.equal(state.pdf_url, undefined);
  assert.equal(findDocumentByType({documentos_pdf:[{titulo:'estado 30',pdf_url:'x'}]}, 'estado').pdf_url, 'x');
});

function evidence() { return { fecha:'11/03/2026', fecha_iso:'2026-03-11', estado:{article_id:'123456'},
  documento_atribucion:{radicado:rad, fila_estado:{metodo:'pdfplumber_celdas_despacho_acreditado',
    prueba_despacho:'PRINTED_COURT_AND_VERIFIED_DEPARTMENT',despacho_acreditado:rad.slice(0,12),
    identidad_celda:'2025-00123',fecha_celda:'MARZO 11/2026',article_id:'123456',pagina:1,tabla:1,fila:6,id_origen:'123456:p1:t1:r6'}} }; }

Deno.test('a corroborated FECHA AUTO row yields the decision date, never the state date', () => {
  const raw = evidence();
  assert.equal(attributedPPRowAutoDate(raw, rad), '2026-03-11');
  const unit = explodeProviderPublicaciones([{...raw, estado:{...raw.estado, numero:'30', fecha_publicacion:'12/03/2026'}}])[0];
  const row = ppExplicitPublicationDates(unit, context);
  assert.match(row.fecha_fijacion!, /^2026-03-12/);
  assert.match(row.fecha_providencia!, /^2026-03-11/);
});

Deno.test('fecha_iso cannot imply an auto date without matching case, court, row and source date', () => {
  for (const changed of [
    { ...evidence(), documento_atribucion:{...evidence().documento_atribucion,radicado:'05001400300120250012400'} },
    { ...evidence(), fecha:'12/03/2026' },
    { ...evidence(), fecha_iso:'2026-02-30' },
    { ...evidence(), documento_atribucion:{...evidence().documento_atribucion,fila_estado:{...evidence().documento_atribucion.fila_estado,fecha_celda:'MARZO 12/2026'}} },
    { ...evidence(), documento_atribucion:{...evidence().documento_atribucion,fila_estado:{...evidence().documento_atribucion.fila_estado,despacho_acreditado:'other'}} },
    { ...evidence(), documento_atribucion:{...evidence().documento_atribucion,fila_estado:{...evidence().documento_atribucion.fila_estado,id_origen:'other'}} },
    { ...evidence(), documento_atribucion:{...evidence().documento_atribucion,asociacion_no_acreditada:true} },
  ]) assert.equal(attributedPPRowAutoDate(changed, rad), null);
  assert.equal(attributedPPRowAutoDate({fecha_iso:'2026-03-11'}, rad), null);
});
