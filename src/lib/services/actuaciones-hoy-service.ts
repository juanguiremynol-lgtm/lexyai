/**
 * Actuaciones Hoy Service
 * 
 * Service for fetching recent actuaciones from work_item_acts.
 * Uses act_date as the primary date field for "new" detection.
 * 
 * CRITICAL: This service ONLY queries work_item_acts.
 * Publicaciones (estados) are handled by a separate service.
 */

import { supabase } from '@/integrations/supabase/client';

// ============= TYPES =============

export interface ActuacionHoyItem {
  id: string;
  work_item_id: string;
  description: string;
  act_date: string | null;
  act_type?: string | null;
  despacho?: string | null;
  source: string;
  created_at: string;
  raw_data?: any;
  // Joined work_item fields
  radicado: string;
  workflow_type: string;
  authority_name?: string | null;
  demandantes?: string | null;
  demandados?: string | null;
  client_name?: string | null;
  // UI helpers
  is_important: boolean;
  importance_reason?: string;
}

export interface ActuacionesHoyResult {
  items: ActuacionHoyItem[];
  totalCount: number;
}

// ============= IMPORTANCE DETECTION =============

/**
 * Important actuación types that should be highlighted
 */
const IMPORTANT_PATTERNS = [
  { pattern: /fijacion\s+estado/i, reason: 'Fijación de estado' },
  { pattern: /auto\s+admite/i, reason: 'Demanda admitida' },
  { pattern: /auto\s+inadmite/i, reason: 'Demanda inadmitida' },
  { pattern: /auto\s+requiere/i, reason: 'Requerimiento del juzgado' },
  { pattern: /auto\s+decreta\s+medida/i, reason: 'Medida cautelar decretada' },
  { pattern: /sentencia/i, reason: 'Sentencia' },
  { pattern: /audiencia/i, reason: 'Audiencia programada' },
  { pattern: /notificacion\s+personal/i, reason: 'Notificación personal' },
  { pattern: /traslado/i, reason: 'Traslado' },
  { pattern: /fallo/i, reason: 'Fallo emitido' },
  { pattern: /recurso/i, reason: 'Recurso' },
  { pattern: /apelacion/i, reason: 'Apelación' },
];

function detectImportance(description: string): { isImportant: boolean; reason?: string } {
  if (!description) return { isImportant: false };
  
  for (const { pattern, reason } of IMPORTANT_PATTERNS) {
    if (pattern.test(description)) {
      return { isImportant: true, reason };
    }
  }
  
  return { isImportant: false };
}

// ============= MAIN QUERY FUNCTION =============

/**
 * Fetch actuaciones from the last 3 days
 * Uses act_date as the primary date field - NOT created_at
 */
export async function getActuacionesHoy(
  organizationId: string
): Promise<ActuacionesHoyResult> {
  // Get date boundaries (Colombia timezone - UTC-5)
  const now = new Date();
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  today.setHours(0, 0, 0, 0);
  
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
  const todayStr = today.toISOString().split('T')[0];
  const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];
  
  console.log(`[actuaciones-hoy] Fetching actuaciones from ${threeDaysAgoStr} to ${todayStr}`);
  
  // Fetch actuaciones with act_date in last 3 days
  // CRITICAL: We filter by act_date, NOT created_at
  // Also filter out archived records
  const { data, error } = await supabase
    .from('work_item_acts')
    .select(`
      id,
      work_item_id,
      description,
      act_date,
      act_type,
      despacho,
      source,
      created_at,
      raw_data,
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
    `)
    .eq('work_items.organization_id', organizationId)
    .eq('is_archived', false)
    .not('act_date', 'is', null)
    .gte('act_date', threeDaysAgoStr)
    .lte('act_date', todayStr)
    .order('act_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[actuaciones-hoy] Error fetching:', error);
    return { items: [], totalCount: 0 };
  }

  console.log(`[actuaciones-hoy] Found ${data?.length || 0} actuaciones in date range`);

  // Map to our item type
  const items: ActuacionHoyItem[] = (data || []).map((act: any) => {
    const workItem = act.work_items as any;
    const { isImportant, reason } = detectImportance(act.description || '');
    
    return {
      id: act.id,
      work_item_id: act.work_item_id,
      description: act.description || 'Actuación registrada',
      act_date: act.act_date,
      act_type: act.act_type,
      despacho: act.despacho,
      source: act.source || 'cpnu',
      created_at: act.created_at,
      raw_data: act.raw_data,
      // Joined fields
      radicado: workItem?.radicado || '',
      workflow_type: workItem?.workflow_type || '',
      authority_name: workItem?.authority_name,
      demandantes: workItem?.demandantes,
      demandados: workItem?.demandados,
      client_name: workItem?.client?.name,
      // Importance
      is_important: isImportant,
      importance_reason: reason,
    };
  });

  return {
    items,
    totalCount: items.length,
  };
}
