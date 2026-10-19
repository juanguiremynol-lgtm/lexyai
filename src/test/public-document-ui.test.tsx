/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ActDocumentLinks } from '@/components/work-items/ActDocumentLinks';
import { actDocumentPresentation } from '@/lib/act-document-presentation';
import { actSearchFields, actSearchFilter, actSearchSnippet } from '@/lib/search/act-search';
import { estadosDisplayInventory } from '@/lib/reconcile-estados';
import { ActuacionesTable } from '@/pages/WorkItemDetail/tabs/ActuacionesTable';
import type { WorkItemAct } from '@/pages/WorkItemDetail/tabs/WorkItemActCard';
import { documentDownloadUrl } from '@/lib/download-document';

const own = 'https://storage.googleapis.com/andromeda-samai-documentos-2026/samai/case/file.pdf';
const expired = `https://samaicore.consejodeestado.gov.co/api/DescargarProvidenciaSAMAI?tokendoc=header,${btoa(JSON.stringify({exp:1}))},sig`;

describe('document actions in the radicado UI', () => {
  it('the actual act table blocks the failed1074556 descriptor in both inventories', () => {
    const doc={id:'1074556',solicitud:'1074556',descripcion:'22_MemorialWeb_TARJETAPROFESIONAL',url:expired,urlDescarga:expired,
      descarga_estado:'no_verificada',descarga_error:{kind:'validation'}};
    const act: WorkItemAct={id:'e164eaae-1c93-4aad-a129-67dd4815f644',owner_id:'owner',work_item_id:'2a590db7-0330-4b8d-9403-5963e4bd15a1',description:'RECIBE MEMORIALES',source:'samai',
      act_date:'2024-10-22',event_summary:null,act_date_raw:null,event_date:null,act_type:null,source_platform:null,source_url:null,
      source_reference:null,sources:['samai'],despacho:null,workflow_type:'CPACA',scrape_date:null,hash_fingerprint:'source-act17',created_at:'2026-10-19',date_confidence:null,
      documentos:[doc],raw_data:{anexos:1,anexos_documentos:[doc]}};
    const {container}=render(<ActuacionesTable acts={[act]} />);
    expect(screen.getByText('Lectura fallida – sin copia disponible')).toBeTruthy();
    expect(container.querySelector('a[href*="tokendoc"]')).toBeNull();
    expect(screen.queryByRole('button',{name:'Descargar'})).toBeNull();
    cleanup();
  });
  it('request1074556 reading failure offers no clickable expired SAMAI link', () => {
    render(<ActDocumentLinks document={{ solicitud:'1074556', descripcion:'22_MemorialWeb_TARJETAPROFESIONAL', url:expired,
      descarga_estado:'no_verificada', descarga_error:{kind:'validation'}, recuperacion_cache:{originalNoValidado:{lectura_validada:false,url:own}} }} />);
    expect(screen.getByText('Lectura fallida – sin copia disponible')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByRole('button',{name:'Descargar'})).toBeNull();
    cleanup();
  });
  it('does not offer a known-expired external grant even without a reading failure', () => {
    expect(actDocumentPresentation({url:expired}).href).toBeNull();
  });
  it('stored copies have separate open and real download actions', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['file'])}));
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:download')});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
    render(<ActDocumentLinks document={{gcs_url:own,nombre:'Documento.pdf'}} />);
    expect(screen.getByRole('link',{name:'Abrir archivo almacenado'}).getAttribute('href')).toBe(own);
    fireEvent.click(screen.getByRole('button',{name:'Descargar'}));
    await waitFor(()=>expect(click).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(documentDownloadUrl(own),expect.objectContaining({signal:expect.anything()}));
    cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
  });
  it('downloads the exact public object through its CORS media route and preserves private signed URLs', () => {
    expect(documentDownloadUrl(own)).toBe('https://storage.googleapis.com/download/storage/v1/b/andromeda-samai-documentos-2026/o/samai%2Fcase%2Ffile.pdf?alt=media');
    const signed='https://project.supabase.co/storage/v1/object/sign/private/document.pdf?token=signed';
    expect(documentDownloadUrl(signed)).toBe(signed);
    expect(documentDownloadUrl(own.replace('file.pdf','Archivo%20p%C3%BAblico.pdf'))).toContain('Archivo%20p%C3%BAblico.pdf?alt=media');
  });
  it('a public source link is distinguished from a missing file and warns before leaving', () => {
    const confirm = vi.spyOn(window,'confirm').mockReturnValue(false);
    render(<ActDocumentLinks document={{url:'https://samai.consejodeestado.gov.co/public.pdf'}} />);
    expect(screen.getByText('Enlace registrado, sin copia propia')).toBeTruthy();
    fireEvent.click(screen.getByRole('link'));
    expect(confirm).toHaveBeenCalled();
    expect(actDocumentPresentation({}).href).toBeNull();
    cleanup();vi.restoreAllMocks();
  });
});

describe('canonical state count and request search', () => {
  it('23 incorporated states plus23 API observations render23, retaining every incorporated identity', () => {
    const local=Array.from({length:23},(_,i)=>({id:`local-${i}`,fuente:'SAMAI_ESTADOS',fecha:'2026-10-01',descripcion:`State ${i}`,pdf_url:null,gcs_url_auto:null,gcs_url_tabla:null,titulo_original:null,estado_numero:null}));
    const result=estadosDisplayInventory([...local,...local.map((r,i)=>({...r,id:`source-${i}`}))]);
    expect(result).toHaveLength(23);expect(result.map(r=>r.id)).toEqual(local.map(r=>r.id));
    expect(estadosDisplayInventory(local.map((r,i)=>({...r,id:`source-${i}`})))).toHaveLength(23);
  });
  it('finds a request present only in document metadata and produces a useful snippet', () => {
    const fields=actSearchFields({description:'RECIBE MEMORIALES',act_documents:JSON.stringify([{solicitud:'1074556'}])});
    expect(fields.some(f=>f.includes('1074556'))).toBe(true);
    expect(actSearchSnippet(fields,'1074556')).toContain('1074556');
    expect(actSearchFilter('1074556')).toContain('raw_data->>documentos.ilike.');
    expect(actSearchFilter('x),id.gt.0')).toContain(JSON.stringify('%x),id.gt.0%'));
  });
});
