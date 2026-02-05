/**
 * Actuaciones de Hoy Service
 * 
 * Fetches work_item_acts for a specific date range across all work items
 * in the organization. Colombia timezone aware.
 */

import { supabase } from '@/integrations/supabase/client';
import { detectActuacionSeverity, type TickerItemSeverity, type TickerItemSource } from './ticker-data-service';

export interface ActuacionHoyItem {
  id: string;
  work_item_id: string;
  radicado: string;
  authority_name: string | null;
  workflow_type: string;
  demandantes: string | null;
  demandados: string | null;
  client_name: string | null;
  description: string;
  annotation: string | null;
  act_date: string | null;
  act_type: string | null;
  source: TickerItemSource;
  is_notifiable: boolean;
  severity: TickerItemSeverity;
  is_significant: boolean;
  created_at: string;
}

export type DateRange = 'today' | 'yesterday' | 'week';

function getColombiaDate(offset: number = 0): string {
  const now = new Date();
  const colombiaOffset = -5 * 60;
  const localOffset = now.getTimezoneOffset();
  const colombiaTime = new Date(now.getTime() + (localOffset + colombiaOffset) * 60000);
  colombiaTime.setDate(colombiaTime.getDate() + offset);
  return colombiaTime.toISOString().split('T')[0];
}

function getDateRange(range: DateRange): { from: string; to: string } {
  const today = getColombiaDate(0);
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: getColombiaDate(-1), to: getColombiaDate(-1) };
    case 'week':
      return { from: getColombiaDate(-6), to: today };
  }
}

const SIGNIFICANT_TYPES = ['SENTENCIA', 'AUTO_ADMISORIO', 'AUDIENCIA', 'NOTIFICACION', 'MANDAMIENTO_DE_PAGO', 'AUTO_INTERLOCUTORIO'];

function isSignificant(description: string, actType: string | null): boolean {
  if (actType && SIGNIFICANT_TYPES.includes(actType.toUpperCase())) return true;
  const lower = description.toLowerCase();
  return (
    lower.includes('sentencia') ||
    lower.includes('auto admisorio') ||
    lower.includes('audiencia') ||
    lower.includes('auto interlocutorio') ||
    lower.includes('mandamiento de pago')
  );
}

function mapSource(source: string | null | undefined): TickerItemSource {
  if (!source) return 'MANUAL';
  const lower = source.toLowerCase();
  if (lower.includes('cpnu')) return 'CPNU';
  if (lower.includes('samai')) return 'SAMAI';
  if (lower.includes('icarus')) return 'ICARUS';
  return 'CPNU';
}

export async function getActuacionesHoy(
  organizationId: string,
  range: DateRange = 'today',
  search?: string
): Promise<{ items: ActuacionHoyItem[]; total: number }> {
  const { from, to } = getDateRange(range);

  const query = supabase
    .from('work_item_acts')
    .select(`
      id,
      work_item_id,
      description,
      annotation,
      act_date,
      act_type,
      source,
      is_notifiable,
      created_at,
      work_items!inner (
        id,
        radicado,
        workflow_type,
        organization_id,
        authority_name,
        demandantes,
        demandados,
        client:clients ( name )
      )
    `)
    .eq('work_items.organization_id', organizationId)
    .gte('act_date', from)
    .lte('act_date', to)
    .eq('is_archived', false)
    .order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    console.error('[actuaciones-hoy] Query error:', error);
    return { items: [], total: 0 };
  }

  let items: ActuacionHoyItem[] = (data || []).map((act: any) => {
    const wi = act.work_items;
    const desc = act.description || 'Actuación registrada';
    return {
      id: act.id,
      work_item_id: act.work_item_id,
      radicado: wi?.radicado || '',
      authority_name: wi?.authority_name || null,
      workflow_type: wi?.workflow_type || '',
      demandantes: wi?.demandantes || null,
      demandados: wi?.demandados || null,
      client_name: wi?.client?.name || null,
      description: desc,
      annotation: act.annotation || null,
      act_date: act.act_date,
      act_type: act.act_type || null,
      source: mapSource(act.source),
      is_notifiable: act.is_notifiable ?? false,
      severity: detectActuacionSeverity(desc),
      is_significant: isSignificant(desc, act.act_type),
      created_at: act.created_at,
    };
  });

  // Client-side search filter
  if (search) {
    const lower = search.toLowerCase();
    items = items.filter(i =>
      i.radicado?.toLowerCase().includes(lower) ||
      i.authority_name?.toLowerCase().includes(lower) ||
      i.demandantes?.toLowerCase().includes(lower) ||
      i.demandados?.toLowerCase().includes(lower) ||
      i.description?.toLowerCase().includes(lower) ||
      i.client_name?.toLowerCase().includes(lower)
    );
  }

  return { items, total: items.length };
}
