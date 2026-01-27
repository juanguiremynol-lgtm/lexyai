/**
 * Web Scrape Ingestion Service
 * 
 * Unified ingestion for web-scraped actuaciones into work_item_acts.
 * Used by CPACA and PENAL_906 workflows (NOT Estados-based).
 * 
 * This service handles:
 * 1. Deduplication via hash_fingerprint
 * 2. Writing to work_item_acts table
 * 3. Stage/phase inference and work_items updates
 * 4. Alert instance creation for significant events
 */

import { supabase } from '@/integrations/supabase/client';
import { createAlertIdempotent, type AlertEntityType } from '@/lib/alerts';

// Types for raw scraped events
export interface RawScrapedEvent {
  radicado: string;
  event_date: string | null;          // ISO date or null
  event_date_raw?: string;            // Original date string
  despacho?: string;
  descripcion: string;                // Raw description text
  anotacion?: string;                 // Additional annotation
  source_url?: string;
  source_platform: string;            // 'RAMA_JUDICIAL', 'CPNU', 'EXTERNAL_API'
  scrape_date: string;                // ISO date of scrape
  attachments?: Array<{ label: string; url: string }>;
  metadata?: Record<string, unknown>; // Preserve any extra data
}

// Ingestion result
export interface WebScrapeIngestionResult {
  ok: boolean;
  work_item_id: string;
  events_processed: number;
  events_created: number;
  events_skipped_duplicate: number;
  stage_changed: boolean;
  old_stage: string | number | null;
  new_stage: string | number | null;
  alerts_created: number;
  error?: string;
}

/**
 * Compute a stable fingerprint for deduplication
 */
export function computeEventFingerprint(
  workItemId: string,
  eventDate: string | null,
  description: string
): string {
  // Use first 100 chars of description for stability
  const descNorm = description.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
  const data = `${workItemId}|${eventDate || ''}|${descNorm}`;
  
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Normalize text for classification
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a summary (first 200 chars) from raw text
 */
export function extractSummary(text: string, maxLength = 200): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLength * 0.7 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}

/**
 * Detect important event types for alert creation
 */
export type ImportantEventType = 
  | 'SENTENCIA'
  | 'AUTO_ADMISORIO'
  | 'AUDIENCIA'
  | 'NOTIFICACION'
  | 'RECURSO'
  | 'ARCHIVO'
  | 'NORMAL';

export function detectImportantEventType(textNorm: string): ImportantEventType {
  if (/sentencia|fallo\s+(de\s+fondo|condenat|absolut)/i.test(textNorm)) return 'SENTENCIA';
  if (/auto\s+admisorio|admite\s+(la\s+)?demanda/i.test(textNorm)) return 'AUTO_ADMISORIO';
  if (/audiencia/i.test(textNorm)) return 'AUDIENCIA';
  if (/notificacion|se\s+notifica/i.test(textNorm)) return 'NOTIFICACION';
  if (/recurso|apelacion|casacion/i.test(textNorm)) return 'RECURSO';
  if (/archivo|terminacion|perencion/i.test(textNorm)) return 'ARCHIVO';
  return 'NORMAL';
}

/**
 * Map event type to alert severity
 */
export function getSeverityForEventType(eventType: ImportantEventType): 'INFO' | 'WARNING' | 'CRITICAL' {
  switch (eventType) {
    case 'SENTENCIA':
    case 'ARCHIVO':
      return 'CRITICAL';
    case 'AUDIENCIA':
    case 'RECURSO':
      return 'WARNING';
    default:
      return 'INFO';
  }
}

/**
 * Create an alert instance for a detected event
 */
export async function createEventAlert(
  ownerId: string,
  organizationId: string | null,
  workItemId: string,
  radicado: string,
  eventType: ImportantEventType,
  eventSummary: string,
  eventDate: string | null,
  workflowType: string
): Promise<boolean> {
  if (eventType === 'NORMAL') return false;
  
  const severity = getSeverityForEventType(eventType);
  
  // Map workflow type to entity type
  let entityType: AlertEntityType = 'CGP_CASE';
  if (workflowType === 'CPACA') entityType = 'CPACA';
  else if (workflowType === 'PENAL_906') entityType = 'PENAL_906';
  else if (workflowType === 'TUTELA') entityType = 'TUTELA';
  else if (workflowType === 'LABORAL') entityType = 'LABORAL';
  else if (workflowType === 'GOV_PROCEDURE') entityType = 'GOV_PROCEDURE';
  
  const titleMap: Record<ImportantEventType, string> = {
    SENTENCIA: 'Sentencia detectada',
    AUTO_ADMISORIO: 'Auto Admisorio detectado',
    AUDIENCIA: 'Audiencia detectada',
    NOTIFICACION: 'Notificación detectada',
    RECURSO: 'Recurso detectado',
    ARCHIVO: 'Archivo/Terminación detectada',
    NORMAL: '',
  };
  
  try {
    // Use idempotent alert creation to prevent duplicates
    const result = await createAlertIdempotent({
      ownerId,
      organizationId: organizationId || undefined,
      entityType,
      entityId: workItemId,
      severity,
      title: titleMap[eventType],
      message: `Radicado ${radicado}: ${eventSummary}`,
      payload: {
        radicado,
        event_date: eventDate,
        event_type: eventType,
      },
      actions: [
        { label: 'Ver Proceso', action: 'navigate', params: { path: `/app/work-items/${workItemId}` } },
      ],
      fingerprintKeys: {
        radicado,
        eventType,
        eventDate: eventDate || undefined,
      },
    });
    
    return result.success;
  } catch (err) {
    console.error('Error creating event alert:', err);
    return false;
  }
}

/**
 * Queue email for CRITICAL alerts
 * 
 * Note: email_outbox requires organization_id (non-nullable) and html field
 */
export async function queueCriticalEmail(
  organizationId: string,
  recipientEmail: string,
  subject: string,
  message: string
): Promise<void> {
  if (!organizationId) {
    console.warn('Cannot queue email without organization_id');
    return;
  }
  
  try {
    // Build simple HTML from plain text message
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">[CRÍTICO] ${subject}</h2>
        <p style="white-space: pre-wrap;">${message}</p>
        <hr style="border: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #6b7280; font-size: 12px;">Este correo fue enviado automáticamente por Lex Docket.</p>
      </div>
    `;
    
    await supabase.from('email_outbox').insert({
      organization_id: organizationId,
      to_email: recipientEmail,
      subject: `[CRÍTICO] ${subject}`,
      html: htmlContent,
      status: 'PENDING',
      next_attempt_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error queueing critical email:', err);
  }
}
