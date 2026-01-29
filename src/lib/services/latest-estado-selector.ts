/**
 * Latest Estado Selector Utility
 * 
 * Provides deterministic selection of the "latest" estado per work item
 * from both work_item_publicaciones and work_item_acts sources.
 * 
 * Key principles:
 * - Uses published_at/act_date as primary ordering key
 * - Prefers publicaciones over acts for same timestamp (publicaciones are official)
 * - Generates stable fingerprints for alert deduplication
 * - Does NOT modify database - purely computational
 */

import type { TickerItem } from './ticker-data-service';
import type { EstadoHoyItem } from './estados-hoy-service';

// ============= TYPES =============

export interface LatestEstadoCandidate {
  id: string;
  type: 'ESTADO' | 'ACTUACION';
  source: string;
  work_item_id: string;
  radicado: string;
  effective_date: string | null;  // The date used for ordering
  created_at: string;
  fingerprint: string;
  // Additional display fields
  content: string;
  fecha_desfijacion?: string | null;
  terminos_inician?: string | null;
  is_deadline_trigger: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  // For full items
  client_name?: string;
  authority_name?: string;
  despacho?: string;
  pdf_url?: string;
  tipo_publicacion?: string;
}

export interface LatestEstadoResult {
  work_item_id: string;
  latest: LatestEstadoCandidate | null;
  fingerprint: string | null;
  effective_date: string | null;
}

// ============= FINGERPRINT GENERATION =============

/**
 * Generate a stable fingerprint for an estado/publicación
 * This is used to detect when the "latest" changes
 */
export function generateEstadoFingerprint(
  id: string,
  type: 'ESTADO' | 'ACTUACION',
  effectiveDate: string | null,
  content: string
): string {
  // Use a simple hash of the key identifying fields
  const normalized = `${type}|${id}|${effectiveDate || ''}|${content.toLowerCase().trim().slice(0, 100)}`;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `estado_${Math.abs(hash).toString(16)}_${id.slice(0, 8)}`;
}

// ============= COMPARISON LOGIC =============

/**
 * Compare two candidates to determine which is "more recent"
 * Returns negative if a < b, positive if a > b, zero if equal
 * 
 * Ordering rules:
 * 1. Primary: effective_date descending (newer first)
 * 2. Secondary: prefer ESTADO (publicaciones) over ACTUACION
 * 3. Tertiary: created_at descending
 * 4. Final: id comparison for stability
 */
function compareCandidates(a: LatestEstadoCandidate, b: LatestEstadoCandidate): number {
  // 1. Compare effective dates (newer first)
  const dateA = a.effective_date ? new Date(a.effective_date).getTime() : 0;
  const dateB = b.effective_date ? new Date(b.effective_date).getTime() : 0;
  if (dateB !== dateA) return dateB - dateA;
  
  // 2. Prefer ESTADO over ACTUACION (publicaciones are official)
  if (a.type !== b.type) {
    return a.type === 'ESTADO' ? -1 : 1;
  }
  
  // 3. Compare created_at (newer first)
  const createdA = new Date(a.created_at).getTime();
  const createdB = new Date(b.created_at).getTime();
  if (createdB !== createdA) return createdB - createdA;
  
  // 4. Final tie-breaker: id comparison
  return b.id.localeCompare(a.id);
}

// ============= MAIN SELECTOR =============

/**
 * Select the latest estado from a list of candidates
 * Returns null if no candidates exist
 */
export function selectLatestEstado(candidates: LatestEstadoCandidate[]): LatestEstadoCandidate | null {
  if (!candidates || candidates.length === 0) return null;
  
  // Sort candidates (the "most recent" will be first)
  const sorted = [...candidates].sort(compareCandidates);
  
  return sorted[0];
}

/**
 * Select the latest estado per work_item from a mixed list
 * Returns a map of work_item_id -> LatestEstadoResult
 */
export function selectLatestEstadosPerWorkItem(
  candidates: LatestEstadoCandidate[]
): Map<string, LatestEstadoResult> {
  const grouped = new Map<string, LatestEstadoCandidate[]>();
  
  // Group by work_item_id
  for (const candidate of candidates) {
    const existing = grouped.get(candidate.work_item_id) || [];
    existing.push(candidate);
    grouped.set(candidate.work_item_id, existing);
  }
  
  // Select latest for each work_item
  const results = new Map<string, LatestEstadoResult>();
  
  for (const [workItemId, items] of grouped) {
    const latest = selectLatestEstado(items);
    results.set(workItemId, {
      work_item_id: workItemId,
      latest,
      fingerprint: latest?.fingerprint ?? null,
      effective_date: latest?.effective_date ?? null,
    });
  }
  
  return results;
}

