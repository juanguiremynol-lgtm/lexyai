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

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
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
  SUPER_ADMIN: ['OPS_SYNC', 'OPS_INCIDENTS', 'OPS_E2E', 'OPS_WATCHDOG', 'OPS_REMEDIATION', 'SYSTEM'],
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
    { key: 'OPS_SYNC', label: 'Sync' },
    { key: 'OPS_INCIDENTS', label: 'Incidentes' },
    { key: 'OPS_E2E', label: 'E2E' },
    { key: 'OPS_WATCHDOG', label: 'Watchdog' },
  ],
};

const QUERY_KEY = 'unified-notifications';
const UNREAD_KEY = 'unified-notifications-unread';

// ── Hook ───────────────────────────────────────────────────────────
export function useNotifications(options?: { categoryFilter?: NotificationCategory | 'ALL'; limit?: number }) {
  const { categoryFilter = 'ALL', limit = 30 } = options || {};
  const { organization } = useOrganization();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { isAdmin: isOrgAdmin } = useOrganizationMembership(organization?.id || null);
  const queryClient = useQueryClient();
  const userIdRef = useRef<string | null>(null);

  // Determine effective role
  const effectiveRole: UserRole = useMemo(() => {
    if (isPlatformAdmin) return 'SUPER_ADMIN';
    if (isOrgAdmin) return 'ORG_ADMIN';
    return 'USER';
  }, [isPlatformAdmin, isOrgAdmin]);

  // Get user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      userIdRef.current = data?.user?.id ?? null;
    });
  }, []);

  // ── Fetch notifications (RLS handles visibility) ──
  const { data: notifications = [], refetch } = useQuery({
    queryKey: [QUERY_KEY, effectiveRole, categoryFilter, organization?.id],
    queryFn: async () => {
      let query = (supabase.from('notifications') as any)
        .select('*')
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (categoryFilter !== 'ALL') {
        query = query.eq('category', categoryFilter);
      }

      const { data, error } = await query;
      if (error) {
        console.error('[useNotifications] fetch error:', error);
        return [];
      }
      return (data || []) as Notification[];
    },
    enabled: true,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  // ── Unread count (separate lightweight query) ──
  const { data: unreadCount = 0 } = useQuery({
    queryKey: [UNREAD_KEY, effectiveRole, organization?.id],
    queryFn: async () => {
      const { count, error } = await (supabase.from('notifications') as any)
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
        .is('dismissed_at', null);

      if (error) {
        console.error('[useNotifications] unread count error:', error);
        return 0;
      }
      return count ?? 0;
    },
    enabled: true,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // ── Invalidation helper ──
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: [UNREAD_KEY] });
  }, [queryClient]);

  // ── Mark single as read ──
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('notifications') as any)
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (error) throw error;
    },
    onMutate: async (id) => {
      // Optimistic: update read_at in cache
      queryClient.setQueriesData({ queryKey: [QUERY_KEY] }, (old: Notification[] | undefined) =>
        old?.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n)
      );
      // Optimistic: decrement unread count
      queryClient.setQueriesData({ queryKey: [UNREAD_KEY] }, (old: number | undefined) =>
        Math.max(0, (old ?? 1) - 1)
      );
    },
    onSettled: () => invalidate(),
  });

  // ── Mark all as read (in current scope) ──
  const markAllRead = useMutation({
    mutationFn: async () => {
      let query = (supabase.from('notifications') as any)
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null)
        .is('dismissed_at', null);

      if (categoryFilter !== 'ALL') {
        query = query.eq('category', categoryFilter);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onMutate: async () => {
      queryClient.setQueriesData({ queryKey: [QUERY_KEY] }, (old: Notification[] | undefined) =>
        old?.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
      );
      queryClient.setQueriesData({ queryKey: [UNREAD_KEY] }, () => 0);
    },
    onSettled: () => invalidate(),
  });

  // ── Dismiss single ──
  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('notifications') as any)
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      const was = notifications.find(n => n.id === id);
      queryClient.setQueriesData({ queryKey: [QUERY_KEY] }, (old: Notification[] | undefined) =>
        old?.filter(n => n.id !== id)
      );
      if (was && !was.read_at) {
        queryClient.setQueriesData({ queryKey: [UNREAD_KEY] }, (old: number | undefined) =>
          Math.max(0, (old ?? 1) - 1)
        );
      }
    },
    onSettled: () => invalidate(),
  });

  // ── Dismiss all ──
  const dismissAll = useMutation({
    mutationFn: async () => {
      let query = (supabase.from('notifications') as any)
        .update({ dismissed_at: new Date().toISOString() })
        .is('dismissed_at', null);

      if (categoryFilter !== 'ALL') {
        query = query.eq('category', categoryFilter);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onMutate: async () => {
      queryClient.setQueriesData({ queryKey: [QUERY_KEY] }, () => []);
      queryClient.setQueriesData({ queryKey: [UNREAD_KEY] }, () => 0);
    },
    onSettled: () => invalidate(),
  });

  // ── Real-time subscription ──
  useEffect(() => {
    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
        },
        () => {
          invalidate();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [invalidate]);

  return {
    notifications,
    unreadCount,
    effectiveRole,
    tabs: ROLE_TABS[effectiveRole],
    allowedCategories: ROLE_CATEGORIES[effectiveRole],
    markRead,
    markAllRead,
    dismiss,
    dismissAll,
    refetch,
  };
}
