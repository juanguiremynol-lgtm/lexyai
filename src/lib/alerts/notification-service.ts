import { supabase } from '@/integrations/supabase/client';
/** Personal state never edits the shared notification or its dedupe identity. */
export async function updateNotificationState(ids: string[], action: 'read' | 'dismiss' | 'snooze', until?: string) {
  if (!ids.length) return [];
  const { data, error } = await supabase.rpc('set_notification_user_state', { _ids: ids, _action: action, _until: until ?? null });
  if (error) throw error;
  const confirmed = new Set((data ?? []).map(row => row.notification_id));
  if (confirmed.size !== ids.length || ids.some(id => !confirmed.has(id))) throw new Error('No se confirmó el cambio de la notificación');
  return data;
}
