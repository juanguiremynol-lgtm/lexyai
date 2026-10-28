import { strict as assert } from 'node:assert';
import { incompleteConsultationMessage } from './judicialQueryDisplay.ts';

Deno.test('not found and partial never appear as a complete empty consultation', () => {
  const notFound = incompleteConsultationMessage('NOT_FOUND');
  const partial = incompleteConsultationMessage('partial');
  assert.equal(notFound?.title, 'Proceso no encontrado en esta consulta');
  assert.match(notFound?.description ?? '', /no significa que el proceso no exista/);
  assert.equal(partial?.title, 'Consulta parcial');
  assert.match(partial?.description ?? '', /pendiente/);
  assert.equal(incompleteConsultationMessage('SUCCESS'), null);
  assert.equal(incompleteConsultationMessage(null), null);
});
