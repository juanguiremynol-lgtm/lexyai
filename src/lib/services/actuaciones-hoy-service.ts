/**
 * Actuaciones de Hoy Service — Dual-Mode
 * 
 * Supports two query modes:
 *   1. "detected" (default): detected_at OR changed_at within the COT time window
 *   2. "court_date": act_date within the date window (original behavior)
 * 
 * Merges, deduplicates, and tags each result with its match reason.
 */

import { supabase } from '@/integrations/supabase/client';
import { detectActuacionSeverity, type TickerItemSeverity, type TickerItemSource } from './ticker-data-service';
import { getWindowBounds, getColombiaDayBoundsUTC, type HoyWindow } from '@/lib/colombia-date-utils';

export type { HoyWindow } from '@/lib/colombia-date-utils';

export type MatchReason = 'discovered' | 'court_dated' | 'both' | 'modified';
export type HoyMode = 'detected' | 'court_date';

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
  detected_at: string;
  changed_at: string | null;
  match_reason: MatchReason;
  is_new: boolean;
  is_modified: boolean;
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
  has_modified: boolean;
  count: number;
}

const SELECT_FIELDS = `
  id, work_item_id, description, event_summary, act_date, act_type, source, created_at,
  detected_at, changed_at,
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
    detected_at: row.detected_at || row.created_at,
    changed_at: row.changed_at || null,
    match_reason: reason,
    is_new: reason === 'discovered' || reason === 'both',
    is_modified: reason === 'modified',
  };
}

export async function getActuacionesHoy(
  organizationId: string,
  window: HoyWindow = 'today',
  search?: string,
  mode: HoyMode = 'detected'
): Promise<{ items: ActuacionHoyItem[]; total: number; discoveredCount: number; courtDatedCount: number; modifiedCount: number }> {
  const bounds = getWindowBounds(window);

  let items: ActuacionHoyItem[] = [];
  let discoveredCount = 0;
  let courtDatedCount = 0;
  let modifiedCount = 0;

  if (mode === 'detected') {
    // MODE: "Fecha actuación" — items whose act_date falls within the COT window
    // This prevents backfilled historical items from appearing as "today"
    const { data, error } = await supabase
      .from('work_item_acts')
      .select(SELECT_FIELDS)
      .eq('work_items.organization_id', organizationId)
      .eq('is_archived', false)
      .gte('act_date', bounds.date_start)
      .lte('act_date', bounds.date_end)
      .not('act_date', 'is', null)
      .order('act_date', { ascending: false })
      .limit(500);

    if (error) console.error('[actuaciones-hoy] detected query error:', error);

    for (const row of data || []) {
      // Check if this item was also recently discovered (detected_at in window)
      const detectedMs = new Date(row.detected_at || row.created_at).getTime();
      const windowStartMs = new Date(bounds.created_start).getTime();
      const windowEndMs = new Date(bounds.created_end).getTime();
      const isDetectedInWindow = detectedMs >= windowStartMs && detectedMs <= windowEndMs;

      let reason: MatchReason;
      if (isDetectedInWindow) {
        reason = 'discovered';
        discoveredCount++;
      } else {
        reason = 'court_dated';
        courtDatedCount++;
      }

      items.push(mapRow(row, reason));
    }
  } else {
    // MODE: "Fecha del juzgado" — original court-date based
    const { data, error } = await supabase
      .from('work_item_acts')
      .select(SELECT_FIELDS)
      .eq('work_items.organization_id', organizationId)
      .eq('is_archived', false)
      .gte('act_date', bounds.date_start)
      .lte('act_date', bounds.date_end)
      .order('act_date', { ascending: false })
      .limit(500);

    if (error) console.error('[actuaciones-hoy] court_date query error:', error);

    for (const row of data || []) {
      const createdMs = new Date(row.created_at).getTime();
      const windowStartMs = new Date(bounds.created_start).getTime();
      const windowEndMs = new Date(bounds.created_end).getTime();
      const isDiscoveredInWindow = createdMs >= windowStartMs && createdMs <= windowEndMs;
      const reason: MatchReason = isDiscoveredInWindow ? 'both' : 'court_dated';
      if (isDiscoveredInWindow) discoveredCount++;
      courtDatedCount++;
      items.push(mapRow(row, reason));
    }
  }

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

  // Sort: modified first, then by detection time desc
  items.sort((a, b) => {
    const timeA = Math.max(
      new Date(a.detected_at).getTime(),
      a.changed_at ? new Date(a.changed_at).getTime() : 0
    );
    const timeB = Math.max(
      new Date(b.detected_at).getTime(),
      b.changed_at ? new Date(b.changed_at).getTime() : 0
    );
    return timeB - timeA;
  });

  return { items, total: items.length, discoveredCount, courtDatedCount, modifiedCount };
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
        has_modified: false,
        count: 0,
      });
    }
    const group = groups.get(wiId)!;
    group.actuaciones.push(item);
    group.count++;
    if (item.is_new) group.has_new = true;
    if (item.is_modified) group.has_modified = true;
    if (new Date(item.created_at) > new Date(group.newest_created_at)) {
      group.newest_created_at = item.created_at;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.has_new && !b.has_new) return -1;
    if (!a.has_new && b.has_new) return 1;
    if (a.has_modified && !b.has_modified) return -1;
    if (!a.has_modified && b.has_modified) return 1;
    return new Date(b.newest_created_at).getTime() - new Date(a.newest_created_at).getTime();
  });
}
