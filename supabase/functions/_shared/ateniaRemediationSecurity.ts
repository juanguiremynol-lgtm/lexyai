/** Authentication and semantic outcomes for the privileged remediation worker. */
import { isPrivilegedCaller } from './privilegedCaller.ts';

export async function authorizeSupervisor(req: Request, admin: any): Promise<'system' | 'admin' | null> {
  if (await isPrivilegedCaller(req)) return 'system';
  const header = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(header)) return null;
  try {
    const token = header.replace(/^Bearer\s+/i, '');
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    const { data: row, error: adminError } = await admin.from('platform_admins')
      .select('user_id').eq('user_id', data.user.id).maybeSingle();
    return !adminError && row?.user_id === data.user.id ? 'admin' : null;
  } catch {
    return null;
  }
}

export function remediationHeaders(serviceKey: string, jobId: string): Record<string, string> {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
    'x-invoker-function': 'atenia-ai-supervisor', 'x-retry-task-id': jobId };
}

export function remediationVerdict(data: unknown): { outcome: 'DONE' | 'SKIPPED' | 'RETRY'; code: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { outcome: 'RETRY', code: 'INVALID_RESPONSE' };
  const r = data as Record<string, unknown>;
  const status = typeof r.status === 'string' ? r.status.toLowerCase() : '';
  const code = typeof r.code === 'string' ? r.code : typeof r.result_code === 'string' ? r.result_code : '';
  const hasErrors = r.errors != null && (!Array.isArray(r.errors) || r.errors.length > 0);
  if (r.pending_upstream || r.scraping_initiated || r.partial ||
      ['partial', 'partial_success', 'pending', 'pending_upstream', 'processing'].includes(status) ||
      ['PENDING_UPSTREAM', 'SCRAPING_INITIATED', 'PARTIAL_SOURCE'].includes(code)) {
    return { outcome: 'RETRY', code: code || 'INCOMPLETE' };
  }
  if (r.ok === true && !r.error && !hasErrors && ['skipped_paused', 'not_applicable'].includes(status)) {
    return { outcome: 'SKIPPED', code: status.toUpperCase() };
  }
  if (r.ok !== true || r.error || hasErrors) {
    return { outcome: 'RETRY', code: code || 'INGESTION_INCOMPLETE' };
  }
  return { outcome: 'DONE', code: 'SUCCESS' };
}
