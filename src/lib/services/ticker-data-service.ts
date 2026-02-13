/**
 * Unified Ticker Data Service
 * 
 * Fetches and normalizes data from multiple sources for the Estados ticker:
 * - work_item_publicaciones (from Publicaciones API)
 * - work_item_acts (from CPNU/SAMAI)
 * 
 * Critical Colombian Law Note:
 * - Legal terms (términos) begin the NEXT BUSINESS DAY after fecha_desfijacion
 * - Most estados do NOT have fecha_desfijacion - warn users
 * - Use the TYPE of actuación/estado to determine which deadline applies
 * 
 * LATEST ESTADO FILTER:
 * - The ticker shows ONLY the most recent estado per work_item
 * - Full history remains in WorkItemDetail → Estados tab
 */

import { supabase } from '@/integrations/supabase/client';
import { getWindowBounds } from '@/lib/colombia-date-utils';
import { filterToLatestTickerItems } from './latest-estado-selector';

// ============= TYPES =============

export type TickerItemSource = 'PUBLICACIONES_API' | 'CPNU' | 'SAMAI' | 'ICARUS' | 'MANUAL';
export type TickerItemType = 'ESTADO' | 'ACTUACION';
export type TickerItemSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TickerItem {
  id: string;
  type: TickerItemType;
  source: TickerItemSource;
  radicado: string;
  work_item_id: string;
  workflow_type: string;
  client_name?: string;
  authority_name?: string;
  content: string;
  date: string | null;
  fecha_desfijacion?: string | null;  // Critical for deadline calculation
  terminos_inician?: string | null;   // Calculated next business day
  is_deadline_trigger: boolean;
  missing_fecha_desfijacion: boolean; // Warning flag
  severity: TickerItemSeverity;
  tipo_publicacion?: string;
  despacho?: string;
  pdf_url?: string;
  created_at: string;
}

// ============= HELPERS =============

/**
 * Calculate the next business day after a given date
 * In Colombian legal terms, términos begin the day AFTER fecha_desfijacion
 * Skip weekends (Saturday = 6, Sunday = 0)
 */
function calculateNextBusinessDay(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  
  // Handle ISO date or date-only format
  const dateOnly = dateStr.split('T')[0];
  const d = new Date(dateOnly + 'T12:00:00Z');
  
  if (isNaN(d.getTime())) return null;
  
  d.setDate(d.getDate() + 1);
  
  // Skip weekends (0 = Sunday, 6 = Saturday)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  
  return d.toISOString().split('T')[0];
}

/**
 * Detect severity based on actuación/estado content
 */
export function detectActuacionSeverity(text: string): TickerItemSeverity {
  const lowerText = text.toLowerCase();
  
  // CRITICAL: Sentencias, fallos, vencimientos
  if (lowerText.includes('sentencia') || lowerText.includes('fallo')) {
    return 'CRITICAL';
  }
  
  // HIGH: Auto admisorio, audiencias, notificaciones
  if (
    lowerText.includes('auto admisorio') || 
    lowerText.includes('admite demanda') ||
    lowerText.includes('audiencia') ||
    lowerText.includes('notificación personal') ||
    lowerText.includes('notificacion personal') ||
    lowerText.includes('traslado') ||
    lowerText.includes('recurso')
  ) {
    return 'HIGH';
  }
  
  // MEDIUM: General procedural events
  if (
    lowerText.includes('término') ||
    lowerText.includes('termino') ||
    lowerText.includes('requiere') ||
    lowerText.includes('estado')
  ) {
    return 'MEDIUM';
  }
  
  return 'LOW';
}

/**
 * Map source string to normalized source type
 */
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

/**
 * Detect estado type from content for deadline determination
 */
