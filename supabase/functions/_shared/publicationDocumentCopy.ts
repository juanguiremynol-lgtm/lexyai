interface Publication { id: string; work_item_id: string; organization_id: string | null; pdf_storage_path?: string | null }
interface Copy { publicacion_id: string; work_item_id: string; organization_id: string | null; status: string; storage_path: string | null }
export function selectPublicationCopy(pub: Publication, copies: Copy[], requested: string | null): { path: string | null; error?: string } {
  const own = copies.filter(c => c.publicacion_id === pub.id && c.work_item_id === pub.work_item_id && c.organization_id === pub.organization_id);
  const safe = (path: string | null): path is string => !!path && !path.startsWith('/') && !path.includes('://') && !path.split('/').some(p => p === '..' || p === '.');
  if (requested && !own.some(c => c.storage_path === requested)) return { path: null, error: 'document_not_associated' };
  const available = own.filter(c => c.status === 'downloaded' && safe(c.storage_path));
  const selected = requested ? available.find(c => c.storage_path === requested)
    : available.find(c => c.storage_path === pub.pdf_storage_path) || available[0];
  return selected?.storage_path ? { path: selected.storage_path } : { path: null, error: 'document_recovery_pending' };
}
