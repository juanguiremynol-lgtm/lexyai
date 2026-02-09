/**
 * Actuaciones de Hoy Service — Dual-Criteria
 * 
 * Fetches work_item_acts matching EITHER:
 *   1. created_at within the COT time window (newly discovered by ATENIA)
 *   2. act_date within the date window (court event happened in the window)
 * 
 * Merges, deduplicates, and tags each result with its match reason.
 */

import { supabase } from '@/integrations/supabase/client';
import { detectActuacionSeverity, type TickerItemSeverity, type TickerItemSource } from './ticker-data-service';
import { getWindowBounds, type HoyWindow } from '@/lib/colombia-date-utils';

export type { HoyWindow } from '@/lib/colombia-date-utils';

export type MatchReason = 'discovered' | 'court_dated' | 'both';

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
  severity: TickerItemSeverity;
  created_at: string;
  match_reason: MatchReason;
  is_new: boolean;
}

export interface GroupedActuaciones {
  work_item: {
    id: string;
    radicado: string;
    workflow_type: string;
    authority_name: string | null;
    demandantes: string | null;
    demandados: string | null;
    client_name: string | null;
  };
  actuaciones: ActuacionHoyItem[];
  newest_created_at: string;
  has_new: boolean;
  count: number;
}

const SELECT_FIELDS = `
  id, work_item_id, description, event_summary, act_date, act_type, source, created_at,
  work_items!inner (
    id, radicado, workflow_type, organization_id,
    authority_name, demandantes, demandados,
    client:clients ( name )
  )
`;

function mapSource(source: string | null | undefined): TickerItemSource {
  if (!source) return 'MANUAL';
  const l = source.toLowerCase();
  if (l.includes('cpnu')) return 'CPNU';
  if (l.includes('samai')) return 'SAMAI';
  if (l.includes('icarus')) return 'ICARUS';
  return 'CPNU';
}

function mapRow(row: any, reason: MatchReason): ActuacionHoyItem {
  const wi = row.work_items;
  const desc = row.description || 'Actuación registrada';
  return {
    id: row.id,
    work_item_id: row.work_item_id,
    radicado: wi?.radicado || '',
    authority_name: wi?.authority_name || null,
    workflow_type: wi?.workflow_type || '',
    demandantes: wi?.demandantes || null,
    demandados: wi?.demandados || null,
    client_name: wi?.client?.name || null,
    description: desc,
    annotation: row.event_summary || null,
    act_date: row.act_date,
    act_type: row.act_type || null,
    source: mapSource(row.source),
    severity: detectActuacionSeverity(desc),
    created_at: row.created_at,
    match_reason: reason,
    is_new: reason === 'discovered' || reason === 'both',
  };
}

export async function getActuacionesHoy(
  organizationId: string,
  window: HoyWindow = 'today',
  search?: string
): Promise<{ items: ActuacionHoyItem[]; total: number; discoveredCount: number; courtDatedCount: number }> {
  const bounds = getWindowBounds(window);

  // Two parallel queries: discovered (by created_at) and court-dated (by act_date)
  const [discoveredResult, courtDatedResult] = await Promise.all([
    supabase
      .from('work_item_acts')
      .select(SELECT_FIELDS)
      .eq('work_items.organization_id', organizationId)
      .eq('is_archived', false)
      .gte('created_at', bounds.created_start)
      .lte('created_at', bounds.created_end)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('work_item_acts')
      .select(SELECT_FIELDS)
      .eq('work_items.organization_id', organizationId)
      .eq('is_archived', false)
      .gte('act_date', bounds.date_start)
      .lte('act_date', bounds.date_end)
      .order('act_date', { ascending: false })
      .limit(200),
  ]);

  if (discoveredResult.error) console.error('[actuaciones-hoy] discovered query error:', discoveredResult.error);
  if (courtDatedResult.error) console.error('[actuaciones-hoy] court-dated query error:', courtDatedResult.error);

  // Merge and deduplicate
  const itemMap = new Map<string, ActuacionHoyItem>();

  for (const row of discoveredResult.data || []) {
    itemMap.set(row.id, mapRow(row, 'discovered'));
  }
  let discoveredCount = itemMap.size;

  let courtOnlyCount = 0;
  for (const row of courtDatedResult.data || []) {
    if (itemMap.has(row.id)) {
      // Already present from discovered — upgrade to 'both'
      const existing = itemMap.get(row.id)!;
      existing.match_reason = 'both';
      existing.is_new = true;
    } else {
      itemMap.set(row.id, mapRow(row, 'court_dated'));
      courtOnlyCount++;
    }
  }

  let items = Array.from(itemMap.values());

  // Client-side search filter
  if (search) {
    const lower = search.toLowerCase();
    items = items.filter(i =>
      i.radicado?.toLowerCase().includes(lower) ||
      i.authority_name?.toLowerCase().includes(lower) ||
      i.demandantes?.toLowerCase().includes(lower) ||
      i.demandados?.toLowerCase().includes(lower) ||
      i.description?.toLowerCase().includes(lower) ||
      i.annotation?.toLowerCase().includes(lower) ||
      i.client_name?.toLowerCase().includes(lower)
    );
  }

  // Sort: newest created_at first
  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return {
    items,
    total: items.length,
    discoveredCount,
    courtDatedCount: courtOnlyCount,
  };
}

/** Group actuaciones by work item for grouped card display */
export function groupByWorkItem(items: ActuacionHoyItem[]): GroupedActuaciones[] {
  const groups = new Map<string, GroupedActuaciones>();

  for (const item of items) {
    const wiId = item.work_item_id;
    if (!groups.has(wiId)) {
      groups.set(wiId, {
        work_item: {
          id: wiId,
          radicado: item.radicado,
          workflow_type: item.workflow_type,
          authority_name: item.authority_name,
          demandantes: item.demandantes,
          demandados: item.demandados,
          client_name: item.client_name,
        },
        actuaciones: [],
        newest_created_at: item.created_at,
        has_new: false,
        count: 0,
      });
    }
    const group = groups.get(wiId)!;
    group.actuaciones.push(item);
    group.count++;
    if (item.is_new) group.has_new = true;
    if (new Date(item.created_at) > new Date(group.newest_created_at)) {
      group.newest_created_at = item.created_at;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.has_new && !b.has_new) return -1;
    if (!a.has_new && b.has_new) return 1;
    return new Date(b.newest_created_at).getTime() - new Date(a.newest_created_at).getTime();
  });
}
