/**
 * Publicaciones Hoy Service
 * 
 * Service for fetching recent publicaciones (estados) from work_item_publicaciones.
 * Uses fecha_fijacion as the primary date field for "new" detection.
 * 
 * CRITICAL: This service ONLY queries work_item_publicaciones.
 * Actuaciones are handled by a separate service.
 */

import { supabase } from '@/integrations/supabase/client';
import { getNextBusinessDay, addBusinessDays } from '@/lib/colombian-holidays';

// ============= TYPES =============

export interface PublicacionHoyItem {
  id: string;
  work_item_id: string;
  title: string;
  annotation?: string | null;
  pdf_url?: string | null;
  entry_url?: string | null;
  pdf_available: boolean;
  fecha_fijacion: string | null;
  fecha_desfijacion: string | null;
  despacho?: string | null;
  tipo_publicacion?: string | null;
  source: string;
  created_at: string;
  // Joined work_item fields
  radicado: string;
  workflow_type: string;
  authority_name?: string | null;
  demandantes?: string | null;
  demandados?: string | null;
  client_name?: string | null;
  // Computed ejecutoria fields
  terminos_inician: string | null;
  is_in_ejecutoria_window: boolean;
  ejecutoria_ends_at: string | null;
  // UI helpers
  has_known_date: boolean;
}

export interface PublicacionesHoyResult {
  withDate: PublicacionHoyItem[];      // fecha_fijacion in last 3 days
  withoutDate: PublicacionHoyItem[];   // fecha_fijacion is null, synced today
  totalCount: number;
}

// ============= EJECUTORIA CALCULATION =============

/**
 * Calculate if a date is within the 3 business day ejecutoria window
 * The window starts from terminos_inician (next business day after fecha_desfijacion)
 * and lasts 3 business days inclusive.
 */
function isInEjecutoriaWindow(terminosInician: string | null): {
  isInWindow: boolean;
  windowEndsAt: string | null;
} {
  if (!terminosInician) {
    return { isInWindow: false, windowEndsAt: null };
  }
  
  try {
    const termStart = new Date(terminosInician + 'T00:00:00');
    if (isNaN(termStart.getTime())) {
      return { isInWindow: false, windowEndsAt: null };
    }
    
    // Calculate when the ejecutoria window ends (3 business days from term start)
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
    console.error('[publicaciones-hoy] Error calculating ejecutoria window:', e);
    return { isInWindow: false, windowEndsAt: null };
  }
}

/**
 * Calculate when terms start (inicia término) from fecha_desfijacion
 */
function calculateTermStart(fechaDesfijacion: string | null): string | null {
  if (!fechaDesfijacion) return null;
  
  try {
    const nextBD = getNextBusinessDay(new Date(fechaDesfijacion));
    return nextBD.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

// ============= MAIN QUERY FUNCTION =============

/**
 * Fetch publicaciones (estados) from the last 3 days
 * Uses fecha_fijacion as the primary date field
 */
export async function getPublicacionesHoy(
  organizationId: string
): Promise<PublicacionesHoyResult> {
  // Get date boundaries (Colombia timezone - UTC-5)
  const now = new Date();
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  today.setHours(0, 0, 0, 0);
  
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
  const todayStr = today.toISOString().split('T')[0];
  const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];
  
  // Fetch publicaciones with fecha_fijacion in last 3 days
  // Filter out archived records
  const { data: withDateData, error: withDateError } = await supabase
    .from('work_item_publicaciones')
    .select(`
      id,
      work_item_id,
      title,
      annotation,
      pdf_url,
      entry_url,
      pdf_available,
      fecha_fijacion,
      fecha_desfijacion,
      despacho,
      tipo_publicacion,
      source,
      created_at,
      work_items!inner (
        id,
        radicado,
        workflow_type,
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
    .gte('fecha_fijacion', threeDaysAgoStr)
    .lte('fecha_fijacion', todayStr)
    .order('fecha_fijacion', { ascending: false })
    .order('created_at', { ascending: false });

  if (withDateError) {
    console.error('[publicaciones-hoy] Error fetching with date:', withDateError);
  }

  // Fetch publicaciones with NULL fecha_fijacion, synced in last 24 hours
  // Filter out archived records
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data: withoutDateData, error: withoutDateError } = await supabase
    .from('work_item_publicaciones')
    .select(`
      id,
      work_item_id,
      title,
      annotation,
      pdf_url,
      entry_url,
      pdf_available,
      fecha_fijacion,
      fecha_desfijacion,
      despacho,
      tipo_publicacion,
      source,
      created_at,
      work_items!inner (
        id,
        radicado,
        workflow_type,
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
    .is('fecha_fijacion', null)
    .gte('created_at', twentyFourHoursAgo)
    .order('created_at', { ascending: false });

  if (withoutDateError) {
    console.error('[publicaciones-hoy] Error fetching without date:', withoutDateError);
  }

  // Map to our item type
  const mapItem = (pub: any): PublicacionHoyItem => {
    const workItem = pub.work_items as any;
    const terminosInician = calculateTermStart(pub.fecha_desfijacion);
    const ejecutoria = isInEjecutoriaWindow(terminosInician);
    
    return {
      id: pub.id,
      work_item_id: pub.work_item_id,
      title: pub.title || 'Sin título',
      annotation: pub.annotation,
      pdf_url: pub.pdf_url,
      entry_url: pub.entry_url,
      pdf_available: pub.pdf_available ?? !!pub.pdf_url,
      fecha_fijacion: pub.fecha_fijacion,
      fecha_desfijacion: pub.fecha_desfijacion,
      despacho: pub.despacho,
      tipo_publicacion: pub.tipo_publicacion,
      source: pub.source || 'publicaciones',
      created_at: pub.created_at,
      // Joined fields
      radicado: workItem?.radicado || '',
      workflow_type: workItem?.workflow_type || '',
      authority_name: workItem?.authority_name,
      demandantes: workItem?.demandantes,
      demandados: workItem?.demandados,
      client_name: workItem?.client?.name,
      // Computed
      terminos_inician: terminosInician,
      is_in_ejecutoria_window: ejecutoria.isInWindow,
      ejecutoria_ends_at: ejecutoria.windowEndsAt,
      has_known_date: !!pub.fecha_fijacion,
    };
  };

  const withDate = (withDateData || []).map(mapItem);
  const withoutDate = (withoutDateData || []).map(mapItem);

  return {
    withDate,
    withoutDate,
    totalCount: withDate.length + withoutDate.length,
  };
}