export function detectEstadoType(content: string): {
  type: string;
  label: string;
  triggersDeadline: boolean;
  deadlineType?: string;
} {
  const lowerContent = content.toLowerCase();

  // AUTO ADMISORIO - Triggers response deadline
  if (/auto admisorio|admite (la )?demanda|auto que admite/i.test(content)) {
    return {
      type: 'AUTO_ADMISORIO',
      label: 'Auto Admisorio',
      triggersDeadline: true,
      deadlineType: 'CONTESTACION_DEMANDA',
    };
  }

  // TRASLADO - Triggers response deadline
  if (/traslado|corre traslado/i.test(content)) {
    return {
      type: 'TRASLADO',
      label: 'Traslado',
      triggersDeadline: true,
      deadlineType: 'RESPUESTA_TRASLADO',
    };
  }

  // SENTENCIA - Critical, may trigger appeal deadline
  if (/sentencia|fallo/i.test(content)) {
    return {
      type: 'SENTENCIA',
      label: 'Sentencia',
      triggersDeadline: true,
      deadlineType: 'RECURSO_APELACION',
    };
  }

  // AUDIENCIA - Triggers preparation deadline
  if (/audiencia|señala.*fecha|fija.*fecha/i.test(content)) {
    return {
      type: 'AUDIENCIA',
      label: 'Audiencia Programada',
      triggersDeadline: true,
      deadlineType: 'PREPARACION_AUDIENCIA',
    };
  }

  // NOTIFICACION - May trigger response deadline
  if (/notificaci[oó]n|notifica/i.test(content)) {
    return {
      type: 'NOTIFICACION',
      label: 'Notificación',
      triggersDeadline: true,
      deadlineType: 'RESPUESTA_NOTIFICACION',
    };
  }

  // REQUERIMIENTO - Triggers response deadline
  if (/requiere|requerimiento|subsane/i.test(content)) {
    return {
      type: 'REQUERIMIENTO',
      label: 'Requerimiento',
      triggersDeadline: true,
      deadlineType: 'RESPUESTA_REQUERIMIENTO',
    };
  }

  // AUTO INTERLOCUTORIO - May trigger appeal deadline
  if (/auto interlocutorio|auto que/i.test(content)) {
    return {
      type: 'AUTO_INTERLOCUTORIO',
      label: 'Auto Interlocutorio',
      triggersDeadline: true,
      deadlineType: 'RECURSO_REPOSICION',
    };
  }

  // Default - No specific deadline
  return {
    type: 'ESTADO_GENERAL',
    label: 'Estado',
    triggersDeadline: false,
  };
}

// ============= MAIN QUERY FUNCTION =============

/**
 * Fetch ticker items from both work_item_publicaciones and work_item_acts
 * Returns unified, sorted list for display in ticker
 */
