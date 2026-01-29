/**
 * Estados de Hoy Service
 * 
 * Extended ticker-data-service for the global "Estados de hoy" page.
 * Reuses existing ticker patterns, adds pagination + filters.
 * 
 * IMPORTANT: This uses existing data sources and does NOT create new tables.
 * 
 * LATEST ESTADO FILTER:
 * - This page shows ONLY the most recent estado per work_item
 * - Full history remains in WorkItemDetail → Estados tab
 */

import { supabase } from '@/integrations/supabase/client';
import { getNextBusinessDay, addBusinessDays } from '@/lib/colombian-holidays';
import type { TickerItem, TickerItemSource, TickerItemSeverity } from './ticker-data-service';
import { detectEstadoType, detectActuacionSeverity } from './ticker-data-service';
import { filterToLatestEstadoHoyItems } from './latest-estado-selector';
import type { Database } from '@/integrations/supabase/types';

type WorkflowType = Database['public']['Enums']['workflow_type'];

export interface EstadoHoyItem extends TickerItem {
  // Additional fields for the table view
  demandantes?: string;
  demandados?: string;
  actuacion_type?: string;
  inicia_termino?: string | null;
  inicia_termino_source?: 'fecha_desfijacion' | 'fecha_inicial_raw' | 'fecha_publicacion' | 'none';
  // Ejecutoria highlight
  is_in_ejecutoria_window: boolean;
  ejecutoria_ends_at?: string | null;
}

export interface EstadosHoyFilters {
  search?: string;
  showTutelas?: boolean;
  showOnlyCritical?: boolean;
  workflowTypes?: string[];
}

