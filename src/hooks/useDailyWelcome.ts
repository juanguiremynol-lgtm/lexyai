/**
 * useDailyWelcome Hook
 * 
 * Manages the daily AI-powered welcome message system:
 * - Triggers generation on user login (on business days only)
 * - Fetches existing welcome message for today
 * - Provides dismiss functionality
 * - Respects business days and judicial suspensions
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { getTodayTermStatus } from '@/lib/term-calculator';
import { format } from 'date-fns';

export interface DailyWelcomeAlert {
  id: string;
  title: string;
  message: string;
  created_at: string;
  payload: {
    alert_type: string;
    new_estados_count?: number;
    new_actuaciones_count?: number;
    work_items_count?: number;
    work_items?: Array<{
      id: string;
      radicado: string;
      workflow_type: string;
      estados_count: number;
      actuaciones_count: number;
    }>;
  };
}

export interface UseDailyWelcomeResult {
  /** The current welcome alert (if any) */
  welcomeAlert: DailyWelcomeAlert | null;
  /** Whether the system is loading/generating */
  isLoading: boolean;
  /** Whether the welcome dialog should be shown */
  shouldShowDialog: boolean;
  /** Dismiss the welcome for today */
  dismissForToday: () => Promise<void>;
  /** Whether today is a business day (welcome messages only show on business days) */
  isBusinessDay: boolean;
  /** Reason if not a business day (e.g., "Vacancia Judicial") */
  nonBusinessDayReason?: string;
  /** Manually refresh the welcome alert */
  refresh: () => Promise<void>;
}

/**
 * Hook to manage daily welcome messages
 * Should be used in TenantLayout after authentication
 */
