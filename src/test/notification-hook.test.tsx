/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { update, identity } = vi.hoisted(() => ({ update: vi.fn(), identity: { id: 'user-a', org: 'org-a' } }));
vi.mock('@/lib/alerts/notification-service', () => ({ updateNotificationState: update }));
vi.mock('@/contexts/OrganizationContext', () => ({ useOrganization: () => ({ organization: { id: identity.org } }) }));
vi.mock('@/hooks/use-platform-admin', () => ({ usePlatformAdmin: () => ({ isPlatformAdmin: true }) }));
vi.mock('@/hooks/use-organization-membership', () => ({ useOrganizationMembership: () => ({ isAdmin: true }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
 auth: { getUser: async () => ({ data: { user: { id: identity.id } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
 from: () => { const q: any = { select: () => q, in: () => q, or: () => q, eq: () => q, order: () => q, limit: () => q, is: () => q, abortSignal: () => q, then: (resolve: any) => resolve({ data: [{ id: 'n1', category: 'WORK_ITEM_ALERTS', effective_read_at: null, read_at: null }], count: 1, error: null }) }; return q; },
 channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; }, removeChannel() {},
} }));
import { useNotifications } from '@/hooks/use-notifications';
describe('notification cache scope and rollback', () => {
 it('cancels in-flight reads, optimistically hides, rolls back, and leaves other user/org/category counts untouched', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const cancel = vi.spyOn(client, 'cancelQueries');
  const other = ['unified-notifications','user-b','org-a','items','SUPER_ADMIN','ALL',30];
  const category = ['unified-notifications','user-a','org-a','unread','SUPER_ADMIN','OPS_SYNC'];
  client.setQueryData(other,[{ id:'other' }]);client.setQueryData(category,8);
  let reject: (e: Error) => void = () => {};
  update.mockImplementation(() => new Promise((_resolve,r) => { reject=r; }));
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useNotifications(), { wrapper });
  await waitFor(() => expect(result.current.notifications).toHaveLength(1));
  act(() => result.current.dismiss.mutate('n1'));
  await waitFor(() => expect(result.current.notifications).toHaveLength(0));
  expect(cancel).toHaveBeenCalledWith({ queryKey: ['unified-notifications','user-a','org-a'] });
  expect(client.getQueryData(other)).toEqual([{ id:'other' }]);expect(client.getQueryData(category)).toBe(8);
  act(() => reject(new Error('permission denied')));
  await waitFor(() => expect(result.current.notifications).toHaveLength(1));
  expect(result.current.error).toBeTruthy();
  expect(result.current.allowedCategories).toContain('WORK_ITEM_ALERTS');
  expect(client.getQueryData(other)).toEqual([{ id:'other' }]);
 });
});
