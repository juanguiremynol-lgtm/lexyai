/**
 * useNotifications — Unified role-aware notification hook
 *
 * Determines user role (USER / ORG_ADMIN / SUPER_ADMIN) and queries
 * only the notifications the user is allowed to see. RLS on the
 * `notifications` table enforces this server-side; the client
 * simply fetches everything visible and counts unread.
 *
 * Provides: items, unreadCount, markRead, markAllRead, dismiss, dismissAll.
 * Real-time updates via Supabase channel subscription.
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { updateNotificationState } from '@/lib/alerts/notification-service';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';
import { useOrganizationMembership } from '@/hooks/use-organization-membership';

// ── Types ──────────────────────────────────────────────────────────
export type NotificationAudience = 'USER' | 'ORG_ADMIN' | 'SUPER_ADMIN';
export type NotificationCategory =
  | 'TERMS'
  | 'WORK_ITEM_ALERTS'
  | 'ORG_ACTIVITY'
  | 'OPS_SYNC'
  | 'OPS_INCIDENTS'
  | 'OPS_E2E'
  | 'OPS_WATCHDOG'
  | 'OPS_REMEDIATION'
  | 'SYSTEM';

export interface Notification {
  id: string;
  audience_scope: NotificationAudience;
  user_id: string | null;
  org_id: string | null;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string | null;
  severity: string;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  metadata: Record<string, unknown> | null;
  deep_link: string | null;
  work_item_id: string | null;
}

export type UserRole = 'USER' | 'ORG_ADMIN' | 'SUPER_ADMIN';

// Categories each role can see
const ROLE_CATEGORIES: Record<UserRole, NotificationCategory[]> = {
  USER: ['TERMS', 'WORK_ITEM_ALERTS'],
  ORG_ADMIN: ['TERMS', 'WORK_ITEM_ALERTS', 'ORG_ACTIVITY'],
  SUPER_ADMIN: ['TERMS', 'WORK_ITEM_ALERTS', 'OPS_SYNC', 'OPS_INCIDENTS', 'OPS_E2E', 'OPS_WATCHDOG', 'OPS_REMEDIATION', 'SYSTEM'],
};

// Tab labels per role
export const ROLE_TABS: Record<UserRole, { key: NotificationCategory | 'ALL'; label: string }[]> = {
  USER: [
    { key: 'ALL', label: 'Todas' },
    { key: 'TERMS', label: 'Términos' },
    { key: 'WORK_ITEM_ALERTS', label: 'Asuntos' },
  ],
  ORG_ADMIN: [
    { key: 'ALL', label: 'Todas' },
    { key: 'TERMS', label: 'Términos' },
    { key: 'WORK_ITEM_ALERTS', label: 'Asuntos' },
    { key: 'ORG_ACTIVITY', label: 'Organización' },
  ],
  SUPER_ADMIN: [
    { key: 'ALL', label: 'Todas' },
    { key: 'WORK_ITEM_ALERTS', label: 'Mis asuntos' },
    { key: 'TERMS', label: 'Términos' },
    { key: 'OPS_SYNC', label: 'Operaciones' },
    { key: 'OPS_INCIDENTS', label: 'Incidentes' },
    { key: 'OPS_E2E', label: 'E2E' },
    { key: 'OPS_WATCHDOG', label: 'Watchdog' },
  ],
};

const QUERY_KEY = 'unified-notifications';
const UNREAD_KEY = 'unified-notifications-unread';

// User identity and organization are always part of cache isolation.
export function useNotifications(options?: { categoryFilter?: NotificationCategory | 'ALL'; limit?: number }) {
  const { categoryFilter = 'ALL', limit = 30 } = options || {};
  const { organization } = useOrganization();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { isAdmin: isOrgAdmin } = useOrganizationMembership(organization?.id || null);
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => { if (active) setUserId(data.user?.id ?? null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const effectiveRole: UserRole = isPlatformAdmin ? 'SUPER_ADMIN' : isOrgAdmin ? 'ORG_ADMIN' : 'USER';
  const prefix = useMemo(() => [QUERY_KEY, userId, organization?.id ?? null], [userId, organization?.id]);
  const allowedCategories = ROLE_CATEGORIES[effectiveRole];
  const scope = (countOnly = false) => {
    let q = supabase.from('notification_inbox').select('*', countOnly ? { count: 'exact', head: true } : {}).in('category', allowedCategories);
    const audiences = [`and(audience_scope.eq.USER,user_id.eq.${userId})`];
    if (isOrgAdmin && organization?.id) audiences.push(`and(audience_scope.eq.ORG_ADMIN,org_id.eq.${organization.id})`);
    if (isPlatformAdmin) audiences.push('audience_scope.eq.SUPER_ADMIN');
    q = q.or(audiences.join(','));
    if (categoryFilter !== 'ALL') q = q.eq('category', categoryFilter);
    return q;
  };
  const { data: notifications = [], refetch, isError } = useQuery({
    queryKey: [...prefix, 'items', effectiveRole, categoryFilter, limit],
    queryFn: async ({ signal }) => {
      const { data, error } = await scope().order('created_at', { ascending: false }).limit(limit).abortSignal(signal);
      if (error) throw error;
      return (data ?? []).map(n => ({ ...n, read_at: n.effective_read_at })) as Notification[];
    }, enabled: !!userId, staleTime: 15_000, refetchInterval: 30_000,
  });
  const { data: unreadCount = 0 } = useQuery({
    queryKey: [...prefix, 'unread', effectiveRole, categoryFilter],
    queryFn: async ({ signal }) => {
      const { count, error } = await scope(true).is('effective_read_at', null).abortSignal(signal);
      if (error) throw error;
      return count ?? 0;
    }, enabled: !!userId, staleTime: 10_000, refetchInterval: 30_000,
  });
  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: prefix }), [queryClient, prefix]);
  type Change = { ids: string[]; action: 'read' | 'dismiss' | 'snooze'; until?: string };
  const mutation = useMutation({
    scope: { id: `notification-actions-${userId}-${organization?.id}` },
    mutationFn: (change: Change) => updateNotificationState(change.ids, change.action, change.until),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: prefix });
      const snapshot = queryClient.getQueriesData({ queryKey: prefix });
      const targets = new Set(change.ids);
      queryClient.setQueriesData({ queryKey: [...prefix, 'items'] }, (old: Notification[] | undefined) =>
        change.action === 'read' ? old?.map(n => targets.has(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)
          : old?.filter(n => !targets.has(n.id)));
      // Only counts whose category includes the affected rows are changed.
      for (const [key, value] of snapshot) {
        if (key[3] !== 'unread' || typeof value !== 'number') continue;
        const category = key[5];
        const removed = notifications.filter(n => targets.has(n.id) && !n.read_at && (category === 'ALL' || category === n.category)).length;
        queryClient.setQueryData(key, Math.max(0, value - removed));
      }
      return { snapshot };
    },
    onError: (_error, _change, context) => context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data)),
    onSettled: () => invalidate(),
  });
  const command = (action: Change['action'], all = false) => ({
    mutate: (id?: string) => mutation.mutate({ ids: all ? notifications.map(n => n.id) : id ? [id] : [], action }),
    isPending: mutation.isPending,
  });
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`notifications-${userId}-${organization?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => invalidate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_user_state', filter: `user_id=eq.${userId}` }, () => invalidate()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, organization?.id, invalidate]);
  return { notifications, unreadCount, effectiveRole, tabs: ROLE_TABS[effectiveRole], allowedCategories,
    markRead: command('read'), markAllRead: command('read', true), dismiss: command('dismiss'), dismissAll: command('dismiss', true),
    snooze: { mutate: ({ id, until }: { id: string; until: string }) => mutation.mutate({ ids: [id], action: 'snooze', until }), isPending: mutation.isPending },
    error: mutation.error ?? (isError ? new Error('No se pudieron cargar las notificaciones') : null), refetch };
}