// ============= ADAPTER FUNCTIONS =============

/**
 * Convert a TickerItem to a LatestEstadoCandidate
 */
export function tickerItemToCandidate(item: TickerItem): LatestEstadoCandidate {
  const fingerprint = generateEstadoFingerprint(
    item.id,
    item.type,
    item.date,
    item.content
  );
  
  return {
    id: item.id,
    type: item.type,
    source: item.source,
    work_item_id: item.work_item_id,
    radicado: item.radicado,
    effective_date: item.date,
    created_at: item.created_at,
    fingerprint,
    content: item.content,
    fecha_desfijacion: item.fecha_desfijacion,
    terminos_inician: item.terminos_inician,
    is_deadline_trigger: item.is_deadline_trigger,
    severity: item.severity,
    client_name: item.client_name,
    authority_name: item.authority_name,
    despacho: item.despacho,
    pdf_url: item.pdf_url,
    tipo_publicacion: item.tipo_publicacion,
  };
}

/**
 * Convert an EstadoHoyItem to a LatestEstadoCandidate
 */
export function estadoHoyItemToCandidate(item: EstadoHoyItem): LatestEstadoCandidate {
  const fingerprint = generateEstadoFingerprint(
    item.id,
    item.type,
    item.date,
    item.content
  );
  
  return {
    id: item.id,
    type: item.type,
    source: item.source,
    work_item_id: item.work_item_id,
    radicado: item.radicado,
    effective_date: item.date,
    created_at: item.created_at,
    fingerprint,
    content: item.content,
    fecha_desfijacion: item.fecha_desfijacion,
    terminos_inician: item.terminos_inician,
    is_deadline_trigger: item.is_deadline_trigger,
    severity: item.severity,
    client_name: item.client_name,
    authority_name: item.authority_name,
    despacho: item.despacho,
    pdf_url: item.pdf_url,
    tipo_publicacion: item.tipo_publicacion,
  };
}

// ============= FILTER TO LATEST ONLY =============

/**
 * Filter a list of TickerItems to only include the latest per work_item
 */
export function filterToLatestTickerItems(items: TickerItem[]): TickerItem[] {
  if (!items || items.length === 0) return [];
  
  // Convert to candidates
  const candidates = items.map(tickerItemToCandidate);
  
  // Get latest per work_item
  const latestMap = selectLatestEstadosPerWorkItem(candidates);
  
  // Create a set of IDs that are "latest"
  const latestIds = new Set<string>();
  for (const result of latestMap.values()) {
    if (result.latest) {
      latestIds.add(result.latest.id);
    }
  }
  
  // Filter original items
  return items.filter(item => latestIds.has(item.id));
}

/**
 * Filter a list of EstadoHoyItems to only include the latest per work_item
 */
export function filterToLatestEstadoHoyItems(items: EstadoHoyItem[]): EstadoHoyItem[] {
  if (!items || items.length === 0) return [];
  
  // Convert to candidates
  const candidates = items.map(estadoHoyItemToCandidate);
  
  // Get latest per work_item
  const latestMap = selectLatestEstadosPerWorkItem(candidates);
  
  // Create a set of IDs that are "latest"
  const latestIds = new Set<string>();
  for (const result of latestMap.values()) {
    if (result.latest) {
      latestIds.add(result.latest.id);
    }
  }
  
  // Filter original items
  return items.filter(item => latestIds.has(item.id));
}

// ============= CHANGE DETECTION =============

/**
 * Check if the latest estado has changed from a stored baseline
 */
export function hasLatestEstadoChanged(
  newFingerprint: string | null,
  storedFingerprint: string | null | undefined
): boolean {
  // If no new fingerprint, nothing changed
  if (!newFingerprint) return false;
  
  // If no stored fingerprint, this is the first detection
  if (!storedFingerprint) return true;
  
  // Compare fingerprints
  return newFingerprint !== storedFingerprint;
}