export async function getTickerItems(
  organizationId: string,
  limit: number = 50
): Promise<TickerItem[]> {
  // Use the same 1-week window as Estados de Hoy for consistency
  const bounds = getWindowBounds('week');

  // Fetch from both sources in parallel, using dual-criteria (discovered + court-posted)
  const [pubDiscovered, pubCourtPosted, actuacionesResult] = await Promise.all([
    // Estados discovered this week (by created_at)
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
        created_at,
        work_items!inner (
          id,
          radicado,
          workflow_type,
          organization_id,
          authority_name,
          client:clients (
            name
          )
        )
      `)
      .eq('work_items.organization_id', organizationId)
      .eq('is_archived', false)
      .gte('created_at', bounds.created_start)
      .lte('created_at', bounds.created_end)
      .order('created_at', { ascending: false })
      .limit(limit),

    // Estados court-posted this week (by fecha_fijacion)
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
        created_at,
        work_items!inner (
          id,
          radicado,
          workflow_type,
          organization_id,
          authority_name,
          client:clients (
            name
          )
        )
      `)
      .eq('work_items.organization_id', organizationId)
      .eq('is_archived', false)
      .gte('fecha_fijacion', bounds.date_start)
      .lte('fecha_fijacion', bounds.date_end)
      .order('fecha_fijacion', { ascending: false })
      .limit(limit),

    // Actuaciones from CPNU/SAMAI (via work_item_acts) — discovered this week
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
        created_at,
        work_items!inner (
          id,
          radicado,
          workflow_type,
          organization_id,
          authority_name,
          client:clients (
            name
          )
        )
      `)
      .eq('work_items.organization_id', organizationId)
      .eq('is_archived', false)
      .gte('created_at', bounds.created_start)
      .lte('created_at', bounds.created_end)
      .order('created_at', { ascending: false })
      .limit(limit)
  ]);

  // Merge publicaciones from both criteria, deduplicating by id
  const pubMap = new Map<string, any>();
  for (const row of pubDiscovered.data || []) pubMap.set(row.id, row);
  for (const row of pubCourtPosted.data || []) pubMap.set(row.id, row);
  const publicacionesData = Array.from(pubMap.values());

  const tickerItems: TickerItem[] = [];

  // Map publicaciones to ticker items
  if (publicacionesData.length > 0) {
    for (const pub of publicacionesData) {
      const workItem = pub.work_items as any;
      if (!workItem) continue;

      const hasFechaDesfijacion = !!pub.fecha_desfijacion;
      const terminosInician = hasFechaDesfijacion 
        ? calculateNextBusinessDay(pub.fecha_desfijacion)
        : null;

      const content = pub.annotation || pub.title || 'Estado publicado';
      const estadoType = detectEstadoType(content);

      tickerItems.push({
        id: pub.id,
        type: 'ESTADO',
        source: mapSource(pub.source),
        radicado: workItem.radicado || '',
        work_item_id: pub.work_item_id,
        workflow_type: workItem.workflow_type || '',
        client_name: workItem.client?.name || undefined,
        authority_name: workItem.authority_name || undefined,
        content,
        date: pub.published_at,
        fecha_desfijacion: pub.fecha_desfijacion,
        terminos_inician: terminosInician,
        is_deadline_trigger: hasFechaDesfijacion && estadoType.triggersDeadline,
        missing_fecha_desfijacion: !hasFechaDesfijacion,
        severity: hasFechaDesfijacion ? 'HIGH' : 'MEDIUM',
        tipo_publicacion: pub.tipo_publicacion || undefined,
        despacho: pub.despacho || undefined,
        pdf_url: pub.pdf_url || undefined,
        created_at: pub.created_at,
      });
    }
  }

  // Map actuaciones to ticker items
  // IMPORTANT: SAMAI_ESTADOS records are treated as ESTADO, not ACTUACION
  if (actuacionesResult.data) {
    for (const act of actuacionesResult.data) {
      const workItem = act.work_items as any;
      if (!workItem) continue;

      const isSamaiEstado = act.source === 'SAMAI_ESTADOS';
      const content = act.description || (isSamaiEstado ? 'Estado electrónico' : 'Actuación registrada');
      const severity = detectActuacionSeverity(content);

      tickerItems.push({
        id: act.id,
        type: isSamaiEstado ? 'ESTADO' : 'ACTUACION',
        source: mapSource(act.source),
        radicado: workItem.radicado || '',
        work_item_id: act.work_item_id,
        workflow_type: workItem.workflow_type || '',
        client_name: workItem.client?.name || undefined,
        authority_name: workItem.authority_name || undefined,
        despacho: act.despacho || undefined,
        content,
        date: act.act_date,
        fecha_desfijacion: null,
        terminos_inician: null,
        is_deadline_trigger: false,
        missing_fecha_desfijacion: isSamaiEstado, // Flag for estados without desfijacion
        severity,
        created_at: act.created_at,
      });
    }
  }

  // Sort by created_at descending
  const sorted = tickerItems
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  
  // CRITICAL: Filter to only the LATEST estado per work_item
  // This ensures the ticker shows actionable items, not full history
  const latestOnly = filterToLatestTickerItems(sorted);
  
  return latestOnly.slice(0, limit);
}

/**
 * Format ticker item for display (short version)
 */
export function formatTickerItemShort(item: TickerItem): string {
  const parts: string[] = [];
  
  // Type badge
  parts.push(`[${item.type === 'ESTADO' ? 'EST' : 'ACT'}]`);
  
  // Radicado (shortened)
  if (item.radicado) {
    const rad = item.radicado.length > 15 
      ? item.radicado.slice(-15) 
      : item.radicado;
    parts.push(rad);
  }
  
  // Content (shortened)
  const contentShort = item.content.length > 40 
    ? item.content.slice(0, 37) + '...' 
    : item.content;
  parts.push(contentShort);
  
  return parts.join(' • ');
}
