export const ACT_SEARCH_COLUMNS = 'id,work_item_id,act_type,description,act_date,act_annotation:raw_data->>anotacion,act_request:raw_data->>origen_solicitud,act_documents:raw_data->>documentos,legacy_documents:raw_data->>anexos_documentos';
export interface ActSearchRow extends Record<string, unknown> {
  id: string;
  work_item_id: string;
  act_type: string | null;
  description: string | null;
  act_date: string | null;
  act_annotation: string | null;
  act_request: string | null;
  act_documents: string | null;
  legacy_documents: string | null;
}
export function actSearchFields(act: Record<string, unknown>): string[] {
  return ['description', 'act_type', 'act_annotation', 'act_request', 'act_documents', 'legacy_documents']
    .map(key => typeof act[key] === 'string' ? act[key] as string : '').filter(Boolean);
}
export function actSearchFilter(token: string): string {
  const pattern = JSON.stringify(`%${token.replace(/[\\%_]/g, '\\$&')}%`);
  return ['description', 'act_type', 'raw_data->>anotacion', 'raw_data->>origen_solicitud', 'raw_data->>documentos', 'raw_data->>anexos_documentos']
    .map(field => `${field}.ilike.${pattern}`).join(',');
}
export function actSearchSnippet(fields: string[], query: string): string {
  const token = query.trim().split(/\s+/).sort((a,b) => b.length-a.length)[0]?.toLowerCase() || '';
  const text = fields.find(field => field.toLowerCase().includes(token)) || fields[0] || 'Sin descripción';
  const at = Math.max(0, text.toLowerCase().indexOf(token) - 35);
  return `${at ? '…' : ''}${text.slice(at, at + 140)}${text.length > at + 140 ? '…' : ''}`;
}
