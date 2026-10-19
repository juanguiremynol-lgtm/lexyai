// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { ActuacionesTable } from '@/pages/WorkItemDetail/tabs/ActuacionesTable';
import type { WorkItemAct } from '@/pages/WorkItemDetail/tabs/WorkItemActCard';

const act = (extra: Partial<WorkItemAct> = {}) => ({ id: 'act-a', source: 'samai', description: 'RECIBE MEMORIALES ONLINE - Solicitud No. 3435550: 2 archivos', act_date: '2026-10-16', ...extra } as WorkItemAct);
afterEach(cleanup);

describe('active act table documentary evidence', () => {
  it('keeps classified act links visible without treating classification as denied access', () => {
    render(<ActuacionesTable acts={[act({ raw_data: { estado: 'CLASIFICADA', anexos_documentos: [{ id: 'a', descripcion: 'Anexo propio', urlDescarga: 'https://storage.googleapis.com/andromeda-samai-documentos-2026/a.pdf' }] } })]} />);
    expect(screen.getByText('2 anexo(s) anunciado(s)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir enlace registrado' }).getAttribute('href')).toContain('/a.pdf');
    expect(screen.getByText('Recuperación automática pendiente; el enlace por sí solo no acredita un archivo disponible.')).toBeTruthy();
    expect(screen.queryByText('Clasificado')).toBeNull();
  });
  it('shows missing inventory as pending rather than hiding announced annexes', () => {
    render(<ActuacionesTable acts={[act({ raw_data: { anexos_observacion: { estado: 'detalle_sin_inventario' } } })]} />);
    expect(screen.getByText(/La consulta automática del detalle no devolvió/)).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
  it('retains each document and its transient failure even with a registered link', () => {
    render(<ActuacionesTable acts={[act({ documentos: [{ id: 'a', nombre: 'Memorial', url: 'https://storage.googleapis.com/andromeda-samai-documentos-2026/a.pdf', descarga_estado: 'no_verificada', descarga_error: { kind: 'http_transient' } }, { id: 'b', nombre: 'Anexo independiente' }] as any })]} />);
    expect(screen.getByText('Memorial')).toBeTruthy();
    expect(screen.getByText('Anexo independiente')).toBeTruthy();
    expect(screen.getAllByText(/Los intentos automáticos fallaron/).length).toBeGreaterThan(0);
    expect(screen.getByText('Pendiente de recuperación automática')).toBeTruthy();
  });
  it('uses the protected request annotation when legacy raw text names another request', () => {
    render(<ActuacionesTable acts={[act({ raw_data: { anotacion: 'Solicitud No. 3432736: texto de otra solicitud' } })]} />);
    expect(screen.getByText('Solicitud No. 3435550: 2 archivos')).toBeTruthy();
    expect(screen.queryByText(/texto de otra solicitud/)).toBeNull();
  });
  it('shows an actually read archive and preserves separate origin associations sharing stored bytes', () => {
    const common = { nombre: 'Expediente ZIP', gcs_url: 'https://storage.googleapis.com/bucket/same.zip', sha256: 'a'.repeat(64), descarga_estado: 'descargado_y_leido', archivo_verificacion: { formato: 'zip', lectura_completa: true, crc_comprobado: true, miembros: [{name: '001.pdf'}, {name: '002.pdf'}] } };
    render(<ActuacionesTable acts={[act({ documentos: [{...common, url_origen:'https://example.org/source-a'}, {...common, url_origen:'https://example.org/source-b'}] as any })]} />);
    expect(screen.getAllByRole('link', {name:'Abrir archivo almacenado'})).toHaveLength(2);
    expect(screen.getAllByText(/2 documentos dentro del ZIP/)).toHaveLength(2);
    expect(screen.getAllByText('Contenido: 002.pdf')).toHaveLength(2);
  });
  it('does not mark an unvalidated archive as available', () => {
    render(<ActuacionesTable acts={[act({ documentos: [{nombre:'ZIP pendiente', gcs_url:'https://example.org/a.zip', sha256:'a', descarga_estado:'descargado_y_leido', archivo_verificacion:{formato:'zip',lectura_completa:true,crc_comprobado:false}}] as any })]} />);
    expect(screen.queryByRole('link', {name:'Abrir archivo almacenado'})).toBeNull();
    expect(screen.getByText(/Recuperación automática pendiente; el enlace por sí solo/)).toBeTruthy();
  });

});