export interface EstadosHoyPaginatedResult {
  items: EstadoHoyItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============= EJECUTORIA CALCULATION =============

/**
 * Calculate if a date is within the 3 business day ejecutoria window
 * The window starts from terminos_inician (next business day after fecha_desfijacion)
 * and lasts 3 business days inclusive.
 */
export function isInEjecutoriaWindow(terminosInician: string | null): {
  isInWindow: boolean;
  windowEndsAt: string | null;
} {
  if (!terminosInician) {
    return { isInWindow: false, windowEndsAt: null };
  }
  
  try {
    // Parse the term start date
    const termStart = new Date(terminosInician + 'T00:00:00');
    if (isNaN(termStart.getTime())) {
      return { isInWindow: false, windowEndsAt: null };
    }
    
    // Calculate when the ejecutoria window ends (3 business days from term start)
    // Using addBusinessDays which already handles Colombian holidays
    const windowEnd = addBusinessDays(termStart, 3);
    
    // Check if today is within the window
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const isInWindow = today >= termStart && today <= windowEnd;
    
    return {
      isInWindow,
      windowEndsAt: windowEnd.toISOString().split('T')[0],
    };
  } catch (e) {
    console.error('[estados-hoy] Error calculating ejecutoria window:', e);
    return { isInWindow: false, windowEndsAt: null };
  }
}

/**
 * Calculate the term start date (inicia término) from available fields
 * Priority:
 * 1. fecha_desfijacion → nextBusinessDay (for publicaciones)
 * 2. raw_data.fechaInicial (for ICARUS/acts)
 * 3. fecha_publicacion → nextBusinessDay (fallback)
 */
export function calculateTermStart(
  fechaDesfijacion: string | null | undefined,
  fechaInicialRaw: string | null | undefined,
  fechaPublicacion: string | null | undefined
): { date: string | null; source: EstadoHoyItem['inicia_termino_source'] } {
  // Priority 1: fecha_desfijacion from publicaciones
  if (fechaDesfijacion) {
    const nextBD = getNextBusinessDay(new Date(fechaDesfijacion));
    return {
      date: nextBD.toISOString().split('T')[0],
      source: 'fecha_desfijacion',
    };
  }
  
  // Priority 2: fechaInicial from ICARUS/raw_data
  if (fechaInicialRaw) {
    return {
      date: fechaInicialRaw.split('T')[0],
      source: 'fecha_inicial_raw',
    };
  }
  
  // Priority 3: fecha_publicacion fallback
  if (fechaPublicacion) {
    const nextBD = getNextBusinessDay(new Date(fechaPublicacion));
    return {
      date: nextBD.toISOString().split('T')[0],
      source: 'fecha_publicacion',
    };
  }
  
  return { date: null, source: 'none' };
}

// ============= MAIN QUERY FUNCTION =============

/**
 * Fetch estados for the global "Estados de hoy" page
 * Supports pagination and filters
 */
export async function getEstadosHoy(
  organizationId: string,
  options: {
    page?: number;
    pageSize?: number;
    filters?: EstadosHoyFilters;
  } = {}
): Promise<EstadosHoyPaginatedResult> {
  const { page = 1, pageSize = 20, filters = {} } = options;
  const offset = (page - 1) * pageSize;
  
  // Build workflow type filter
  const defaultWorkflows: WorkflowType[] = ['CGP', 'CPACA', 'TUTELA', 'LABORAL', 'PENAL_906'];
  let workflowFilter: WorkflowType[] = defaultWorkflows;
  if (filters.showTutelas === false) {
    workflowFilter = workflowFilter.filter(w => w !== 'TUTELA');
  }
  if (filters.workflowTypes?.length) {
    workflowFilter = filters.workflowTypes as WorkflowType[];
  }
  
  // Fetch from BOTH sources in parallel
  const [publicacionesResult, actuacionesResult] = await Promise.all([
    // Estados from Publicaciones API
    supabase
      .from('work_item_publicaciones')
      .select(`
        id,
        work_item_id,
        title,
        annotation,
        published_at,
        fecha_fijacion,
        fecha_desfijacion,
        despacho,
        tipo_publicacion,
        source,
        pdf_url,
        raw_data,
        created_at,
        work_items!inner (
          id,
          radicado,
          workflow_type,
          organization_id,
          authority_name,
          demandantes,
          demandados,
          client:clients (
            name
          )
        )
      `, { count: 'exact' })
      .eq('work_items.organization_id', organizationId)
      .in('work_items.workflow_type', workflowFilter)
      .order('created_at', { ascending: false }),

    // Actuaciones from CPNU/SAMAI (via work_item_acts)
    supabase
      .from('work_item_acts')
      .select(`
        id,
        work_item_id,
        description,
        act_date,
        act_type,
        source,
        despacho,
        raw_data,
        created_at,
        work_items!inner (
          id,
          radicado,
          workflow_type,
          organization_id,
          authority_name,
          demandantes,
          demandados,
          client:clients (
            name
          )
        )
      `, { count: 'exact' })
      .eq('work_items.organization_id', organizationId)
      .in('work_items.workflow_type', workflowFilter)
      .order('created_at', { ascending: false })
  ]);
  
  const items: EstadoHoyItem[] = [];
  
  // Map publicaciones
  if (publicacionesResult.data) {
    for (const pub of publicacionesResult.data) {
      const workItem = pub.work_items as any;
      if (!workItem) continue;
      
      const content = pub.annotation || pub.title || 'Estado publicado';
      const estadoType = detectEstadoType(content);
      
      // Calculate term start
      const rawData = pub.raw_data as Record<string, any> | null;
      const termCalc = calculateTermStart(
        pub.fecha_desfijacion,
        rawData?.fechaInicial,
        pub.published_at
      );
      
      // Check ejecutoria window
      const ejecutoria = isInEjecutoriaWindow(termCalc.date);
      
      // Determine severity (use critical filter)
      let severity: TickerItemSeverity = pub.fecha_desfijacion ? 'HIGH' : 'MEDIUM';
      if (estadoType.type === 'SENTENCIA') severity = 'CRITICAL';
      else if (estadoType.type === 'AUTO_ADMISORIO') severity = 'HIGH';
      
      items.push({
        id: pub.id,
        type: 'ESTADO',
        source: mapSource(pub.source),
        radicado: workItem.radicado || '',
        work_item_id: pub.work_item_id,
        workflow_type: workItem.workflow_type || '',
        client_name: workItem.client?.name || undefined,
        authority_name: workItem.authority_name || undefined,
        demandantes: workItem.demandantes || undefined,
        demandados: workItem.demandados || undefined,
        content,
        date: pub.published_at,
        fecha_desfijacion: pub.fecha_desfijacion,
        terminos_inician: termCalc.date,
        is_deadline_trigger: !!pub.fecha_desfijacion && estadoType.triggersDeadline,
        missing_fecha_desfijacion: !pub.fecha_desfijacion,
        severity,
        tipo_publicacion: pub.tipo_publicacion || undefined,
        despacho: pub.despacho || undefined,
        pdf_url: pub.pdf_url || undefined,
        created_at: pub.created_at,
        actuacion_type: estadoType.label,
        inicia_termino: termCalc.date,
        inicia_termino_source: termCalc.source,
        is_in_ejecutoria_window: ejecutoria.isInWindow,
        ejecutoria_ends_at: ejecutoria.windowEndsAt,
      });
    }
  }
  
  // Map actuaciones
  if (actuacionesResult.data) {
    for (const act of actuacionesResult.data) {
      const workItem = act.work_items as any;
      if (!workItem) continue;
      
      const content = act.description || 'Actuación registrada';
      const severity = detectActuacionSeverity(content);
      
      // Calculate term start from raw_data.fechaInicial if available
      const rawData = act.raw_data as Record<string, any> | null;
      const termCalc = calculateTermStart(
        null, // No fecha_desfijacion for acts
        rawData?.fechaInicial || rawData?.fecha_inicial,
        act.act_date
      );
      
      // Check ejecutoria window
      const ejecutoria = isInEjecutoriaWindow(termCalc.date);
      
      items.push({
        id: act.id,
        type: 'ACTUACION',
        source: mapSource(act.source),
        radicado: workItem.radicado || '',
        work_item_id: act.work_item_id,
        workflow_type: workItem.workflow_type || '',
        client_name: workItem.client?.name || undefined,
        authority_name: workItem.authority_name || undefined,
        demandantes: workItem.demandantes || undefined,
        demandados: workItem.demandados || undefined,
        despacho: act.despacho || undefined,
        content,
        date: act.act_date,
        fecha_desfijacion: null,
        terminos_inician: termCalc.date,
        is_deadline_trigger: false,
        missing_fecha_desfijacion: false,
        severity,
        created_at: act.created_at,
        actuacion_type: act.act_type || undefined,
        inicia_termino: termCalc.date,
        inicia_termino_source: termCalc.source,
        is_in_ejecutoria_window: ejecutoria.isInWindow,
        ejecutoria_ends_at: ejecutoria.windowEndsAt,
      });
    }
  }
  
  // Apply search filter
  let filtered = items;
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(item =>
      item.radicado?.toLowerCase().includes(searchLower) ||
      item.despacho?.toLowerCase().includes(searchLower) ||
      item.demandantes?.toLowerCase().includes(searchLower) ||
      item.demandados?.toLowerCase().includes(searchLower) ||
      item.content?.toLowerCase().includes(searchLower) ||
      item.actuacion_type?.toLowerCase().includes(searchLower) ||
      item.client_name?.toLowerCase().includes(searchLower)
    );
  }
  
  // Apply critical filter
  if (filters.showOnlyCritical) {
    filtered = filtered.filter(item => 
      item.severity === 'CRITICAL' || item.severity === 'HIGH'
    );
  }
  
  // Sort by created_at descending
  filtered.sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  
  // CRITICAL: Filter to only the LATEST estado per work_item
  // This ensures Estados de Hoy shows actionable items, not full history
  const latestOnly = filterToLatestEstadoHoyItems(filtered);
  
  // Paginate
  const total = latestOnly.length;
  const paged = latestOnly.slice(offset, offset + pageSize);
  
  return {
    items: paged,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ============= HELPERS =============

function mapSource(source: string | null | undefined): TickerItemSource {
  if (!source) return 'MANUAL';
  
  const lower = source.toLowerCase();
  
  if (lower.includes('publicaciones')) return 'PUBLICACIONES_API';
  if (lower.includes('icarus')) return 'ICARUS';
  if (lower.includes('cpnu')) return 'CPNU';
  if (lower.includes('samai')) return 'SAMAI';
  if (lower.includes('manual')) return 'MANUAL';
  
  return 'CPNU';
}

// Re-export severity detection for use in page
export { detectActuacionSeverity } from './ticker-data-service';
