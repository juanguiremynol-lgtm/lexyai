/**
 * Judicial Term Suspensions System
 * 
 * Manages periods where judicial terms are suspended (e.g., "vacancia judicial").
 * CRITICAL: These suspensions ONLY affect judicial matters (CGP, Tutelas).
 * Peticiones and administrative processes are NOT affected.
 */

import { supabase } from "@/integrations/supabase/client";
import { parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";

export type SuspensionScope = 'GLOBAL_JUDICIAL' | 'BY_JURISDICTION' | 'BY_COURT';

export interface JudicialTermSuspension {
  id: string;
  owner_id: string;
  title: string;
  reason?: string | null;
  start_date: string;
  end_date: string;
  scope: SuspensionScope;
  scope_value?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch all active judicial term suspensions for the current user
 */
export async function getActiveJudicialSuspensions(): Promise<JudicialTermSuspension[]> {
  const { data, error } = await supabase
    .from('judicial_term_suspensions')
    .select('*')
    .eq('active', true)
    .order('start_date', { ascending: true });

  if (error) {
    console.error('Error fetching judicial suspensions:', error);
    return [];
  }

  return (data || []) as JudicialTermSuspension[];
}

/**
 * Check if a specific date falls within any active judicial suspension
 * Returns the suspension if found, null otherwise
 */
export function isDateInSuspension(
  date: Date,
  suspensions: JudicialTermSuspension[],
  scope?: { jurisdiction?: string; court?: string }
): JudicialTermSuspension | null {
  const checkDate = startOfDay(date);

  for (const suspension of suspensions) {
    if (!suspension.active) continue;

    const startDate = startOfDay(parseISO(suspension.start_date));
    const endDate = endOfDay(parseISO(suspension.end_date));

    const isInRange = isWithinInterval(checkDate, { start: startDate, end: endDate });
    if (!isInRange) continue;

    // Check scope matching
    if (suspension.scope === 'GLOBAL_JUDICIAL') {
      return suspension;
    }

    if (suspension.scope === 'BY_JURISDICTION' && scope?.jurisdiction) {
      if (suspension.scope_value?.toLowerCase() === scope.jurisdiction.toLowerCase()) {
        return suspension;
      }
    }

    if (suspension.scope === 'BY_COURT' && scope?.court) {
      if (suspension.scope_value?.toLowerCase() === scope.court.toLowerCase()) {
        return suspension;
      }
    }
  }

  return null;
}

/**
 * Get the current judicial term status
 * Returns info about whether terms are active or suspended today
 */
export async function getCurrentJudicialTermStatus(): Promise<{
  isActive: boolean;
  suspension: JudicialTermSuspension | null;
}> {
  const suspensions = await getActiveJudicialSuspensions();
  const today = new Date();
  const suspension = isDateInSuspension(today, suspensions);

  return {
    isActive: suspension === null,
    suspension,
  };
}

/**
 * Create a new judicial term suspension
 */
export async function createJudicialSuspension(
  data: Omit<JudicialTermSuspension, 'id' | 'owner_id' | 'created_at' | 'updated_at'>
): Promise<{ success: boolean; error?: string; data?: JudicialTermSuspension }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: result, error } = await supabase
    .from('judicial_term_suspensions')
    .insert({
      ...data,
      owner_id: user.id,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: result as JudicialTermSuspension };
}

/**
 * Update an existing judicial term suspension
 */
export async function updateJudicialSuspension(
  id: string,
  data: Partial<Omit<JudicialTermSuspension, 'id' | 'owner_id' | 'created_at' | 'updated_at'>>
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('judicial_term_suspensions')
    .update(data)
    .eq('id', id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Delete (deactivate) a judicial term suspension
 */
export async function deleteJudicialSuspension(id: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('judicial_term_suspensions')
    .delete()
    .eq('id', id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