export function useDailyWelcome(): UseDailyWelcomeResult {
  const { organization } = useOrganization();
  const [welcomeAlert, setWelcomeAlert] = useState<DailyWelcomeAlert | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldShowDialog, setShouldShowDialog] = useState(false);
  const [isBusinessDay, setIsBusinessDay] = useState(true);
  const [nonBusinessDayReason, setNonBusinessDayReason] = useState<string | undefined>();
  
  const hasTriggeredRef = useRef(false);
  const lastOrgIdRef = useRef<string | null>(null);

  /**
   * Check business day status
   */
  const checkBusinessDay = useCallback(async () => {
    try {
      const status = await getTodayTermStatus();
      
      // For welcome messages, we use judicial business day rules
      const isBizDay = status.isJudicialBusinessDay;
      setIsBusinessDay(isBizDay);
      
      if (!isBizDay) {
        if (status.activeSuspension) {
          setNonBusinessDayReason(`Términos suspendidos: ${status.activeSuspension.title}`);
        } else if (status.holidayName) {
          setNonBusinessDayReason(`Festivo: ${status.holidayName}`);
        } else {
          const today = new Date();
          const dayName = today.getDay() === 0 ? 'Domingo' : 'Sábado';
          setNonBusinessDayReason(`Fin de semana (${dayName})`);
        }
      } else {
        setNonBusinessDayReason(undefined);
      }
      
      return isBizDay;
    } catch (err) {
      console.error('[useDailyWelcome] Error checking business day:', err);
      // Default to true if we can't determine
      return true;
    }
  }, []);

  /**
   * Fetch today's welcome alert
   */
  const fetchTodayWelcome = useCallback(async (userId: string) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const { data, error } = await supabase
      .from('alert_instances')
      .select('id, title, message, created_at, payload, dismissed_at')
      .eq('owner_id', userId)
      .eq('entity_type', 'USER')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[useDailyWelcome] Error fetching alerts:', error);
      return null;
    }

    // Find the DAILY_WELCOME alert that hasn't been dismissed
    const welcomeAlerts = (data || []).filter(
      a => (a.payload as any)?.alert_type === 'DAILY_WELCOME' && !a.dismissed_at
    );

    if (welcomeAlerts.length > 0) {
      const alert = welcomeAlerts[0];
      return {
        id: alert.id,
        title: alert.title,
        message: alert.message,
        created_at: alert.created_at,
        payload: alert.payload as DailyWelcomeAlert['payload'],
      };
    }

    return null;
  }, []);

  /**
   * Trigger welcome message generation via edge function
   */
  const triggerGeneration = useCallback(async (userId: string) => {
    console.log('[useDailyWelcome] Triggering welcome generation for user:', userId);
    
    try {
      const { data, error } = await supabase.functions.invoke('scheduled-daily-welcome', {
        body: { user_id: userId },
      });

      if (error) {
        console.error('[useDailyWelcome] Generation error:', error);
        return null;
      }

      console.log('[useDailyWelcome] Generation result:', data);
      
      // If generation was skipped (not business day), return the reason
      if (data?.skipped) {
        return { skipped: true, reason: data.reason };
      }

      // Fetch the newly created alert
      return fetchTodayWelcome(userId);
    } catch (err) {
      console.error('[useDailyWelcome] Failed to trigger generation:', err);
      return null;
    }
  }, [fetchTodayWelcome]);

  /**
   * Dismiss the welcome alert for today
   */
  const dismissForToday = useCallback(async () => {
    if (!welcomeAlert) return;

    const { error } = await supabase
      .from('alert_instances')
      .update({
        status: 'DISMISSED',
        dismissed_at: new Date().toISOString(),
      })
      .eq('id', welcomeAlert.id);

    if (error) {
      console.error('[useDailyWelcome] Error dismissing alert:', error);
      return;
    }

    // Store in localStorage to persist across tabs/sessions for the day
    const dismissKey = `daily_welcome_dismissed_${format(new Date(), 'yyyy-MM-dd')}`;
    localStorage.setItem(dismissKey, 'true');

    setShouldShowDialog(false);
    setWelcomeAlert(null);
  }, [welcomeAlert]);

  /**
   * Manual refresh
   */
  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setIsLoading(true);
    const alert = await fetchTodayWelcome(user.id);
    setWelcomeAlert(alert);
    
    if (alert) {
      const dismissKey = `daily_welcome_dismissed_${format(new Date(), 'yyyy-MM-dd')}`;
      if (!localStorage.getItem(dismissKey)) {
        setShouldShowDialog(true);
      }
    }
    
    setIsLoading(false);
  }, [fetchTodayWelcome]);

  // Main effect - runs on login/org change
  useEffect(() => {
    if (!organization?.id) return;

    // Prevent double-triggering in same session
    if (organization.id === lastOrgIdRef.current && hasTriggeredRef.current) {
      return;
    }

    lastOrgIdRef.current = organization.id;

    const initDailyWelcome = async () => {
      setIsLoading(true);

      try {
        // Check if user is authenticated
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.log('[useDailyWelcome] No authenticated user');
          setIsLoading(false);
          return;
        }

        // Check if already dismissed today (localStorage persists across tabs)
        const dismissKey = `daily_welcome_dismissed_${format(new Date(), 'yyyy-MM-dd')}`;
        if (localStorage.getItem(dismissKey)) {
          console.log('[useDailyWelcome] Already dismissed for today');
          hasTriggeredRef.current = true;
          setIsLoading(false);
          return;
        }

        // Check business day status
        const isBizDay = await checkBusinessDay();
        if (!isBizDay) {
          console.log('[useDailyWelcome] Not a business day, skipping');
          hasTriggeredRef.current = true;
          setIsLoading(false);
          return;
        }

        // Check if we already have today's welcome
        const existingAlert = await fetchTodayWelcome(user.id);
        
        if (existingAlert) {
          console.log('[useDailyWelcome] Found existing welcome alert');
          setWelcomeAlert(existingAlert);
          setShouldShowDialog(true);
          hasTriggeredRef.current = true;
          setIsLoading(false);
          return;
        }

        // Check localStorage to prevent multiple generation attempts across tabs/logins
        const genKey = `daily_welcome_gen_${organization.id}_${format(new Date(), 'yyyy-MM-dd')}`;
        if (localStorage.getItem(genKey)) {
          console.log('[useDailyWelcome] Already attempted generation today');
          hasTriggeredRef.current = true;
          setIsLoading(false);
          return;
        }

        // Mark generation attempt (persists across tabs for the day)
        localStorage.setItem(genKey, 'true');

        // Trigger generation
        console.log('[useDailyWelcome] Triggering new welcome generation');
        const result = await triggerGeneration(user.id);
        
        if (result && 'skipped' in result) {
          // Generation was skipped due to business day check on server
          setNonBusinessDayReason(result.reason);
          setIsBusinessDay(false);
        } else if (result) {
          setWelcomeAlert(result as DailyWelcomeAlert);
          setShouldShowDialog(true);
        }

        hasTriggeredRef.current = true;
      } catch (err) {
        console.error('[useDailyWelcome] Init error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    // Delay to not block UI on login
    const timeoutId = setTimeout(initDailyWelcome, 2000);

    return () => clearTimeout(timeoutId);
  }, [organization?.id, checkBusinessDay, fetchTodayWelcome, triggerGeneration]);

  return {
    welcomeAlert,
    isLoading,
    shouldShowDialog,
    dismissForToday,
    isBusinessDay,
    nonBusinessDayReason,
    refresh,
  };
}
