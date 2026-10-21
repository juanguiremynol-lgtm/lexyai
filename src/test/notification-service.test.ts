import { describe, it, expect, vi, beforeEach } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { updateNotificationState } from '@/lib/alerts/notification-service';
describe('personal notification confirmation', () => {
 beforeEach(() => rpc.mockReset());
 it('confirms every selected row for dismissal', async () => {
  rpc.mockResolvedValue({ data: [{ notification_id: 'a' }, { notification_id: 'b' }], error: null });
  await updateNotificationState(['a','b'],'dismiss');
  expect(rpc).toHaveBeenCalledWith('set_notification_user_state', { _ids: ['a','b'], _action: 'dismiss', _until: null });
 });
 it('rejects missing row confirmation rather than silently succeeding', async () => {
  rpc.mockResolvedValue({ data: [{ notification_id: 'a' }], error: null });
  await expect(updateNotificationState(['a','b'],'dismiss')).rejects.toThrow();
 });
 it('preserves snooze time and propagates permission failures for rollback', async () => {
  rpc.mockResolvedValue({ error: new Error('denied'), data: null });
  await expect(updateNotificationState(['a'],'snooze','2026-10-21T08:00:00Z')).rejects.toThrow('denied');
  expect(rpc.mock.calls[0][1]._until).toBe('2026-10-21T08:00:00Z');
 });
});
