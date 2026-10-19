import {describe,it,expect} from 'vitest';
import {reconcileEstados} from '../lib/reconcile-estados';
const local={id:'local-pub1',fuente:'PUBLICACIONES',fecha:'2026-10-14',descripcion:'Estado completo',hash_documento:'file-A',pdf_url:null,gcs_url_auto:null,gcs_url_tabla:null,titulo_original:null,estado_numero:null};
const api={...local,id:12,fuente:'PP',pdf_url:'https://provider.test/document'};
describe('state display identity',()=>{
 it('keeps the permission-bound publication id when an API observation matches',()=>{const rows=reconcileEstados([api,local]);expect(rows).toHaveLength(1);expect(rows[0].id).toBe('local-pub1');expect(rows[0].fecha).toBe(local.fecha)});
 it('does not merge distinct local publications that share identical bytes',()=>{expect(reconcileEstados([local,{...local,id:'local-pub2'}])).toHaveLength(2)});
 it('does not choose an arbitrary publication when the same API document matches two local records',()=>{expect(reconcileEstados([api,local,{...local,id:'local-pub2'}])).toHaveLength(3)});
 it('preserves publications on nearby dates and different native source ids',()=>{expect(reconcileEstados([api,{...api,id:13},{...local,fecha:'2026-10-15'}])).toHaveLength(3)});
 it('does not fuse sources or metadata-only matches',()=>{expect(reconcileEstados([local,{...api,fuente:'SAMAI_ESTADOS'}])).toHaveLength(2);expect(reconcileEstados([{...local,hash_documento:null},{...api,hash_documento:null,pdf_url:null}])).toHaveLength(2)});
 it('preserves the complete source text instead of matching its first 200 characters',()=>{const prefix='x'.repeat(210);expect(reconcileEstados([{...local,descripcion:prefix+' first'},{...api,descripcion:prefix+' second'}])).toHaveLength(2)});
});
