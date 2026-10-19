/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { selectPublicationCopy } from '../../supabase/functions/_shared/publicationDocumentCopy';
import { openResolvedDocument } from '../lib/open-document-window';
const pub={id:'pub',work_item_id:'case',organization_id:'org',pdf_storage_path:'pub/a.pdf'};
const copy={publicacion_id:'pub',work_item_id:'case',organization_id:'org',status:'downloaded',storage_path:'pub/a.pdf'};
describe('publication-bound copies',()=>{
 it('opens only the selected downloaded association',()=>{expect(selectPublicationCopy(pub,[copy],copy.storage_path).path).toBe(copy.storage_path)});
 it('rejects another publication path even within the same organization',()=>{expect(selectPublicationCopy(pub,[copy],'other/b.pdf').error).toBe('document_not_associated')});
 it('rejects cross-work-item and cross-organization associations',()=>{for(const row of [{...copy,work_item_id:'other'},{...copy,organization_id:'other'},{...copy,publicacion_id:'other'}])expect(selectPublicationCopy(pub,[row],copy.storage_path).path).toBeNull()});
 it('does not claim failed, pending or unreadable files are openable',()=>{for(const status of ['failed','pending','skipped'])expect(selectPublicationCopy(pub,[{...copy,status}],copy.storage_path).error).toBe('document_recovery_pending')});
 it('retains separate files associated with one publication',()=>{const second={...copy,storage_path:'pub/b.pdf'};expect(selectPublicationCopy(pub,[copy,second],second.storage_path).path).toBe(second.storage_path)});
});
describe('browser activation',()=>{
 it('reserves a tab before resolving a delayed signed URL, without an opener',async()=>{
  const replace=vi.fn(),close=vi.fn(),tab={opener:window,location:{replace},close};
  const open=vi.spyOn(window,'open').mockReturnValue(tab as unknown as Window);
  const resolve=vi.fn(async()=>{expect(open).toHaveBeenCalledOnce();expect(tab.opener).toBeNull();await Promise.resolve();return 'https://files.test/doc.pdf'});
  expect(await openResolvedDocument(resolve)).toBe(true);expect(replace).toHaveBeenCalledWith('https://files.test/doc.pdf');expect(close).not.toHaveBeenCalled();open.mockRestore();
 });
 it('closes the blank tab on denied access',async()=>{
  const close=vi.fn(),open=vi.spyOn(window,'open').mockReturnValue({opener:null,close} as unknown as Window);
  expect(await openResolvedDocument(async()=>null)).toBe(false);expect(close).toHaveBeenCalledOnce();
  open.mockRestore();
 });
 it('opens in the current tab when popups are blocked, without asking the lawyer to repair the browser flow',async()=>{
  const assign=vi.fn();vi.stubGlobal('window',{open:()=>null,location:{assign}});
  try { expect(await openResolvedDocument(async()=> 'https://files.test/doc.pdf')).toBe(true);expect(assign).toHaveBeenCalledWith('https://files.test/doc.pdf'); }
  finally { vi.unstubAllGlobals(); }
 });
});
