/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActAttachmentInventory } from '@/components/work-items/ActAttachmentInventory';
import { actDocumentPresentation } from '@/lib/act-document-presentation';
import { ActuacionesTable } from '@/pages/WorkItemDetail/tabs/ActuacionesTable';
import type { WorkItemAct } from '@/pages/WorkItemDetail/tabs/WorkItemActCard';

const own = 'https://storage.googleapis.com/andromeda-cpnu-documentos-2026/case/auto.pdf';
const hash = 'a'.repeat(64);
const read = { gcs_url: own, descarga_estado: 'descargado_y_leido', sha256: hash,
  descarga_observado_en: '2026-10-20T10:00:00Z', pdf_verificacion: { paginas: 2, paginas_leidas: 2, bytes: 2048, sha256: hash } };
const act = { id: 'act', work_item_id: 'process', radicado: '05615400300220260036600', workflow_type: 'CGP', source: 'cpnu', description: 'Auto admisorio' };
afterEach(cleanup);

describe('Actuaciones de Hoy documentary actions', () => {
  it('shows read CPNU copies with separate open and download actions', () => {
    render(<MemoryRouter><ActAttachmentInventory act={{ ...act, documentos: [{ ...read, nombre: 'Auto admisorio.pdf' }] }} /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Documentos de la actuación' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir archivo almacenado' }).getAttribute('href')).toBe(own);
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeTruthy();
  });

  it.each(['FALLIDO', 'FAILED', 'ERROR', 'ERROR_DESCARGA'])('blocks retained HTTP500 URLs and disponible=true with %s', estado => {
    render(<MemoryRouter><ActAttachmentInventory act={{ ...act, documentos: [{ id: 'broken', nombre: 'Auto no recuperado', estado, disponible: true, url: 'https://consultaprocesos.ramajudicial.gov.co/Descarga/Documento?id=1', error: 'HTTP 500' }] }} /></MemoryRouter>);
    expect(screen.getByText('Descarga fallida – sin copia disponible')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Descargar' })).toBeNull();
  });

  it('does not promote empty or partial PDF verification objects to readable files', () => {
    for (const doc of [{ ...read, pdf_verificacion: {} }, { ...read, pdf_verificacion: { ...read.pdf_verificacion, paginas_leidas: 1 } }]) {
      expect(actDocumentPresentation(doc).href).toBeNull();
    }
  });

  it('keeps legacy own copies (no reading observation yet) openable but labelled unread', () => {
    const p = actDocumentPresentation({ gcs_url: own });
    expect(p.href).toBe(own);
    expect(p.label).toBe('Archivo almacenado; lectura no registrada');
  });

  it('applies the same HTTP500 block in the canonical CPNU table', () => {
    render(<MemoryRouter><ActuacionesTable acts={[{ ...act, act_date: '2026-10-19', documentos: [{ nombre: 'Auto no recuperado', estado: 'FALLIDO', disponible: true, url: 'https://example.org/failed.pdf', error: 'HTTP 500' }] } as unknown as WorkItemAct]} /></MemoryRouter>);
    expect(screen.getByText('Descarga fallida – sin copia disponible')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('permits a failed legacy descriptor only after a dated, fully read stored observation', () => {
    expect(actDocumentPresentation({ ...read, estado: 'FALLIDO' }).stored).toBe(true);
    expect(actDocumentPresentation({ ...read, estado: 'FALLIDO', descarga_observado_en: null }).href).toBeNull();
    expect(actDocumentPresentation({ ...read, estado: 'FALLIDO', pdf_verificacion: { ...read.pdf_verificacion, bytes: 0 } }).href).toBeNull();
    expect(actDocumentPresentation({ ...read, estado: 'FALLIDO', sha256: 'b'.repeat(64) }).href).toBeNull();
  });

  it('retains SAMAI announcements and independent requests while suppressing duplicated raw descriptors', () => {
    const doc = { ...read, id: 'doc', solicitud: 'one', nombre: 'Memorial' };
    render(<MemoryRouter><ActAttachmentInventory act={{ ...act, source: 'samai', description: 'Solicitud: 2 archivos', documentos: [doc], raw_data: { anexos_documentos: [doc, { ...doc, solicitud: 'two', nombre: 'Otra solicitud' }] } }} /></MemoryRouter>);
    expect(screen.getAllByRole('link', { name: 'Abrir archivo almacenado' })).toHaveLength(2);
    expect(screen.getByText('Otra solicitud')).toBeTruthy();
  });

  it('links the Rionegro package to its publication with case pages, never the failed original', () => {
    render(<MemoryRouter><ActAttachmentInventory act={{ ...act,
      documentos: [{ estado: 'FALLIDO', disponible: true, url: 'https://example.org/failed.pdf' }],
      raw_data: { documentos_respaldo_publico: [{ publicacion_id: '809071df-9c9e-46f4-80ee-959e7cb497e1', paginas: [60, 61], verificado: true }] },
    }} /></MemoryRouter>);
    expect(screen.getByText(/Paquete público vinculado; páginas 60, 61/)).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Descargar' })).toBeNull();
  });
});
