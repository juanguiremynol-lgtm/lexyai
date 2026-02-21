/**
 * sync-by-work-item Edge Function
 * 
 * PRODUCTION-GRADE sync for existing work items using external judicial APIs.
 * 
 * Features:
 * - Multi-tenant safe: validates user is member of work_item's organization
 * - CPNU primary + SAMAI fallback for radicado workflows
 * - TUTELAS API for TUTELA workflows (tutela_code-based)
 * - All external URLs from env vars: CPNU_BASE_URL, SAMAI_BASE_URL, TUTELAS_BASE_URL, EXTERNAL_X_API_KEY
 * - Idempotent: uses hash_fingerprint to prevent duplicates
 * - **NEW**: Detailed trace logging via sync_traces table for debugging
 * 
 * Input: { work_item_id: string }
 * Headers: X-Trace-Id (optional, for debugging)
 * Output: { ok, inserted_count, skipped_count, latest_event_date, provider_used, warnings, errors, trace_id }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeTraceError } from "../_shared/normalizeError.ts";
import { canonicalizeRole, parseSujetosProcesalesString } from "../_shared/partyNormalization.ts";
import { generateActuacionFingerprint as canonicalFingerprint } from "../_shared/syncOrchestrator.ts";
import { getProviderCoverage } from "../_shared/providerCoverageMatrix.ts";
import {
  orchestrateSync,
  createFetchRegistry,
  type SyncRunContext,
  type SyncRunResult,
  type ProviderFetchFn,
} from "../_shared/syncOrchestrator.ts";
import {
  createLegacyAdapter,
  extractLegacyResult,
  aggregateLegacyResults,
  type LegacyFetchResult,
} from "../_shared/providerAdapters.ts";

// ═══════════════════════════════════════════
// SHARED PROVIDER ADAPTERS (Step 3.2)
// These replace ~1100 lines of inline fetch functions.
// ═══════════════════════════════════════════
import {
  fetchFromCpnu as sharedFetchFromCpnu,
  fetchFromSamai as sharedFetchFromSamai,
  fetchFromTutelas as sharedFetchFromTutelas,
  mapCorteStatus as sharedMapCorteStatus,
  type ProviderAdapterResult,
} from '../_shared/providerAdapters/index.ts';
import { toOrchestratorResult, type OrchestratorFetchResult } from '../_shared/providerAdapters/bridge.ts';

// ============= FEATURE FLAG =============
// Orchestrator sync can be enabled globally via env var or per-org via atenia_ai_config.
// Per-org toggle (DB) takes precedence over global env var when present.
// Set USE_ORCHESTRATOR_SYNC=true globally, or set use_orchestrator_sync=true per-org in atenia_ai_config.
const USE_ORCHESTRATOR_SYNC_GLOBAL = Deno.env.get("USE_ORCHESTRATOR_SYNC") === "true";

/** Resolve whether to use orchestrator for a specific org (checks per-org toggle first) */
async function shouldUseOrchestrator(supabase: any, organizationId: string): Promise<boolean> {
  // Per-org canary toggle takes precedence
  try {
    const { data } = await supabase
      .from('atenia_ai_config')
      .select('use_orchestrator_sync')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (data?.use_orchestrator_sync === true) return true;
    if (data?.use_orchestrator_sync === false) return false;
  } catch {
    // DB check failed, fall back to global
  }
  return USE_ORCHESTRATOR_SYNC_GLOBAL;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-trace-id',
};

// ============= RETRY QUEUE HELPER =============

function jitterMs(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

/**
 * Enqueue a delayed retry for SCRAPING_TIMEOUT failures.
 * Uses UPSERT on (work_item_id, kind) to avoid duplicates.
 */
async function enqueueScrapingRetry(
  supabase: any,
  input: {
    workItemId: string;
    organizationId: string | null;
    radicado: string;
    workflowType: string;
    stage?: string | null;
    provider: string;
    kind: 'ACT_SCRAPE_RETRY' | 'PUB_RETRY';
    scrapingJobId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  try {
    const nextRunAt = new Date(Date.now() + jitterMs(30_000, 60_000)).toISOString();
    
    // Check if already queued
    const { data: existing } = await (supabase.from('sync_retry_queue') as any)
      .select('id, attempt, max_attempts')
      .eq('work_item_id', input.workItemId)
      .eq('kind', input.kind)
      .maybeSingle();

    if (existing) {
      // Already queued — increment attempt and reschedule
      if (existing.attempt < existing.max_attempts) {
        await (supabase.from('sync_retry_queue') as any)
          .update({
            attempt: existing.attempt + 1,
            next_run_at: nextRunAt,
            last_error_code: input.errorCode || 'SCRAPING_TIMEOUT',
            last_error_message: input.errorMessage || 'Rescheduled',
            scraping_job_id: input.scrapingJobId || null,
          })
          .eq('id', existing.id);
        console.log(`[sync-by-work-item] Retry rescheduled: attempt ${existing.attempt + 1}/${existing.max_attempts}, next_run_at=${nextRunAt}`);
      } else {
        console.log(`[sync-by-work-item] Retry already at max attempts (${existing.max_attempts}), not rescheduling`);
      }
      return;
    }

    // Insert new retry task
    await (supabase.from('sync_retry_queue') as any).insert({
      work_item_id: input.workItemId,
      organization_id: input.organizationId,
      radicado: input.radicado,
      workflow_type: input.workflowType,
      stage: input.stage || null,
      kind: input.kind,
      provider: input.provider,
      attempt: 1,
      max_attempts: 3,
      next_run_at: nextRunAt,
      last_error_code: input.errorCode || 'SCRAPING_TIMEOUT',
      last_error_message: input.errorMessage || 'Initial retry scheduled',
      scraping_job_id: input.scrapingJobId || null,
    });

    console.log(`[sync-by-work-item] Retry enqueued: kind=${input.kind}, provider=${input.provider}, next_run_at=${nextRunAt}`);
  } catch (err) {
    // Non-blocking — retry queue is best-effort
    console.warn('[sync-by-work-item] Failed to enqueue retry:', err);
  }
}

// ============= TYPES =============

interface SyncRequest {
  work_item_id: string;
  force_refresh?: boolean;
  _scheduled?: boolean; // When true, skip auth + org membership check (cron/fallback callers)
  /** Release-gate payload for deterministic testing (platform admin only) */
  release_gate?: {
    force_empty_provider?: string;
    force_empty_once?: boolean;
  };
}

interface ProviderAttempt {
  provider: string;
  status: 'success' | 'not_found' | 'empty' | 'error' | 'timeout' | 'skipped';
  latencyMs: number;
  message?: string;
  actuacionesCount?: number;
}

interface SyncResult {
  ok: boolean;
  work_item_id: string;
  workflow_type: string;
  inserted_count: number;
  skipped_count: number;
  latest_event_date: string | null;
  provider_used: string | null;
  provider_attempts: ProviderAttempt[];
  provider_order_reason: string;
  warnings: string[];
  errors: string[];
  trace_id?: string;
  code?: string; // Error code for client
  // Auto-scraping fields
  scraping_initiated?: boolean;
  scraping_job_id?: string;
  scraping_poll_url?: string;
  scraping_provider?: string;
  scraping_message?: string;
}

interface WorkItem {
  id: string;
  owner_id: string;
  organization_id: string;
  workflow_type: string;
  radicado: string | null;
  tutela_code: string | null;
  scrape_status: string | null;
  last_crawled_at: string | null;
  expediente_url: string | null;
  authority_name: string | null;
  authority_city: string | null;
  authority_department: string | null;
}

interface ActuacionRaw {
  fecha: string;
  actuacion: string;
  anotacion?: string;
  fecha_inicia_termino?: string;
  fecha_finaliza_termino?: string;
  // Registration date (CPNU fechaRegistro / SAMAI fecha_registro)
  fecha_registro?: string;
  // Estado (SAMAI-specific)
  estado?: string;
  // Anexos count (SAMAI) or conDocumentos flag (CPNU)
  anexos?: number;
  // Sequence/index (CPNU consActuacion / SAMAI indice)
  indice?: string;
  // Court/despacho name per actuación (CPNU-specific)
  nombre_despacho?: string;
  // Document attachments (CPNU documentos array)
  documentos?: Array<{ nombre: string; url: string }>;
}

interface FetchResult {
  ok: boolean;
  actuaciones: ActuacionRaw[];
  expedienteUrl?: string;
  caseMetadata?: {
    despacho?: string;
    demandante?: string;
    demandado?: string;
    tipo_proceso?: string;
    // SAMAI-specific metadata fields
    origen?: string;
    ponente?: string;
    clase_proceso?: string;
    etapa?: string;
    ubicacion?: string;
    formato_expediente?: string;
    subclase?: string;
    recurso?: string;
    naturaleza?: string;
    fecha_radicado?: string;
    fecha_presenta_demanda?: string;
    fecha_para_sentencia?: string;
    fecha_sentencia?: string;
    asunto?: string;
    medida_cautelar?: string;
    ministerio_publico?: string;
    total_sujetos?: number;
    // Additional SAMAI metadata
    sala_conoce?: string;
    sala_decide?: string;
    veces_en_corporacion?: number;
    guid?: string;
    consultado_en?: string;
    fuente?: string;
  };
  // SAMAI sujetos for demandantes/demandados extraction
  sujetos?: Array<{
    registro?: string;
    tipo: string;
    nombre: string;
    accesoWebActivado?: boolean;
  }>;
  error?: string;
  provider: string;
  isEmpty?: boolean; // Indicates empty result (for fallback logic)
  latencyMs?: number;
  httpStatus?: number;
  // Auto-scraping fields
  scrapingInitiated?: boolean;
  scrapingJobId?: string;
  scrapingPollUrl?: string;
  scrapingMessage?: string;
}

// ============= TRACE LOGGING =============

interface TraceEvent {
  trace_id: string;
  work_item_id: string | null;
  organization_id: string | null;
  workflow_type: string | null;
  step: string;
  provider: string | null;
  http_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  message: string | null;
  meta: Record<string, unknown>;
}

// Log a trace event to the database (non-blocking, fail-safe)
// Enriches with normalized_error_code and body_preview for autonomy engine consumption.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logTrace(
  supabase: any,
  event: Partial<TraceEvent> & { trace_id: string; step: string }
): Promise<void> {
  try {
    // Compute normalized_error_code using canonical shared normalizer
    const normalizedCode = !event.success && event.error_code
      ? normalizeTraceError(event.error_code, event.http_status, event.message)
      : null;
    // Extract body_preview from meta if present
    const bodyPreview = (event.meta?.response_preview as string)?.slice(0, 200)
      || (event.meta?.body_preview as string)?.slice(0, 200)
      || null;

    // Use 'any' cast since sync_traces table may not be in generated types yet
    await (supabase.from('sync_traces') as any).insert({
      trace_id: event.trace_id,
      work_item_id: event.work_item_id || null,
      organization_id: event.organization_id || null,
      workflow_type: event.workflow_type || null,
      step: event.step,
      provider: event.provider || null,
      http_status: event.http_status || null,
      latency_ms: event.latency_ms || null,
      success: event.success ?? false,
      error_code: event.error_code || null,
      normalized_error_code: normalizedCode,
      body_preview: bodyPreview,
      message: event.message?.slice(0, 500) || null, // Truncate messages
      meta: event.meta || {},
    });
  } catch (err) {
    // Fail silently - tracing should never break the main flow
    console.warn('[sync-by-work-item] Failed to log trace:', err);
  }
}

// ============= WORKFLOW-BASED PROVIDER ORDER =============
// 
// NOTIFICATION SOURCES:
// - CGP/LABORAL: ESTADOS are primary notification source (for legal terms)
//   - CPNU primary for enrichment actuaciones, SAMAI fallback
// - CPACA: SAMAI primary (administrative litigation), CPNU optional fallback (disabled)
// - TUTELA: TUTELAS API primary (tutela_code), CPNU fallback if TUTELAS empty/failed
// - PENAL_906: PUBLICACIONES are PRIMARY sync source (called FIRST); CPNU/SAMAI are optional enrichment
// 
// The Estados ingestion pipeline remains canonical for CGP/LABORAL.

type WorkflowType = 'CGP' | 'LABORAL' | 'CPACA' | 'TUTELA' | 'PENAL_906' | 'PETICION' | 'GOV_PROCEDURE';

interface ProviderOrderConfig {
  primary: 'cpnu' | 'samai' | 'tutelas' | 'publicaciones';
  fallback?: 'cpnu' | 'samai' | null;
  fallbackEnabled: boolean;
  usePublicacionesAsPrimary?: boolean; // For PENAL_906: Publicaciones is the PRIMARY sync source
}

function getProviderOrder(workflowType: string): ProviderOrderConfig {
  // Derive from canonical coverage matrix (single source of truth)
  const actCoverage = getProviderCoverage(workflowType, "ACTUACIONES");
  
  if (!actCoverage.compatible || actCoverage.providers.length === 0) {
    return { primary: 'cpnu', fallback: null, fallbackEnabled: false };
  }
  
  const primaryProvider = actCoverage.providers.find(p => p.role === "PRIMARY");
  const fallbackProvider = actCoverage.providers.find(p => p.role === "FALLBACK");
  
  // Map uppercase matrix keys to lowercase provider keys used by inline fetch functions
  const keyMap: Record<string, 'cpnu' | 'samai' | 'tutelas' | 'publicaciones'> = {
    'CPNU': 'cpnu',
    'SAMAI': 'samai',
    'TUTELAS': 'tutelas',
    'PUBLICACIONES': 'publicaciones',
    'SAMAI_ESTADOS': 'samai',
  };
  
  const primary = keyMap[primaryProvider?.key || 'CPNU'] || 'cpnu';
  const fallback = fallbackProvider ? (keyMap[fallbackProvider.key] || null) : null;
  
  return {
    primary,
    fallback,
    fallbackEnabled: !!fallback,
  };
}

// ============= HELPERS =============

// ============= SMART CONSOLIDATION ENGINE =============
// Two-tier deduplication for cross-provider TUTELA sync:
// Tier 1: Exact fingerprint per provider (existing, handles same-provider dedup)
// Tier 2: Fuzzy cross-provider match using Jaccard similarity + legal event classification

/**
 * Remove accents, punctuation, collapse whitespace, uppercase
 */
function normalizeTextForComparison(text: string): string {
  return text
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^A-Z0-9\s]/g, '')                       // Remove punctuation
    .replace(/\s+/g, ' ')                               // Collapse whitespace
    .trim();
}

/**
 * Jaccard similarity on word tokens (0-1 range)
 */
function normalizedSimilarity(a: string, b: string): number {
  const normA = normalizeTextForComparison(a);
  const normB = normalizeTextForComparison(b);

  const tokensA = new Set(normA.split(/\s+/).filter(Boolean));
  const tokensB = new Set(normB.split(/\s+/).filter(Boolean));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.size / union.size;
}

/**
 * Classify legal event type from description text
 */
function classifyActuacionType(description: string): string {
  const upper = description.toUpperCase();

  if (/SENTENCIA|FALLO/.test(upper)) return 'SENTENCIA';
  if (/AUTO\s+ADMISORIO|ADMITE\s+TUTELA/.test(upper)) return 'AUTO_ADMISORIO';
  if (/AUTO\s+INTERLOCUTORIO/.test(upper)) return 'AUTO_INTERLOCUTORIO';
  if (/AUDIENCIA/.test(upper)) return 'AUDIENCIA';
  if (/IMPUGNA/.test(upper)) return 'IMPUGNACION';
  if (/NOTIFICA/.test(upper)) return 'NOTIFICACION';
  if (/RECURSO/.test(upper)) return 'RECURSO';
  if (/SELECCION.*REVISION|REVISION/.test(upper)) return 'SELECCION_REVISION';
  if (/ARCHIV/.test(upper)) return 'ARCHIVO';
  if (/TRASLADO/.test(upper)) return 'TRASLADO';
  if (/REQUIERE|REQUERIMIENTO/.test(upper)) return 'REQUERIMIENTO';

  return 'OTHER';
}

/**
 * Source priority for TUTELA: determines processing order.
 * Lower court actuaciones: CPNU > SAMAI
 * Corte Constitucional: TUTELAS is authoritative
 */
const TUTELA_SOURCE_PRIORITY: string[] = ['cpnu', 'samai', 'tutelas'];

/**
 * Merge TUTELA metadata from multiple providers using "best available" strategy.
 * Called in provider priority order: CPNU → SAMAI → TUTELAS.
 * - Most fields: first non-empty wins (respects call order priority)
 * - Stage: TUTELAS always overrides (Corte Constitucional status is most authoritative)
 * - Additive fields (tutela_code, corte_status, sentencia_ref): take from whoever provides
 * - total_actuaciones: sum across providers (before dedup)
 */
function mergeTutelaMetadata(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  source: string
): Record<string, unknown> {
  const merged = { ...current };

  // First-non-empty for standard fields
  const firstWins = [
    'despacho', 'demandante', 'demandado', 'demandantes', 'demandados',
    'ponente', 'origen', 'clase_proceso', 'etapa', 'ubicacion',
    'formato_expediente', 'tipo_proceso', 'subclase', 'recurso',
    'naturaleza', 'asunto', 'medida_cautelar', 'ministerio_publico',
    'total_sujetos', 'guid', 'consultado_en', 'fuente',
    'sala_conoce', 'sala_decide', 'veces_en_corporacion',
    'fecha_radicado', 'fecha_presenta_demanda', 'fecha_para_sentencia', 'fecha_sentencia',
  ];

  for (const key of firstWins) {
    if (!merged[key] && incoming[key]) {
      merged[key] = incoming[key];
    }
  }

  // Stage: TUTELAS (Corte Constitucional) always overrides
  if ((source === 'tutelas' || source === 'tutelas-api') && incoming.stage) {
    merged.stage = incoming.stage;
  } else if (!merged.stage && incoming.stage) {
    merged.stage = incoming.stage;
  }

  // Additive/authoritative fields — take from whoever provides them
  const additive = ['tutela_code', 'corte_status', 'sentencia_ref'];
  for (const key of additive) {
    if (incoming[key]) merged[key] = incoming[key]; // Last provider with data wins (TUTELAS is last)
  }

  // total_actuaciones: sum across providers (before dedup)
  const currentTotal = (merged.total_actuaciones as number) || 0;
  const incomingTotal = (incoming.total_actuaciones as number) || 0;
  if (incomingTotal > 0) {
    merged.total_actuaciones = currentTotal + incomingTotal;
  }

  return merged;
}

interface ConsolidatedActuacion {
  best: ActuacionRaw;
  sources: string[];
  crossProviderData: Record<string, unknown>;
}

/**
 * Find a cross-provider duplicate for a new actuacion among existing consolidated records.
 * Returns the matching record or null if no match.
 */
function findCrossProviderDuplicate(
  newAct: ActuacionRaw,
  newSource: string,
  existingRecords: ConsolidatedActuacion[]
): ConsolidatedActuacion | null {
  const newDate = (newAct.fecha || '').slice(0, 10);

  for (const existing of existingRecords) {
    const existingDate = (existing.best.fecha || '').slice(0, 10);

    // Rule 1: Same date is REQUIRED
    if (newDate !== existingDate) continue;

    // Rule 2: Same source means NOT a cross-provider comparison (Tier 1 handles it)
    if (existing.sources.length === 1 && existing.sources[0] === newSource) continue;

    // Rule 3: Description similarity via Jaccard
    const descSimilarity = normalizedSimilarity(
      newAct.actuacion || '',
      existing.best.actuacion || ''
    );

    // Rule 4: High similarity (>70%) = same event
    if (descSimilarity > 0.70) {
      return existing;
    }

    // Rule 5: Same legal event type on same date = same event
    const newType = classifyActuacionType(newAct.actuacion || '');
    const existingType = classifyActuacionType(existing.best.actuacion || '');
    if (newType !== 'OTHER' && newType === existingType) {
      return existing;
    }
  }

  return null;
}

// ============= SIGNIFICANT EVENT DETECTION =============
// Detects important judicial events that warrant alerts
// IMPORTANT: Severity must be uppercase to match DB constraint: 'INFO', 'WARNING', 'CRITICAL'

interface SignificantEventInfo {
  type: string;
  title: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

const SIGNIFICANT_EVENT_PATTERNS: Array<{ patterns: string[]; info: SignificantEventInfo }> = [
  {
    patterns: ['auto admisorio', 'auto admite demanda', 'admite la demanda', 'se admite demanda'],
    info: { type: 'AUTO_ADMISORIO', title: 'Auto Admisorio detectado', severity: 'INFO' },
  },
  {
    patterns: ['sentencia', 'fallo de primera', 'fallo de segunda', 'se profiere sentencia'],
    info: { type: 'SENTENCIA', title: 'Sentencia detectada', severity: 'CRITICAL' },
  },
  {
    patterns: ['audiencia fijada', 'fija fecha para audiencia', 'señala fecha audiencia'],
    info: { type: 'AUDIENCIA_PROGRAMADA', title: 'Audiencia programada', severity: 'INFO' },
  },
  {
    patterns: ['recurso de apelación', 'concede apelación', 'admite recurso'],
    info: { type: 'APELACION', title: 'Recurso de apelación', severity: 'WARNING' },
  },
  {
    patterns: ['rechaza la demanda', 'rechaza demanda', 'auto de rechazo'],
    info: { type: 'RECHAZO', title: 'Demanda rechazada', severity: 'CRITICAL' },
  },
  {
    patterns: ['inadmite la demanda', 'auto inadmisorio', 'se inadmite'],
    info: { type: 'INADMISION', title: 'Demanda inadmitida', severity: 'WARNING' },
  },
  {
    patterns: ['medida cautelar', 'embargo', 'secuestro de bienes'],
    info: { type: 'MEDIDA_CAUTELAR', title: 'Medida cautelar ordenada', severity: 'WARNING' },
  },
  {
    patterns: ['ejecutoria', 'queda ejecutoriada', 'en firme'],
    info: { type: 'EJECUTORIA', title: 'Decisión en firme', severity: 'INFO' },
  },
];

function detectSignificantEvent(actuacion: string, anotacion: string): SignificantEventInfo | null {
  const textToSearch = `${actuacion} ${anotacion}`.toLowerCase();
  
  for (const { patterns, info } of SIGNIFICANT_EVENT_PATTERNS) {
    for (const pattern of patterns) {
      if (textToSearch.includes(pattern.toLowerCase())) {
        return info;
      }
    }
  }
  
  return null;
}

// ============= STAGE INFERENCE =============
// Lightweight stage inference from actuación text

interface StageSuggestion {
  suggestedStage: string;
  confidence: number;
  reason: string;
}

const STAGE_INFERENCE_PATTERNS: Array<{
  patterns: string[];
  stages: Record<string, string>; // workflow_type -> stage
  confidence: number;
  reason: string;
}> = [
  // ============= AUTO ADMISORIO (HIGH CONFIDENCE) =============
  {
    patterns: ['auto admisorio', 'auto admite demanda', 'admite la demanda', 'se admite demanda'],
    stages: { CGP: 'AUTO_ADMISORIO', LABORAL: 'AUTO_ADMISORIO', CPACA: 'AUTO_ADMISORIO', TUTELA: 'TUTELA_ADMITIDA' },
    confidence: 0.9,
    reason: 'Auto admisorio detectado en actuación',
  },
  // ============= RADICACIÓN =============
  {
    patterns: ['radicación de proceso', 'radicación demanda', 'se radica demanda'],
    stages: { CGP: 'RADICADO_CONFIRMED', LABORAL: 'RADICACION', CPACA: 'DEMANDA_RADICADA', TUTELA: 'TUTELA_RADICADA' },
    confidence: 0.85,
    reason: 'Radicación de proceso detectada',
  },
  // ============= NOTIFICACIÓN (CGP-specific) =============
  {
    patterns: ['notificación personal', 'se notifica personalmente', 'notificación por estado', 'notificación por aviso'],
    stages: { CGP: 'NOTIFICACION', LABORAL: 'NOTIFICACION', CPACA: 'NOTIFICACION_TRASLADOS' },
    confidence: 0.8,
    reason: 'Notificación detectada',
  },
  // ============= AUDIENCIA INICIAL (CGP) =============
  {
    patterns: ['audiencia inicial', 'fija fecha para audiencia inicial', 'citación audiencia inicial'],
    stages: { CGP: 'AUDIENCIA_INICIAL', LABORAL: 'AUDIENCIA_INICIAL', CPACA: 'AUDIENCIA_INICIAL' },
    confidence: 0.85,
    reason: 'Audiencia inicial detectada',
  },
  // ============= AUDIENCIA DE INSTRUCCIÓN Y JUZGAMIENTO (CGP-specific) =============
  {
    patterns: ['audiencia de instrucción', 'audiencia de juzgamiento', 'audiencia instrucción y juzgamiento', 'audiencia de trámite y juzgamiento'],
    stages: { CGP: 'AUDIENCIA_INSTRUCCION_JUZGAMIENTO', LABORAL: 'AUDIENCIA_TRAMITE_JUZGAMIENTO' },
    confidence: 0.9,
    reason: 'Audiencia de instrucción y juzgamiento detectada',
  },
  // ============= CONTESTACIÓN DEMANDA (CGP) =============
  {
    patterns: ['contestación demanda', 'contesta demanda', 'contestación de la demanda'],
    stages: { CGP: 'CONTESTACION', LABORAL: 'CONTESTACION', CPACA: 'CONTESTACION' },
    confidence: 0.85,
    reason: 'Contestación de demanda detectada',
  },
  // ============= TRASLADO (CGP) =============
  {
    patterns: ['traslado de la demanda', 'traslado demanda', 'corre traslado'],
    stages: { CGP: 'TRASLADO', LABORAL: 'TRASLADO', CPACA: 'TRASLADO_DEMANDA' },
    confidence: 0.8,
    reason: 'Traslado de demanda detectado',
  },
  // ============= SENTENCIA (HIGH CONFIDENCE) =============
  {
    patterns: ['sentencia', 'fallo de primera instancia', 'profiere sentencia', 'se profiere sentencia'],
    stages: { CGP: 'SENTENCIA', LABORAL: 'SENTENCIA_1A_INSTANCIA', CPACA: 'ALEGATOS_SENTENCIA', TUTELA: 'FALLO_PRIMERA_INSTANCIA' },
    confidence: 0.9,
    reason: 'Sentencia detectada en actuación',
  },
  // ============= RECURSOS =============
  {
    patterns: ['recurso de apelación', 'concede apelación', 'interpone recurso', 'recurso de reposición'],
    stages: { CGP: 'RECURSOS', LABORAL: 'APELACION', CPACA: 'RECURSOS', TUTELA: 'FALLO_SEGUNDA_INSTANCIA' },
    confidence: 0.85,
    reason: 'Recurso detectado',
  },
  // ============= MANDAMIENTO DE PAGO (EJECUTIVO CGP) =============
  {
    patterns: ['mandamiento de pago', 'libra mandamiento', 'mandamiento ejecutivo'],
    stages: { CGP: 'MANDAMIENTO_PAGO' },
    confidence: 0.9,
    reason: 'Mandamiento de pago detectado (proceso ejecutivo)',
  },
  // ============= EXCEPCIONES (CGP) =============
  {
    patterns: ['propone excepciones', 'excepciones previas', 'formula excepciones'],
    stages: { CGP: 'EXCEPCIONES', LABORAL: 'EXCEPCIONES' },
    confidence: 0.8,
    reason: 'Excepciones detectadas',
  },
  // ============= PRUEBAS (CGP) =============
  {
    patterns: ['decreto de pruebas', 'decreta pruebas', 'período probatorio'],
    stages: { CGP: 'PRUEBAS', LABORAL: 'PRUEBAS', CPACA: 'PERIODO_PROBATORIO' },
    confidence: 0.8,
    reason: 'Etapa probatoria detectada',
  },
  // ============= ALEGATOS =============
  {
    patterns: ['alegatos de conclusión', 'traslado para alegar', 'presenta alegatos'],
    stages: { CGP: 'ALEGATOS', LABORAL: 'ALEGATOS', CPACA: 'ALEGATOS_SENTENCIA' },
    confidence: 0.75,
    reason: 'Etapa de alegatos detectada',
  },
];

function inferStageFromActuacion(
  workflowType: string,
  actuacion: string,
  anotacion: string
): StageSuggestion | null {
  const textToSearch = `${actuacion} ${anotacion}`.toLowerCase();
  
  for (const { patterns, stages, confidence, reason } of STAGE_INFERENCE_PATTERNS) {
    for (const pattern of patterns) {
      if (textToSearch.includes(pattern.toLowerCase())) {
        const suggestedStage = stages[workflowType];
        if (suggestedStage) {
          return { suggestedStage, confidence, reason };
        }
      }
    }
  }
  
  return null;
}


// TRACE ERROR NORMALIZATION: Uses canonical _shared/normalizeError.ts (imported above).
// Inline normalizeTraceErrorCode removed — single source of truth.
// ============= ERROR CLASSIFICATION =============

/**
 * Classify provider errors into standardized error codes.
 * Used for work_items.last_error_code and sync_traces.error_code.
 */
function classifyProviderError(
  fetchResult: FetchResult | null | undefined,
  fallbackCode: string
): string {
  if (!fetchResult) return 'UNKNOWN_ERROR';

  const httpStatus = fetchResult.httpStatus;
  const errorMsg = (fetchResult.error || '').toLowerCase();

  // HTTP status-based classification
  if (httpStatus) {
    if (httpStatus === 401 || httpStatus === 403) return 'PROVIDER_AUTH_FAILED';
    if (httpStatus === 404) {
      // Distinguish route vs record 404 using memory/observability/404-semantic-classification-v2
      if (errorMsg.includes('not found') && (errorMsg.includes('html') || errorMsg.includes('detail'))) {
        return 'PROVIDER_ROUTE_NOT_FOUND';
      }
      return 'PROVIDER_404';
    }
    if (httpStatus === 429) return 'PROVIDER_RATE_LIMITED';
    if (httpStatus >= 500) return 'PROVIDER_SERVER_ERROR';
  }

  // Message-based classification
  if (errorMsg.includes('timeout') || errorMsg.includes('timed out') || errorMsg.includes('aborted')) {
    return 'PROVIDER_TIMEOUT';
  }
  if (errorMsg.includes('network') || errorMsg.includes('fetch failed') || errorMsg.includes('econnrefused')) {
    return 'NETWORK_ERROR';
  }
  if (errorMsg.includes('rate limit') || errorMsg.includes('too many requests')) {
    return 'PROVIDER_RATE_LIMITED';
  }
  if (fetchResult.isEmpty) return 'PROVIDER_404';
  if (errorMsg.includes('scraping')) return 'SCRAPING_TIMEOUT';

  return fallbackCode || 'PROVIDER_ERROR';
}

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number = 400, traceId?: string): Response {
  return jsonResponse({
    ok: false,
    code,
    message,
    trace_id: traceId,
    timestamp: new Date().toISOString(),
  }, status);
}

function isValidTutelaCode(code: string): boolean {
  return /^T\d{6,10}$/i.test(code);
}

function isValidRadicado(radicado: string): boolean {
  const normalized = normalizeRadicado(radicado);
  return normalized.length === 23;
}

/**
 * Normalize radicado input:
 * - Trims whitespace
 * - If starts with 'T' (tutela code), keeps the 'T' prefix and removes spaces
 * - Otherwise removes all non-digits (spaces, hyphens, etc.)
 * This is used for all external API calls while preserving original in DB.
 */
function normalizeRadicado(radicado: string): string {
  if (!radicado) return '';
  const trimmed = radicado.trim();
  
  // Tutela codes start with T followed by digits (e.g., T1234567)
  if (/^[Tt]\d/.test(trimmed)) {
    // Keep the T prefix, remove spaces but keep the structure
    return trimmed.toUpperCase().replace(/\s+/g, '');
  }
  
  // Standard radicado: remove all non-digits
  return trimmed.replace(/\D/g, '');
}

/**
 * Generate fingerprint for deduplication
 * CRITICAL: Includes indice (sequence number) to prevent collisions when
 * multiple actuaciones from the same day have similar text
 */
function generateFingerprint(
  workItemId: string,
  date: string,
  text: string,
  indice?: string,
  source?: string,
  crossProviderDedup = false
): string {
  // FANOUT mode: exclude source to enable cross-provider dedup at DB level
  const sourcePart = source && !crossProviderDedup ? `|${source}` : '';
  const indexPart = indice ? `|${indice}` : '';
  const normalized = `${workItemId}|${date}|${text.toLowerCase().trim().slice(0, 200)}${indexPart}${sourcePart}`;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `wi_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

function parseColombianDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  
  // If already ISO format, return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }
  
  // Remove time portion if present (e.g., "07/06/2025 6:06:44" -> "07/06/2025")
  // Also handles "09/06/2025" without time
  const dateOnly = dateStr.split(' ')[0];
  
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,  // DD/MM/YYYY (Colombian format)
    /^(\d{2})-(\d{2})-(\d{4})$/,    // DD-MM-YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // D/M/YYYY or DD/M/YYYY
  ];

  for (const pattern of patterns) {
    const match = dateOnly.match(pattern);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      return `${match[3]}-${month}-${day}`; // YYYY-MM-DD
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════
// THIN WRAPPERS: Shared Adapter → Local FetchResult
// These replace ~1100 lines of inline fetch functions.
// All HTTP calls, parsing, normalization, polling, and scraping logic
// now live in _shared/providerAdapters/*.ts
// ═══════════════════════════════════════════

/**
 * Convert shared ProviderAdapterResult → local FetchResult for orchestration pipeline.
 * This is a thin bridge preserving the existing post-processing contract.
 */
function sharedResultToFetchResult(result: ProviderAdapterResult): FetchResult {
  const bridged = toOrchestratorResult(result);
  return {
    ok: bridged.ok,
    actuaciones: bridged.actuaciones,
    expedienteUrl: bridged.expedienteUrl,
    caseMetadata: bridged.caseMetadata as FetchResult['caseMetadata'],
    sujetos: bridged.sujetos,
    error: bridged.error,
    provider: bridged.provider,
    isEmpty: bridged.isEmpty,
    latencyMs: bridged.latencyMs,
    httpStatus: bridged.httpStatus,
    scrapingInitiated: bridged.scrapingInitiated,
    scrapingJobId: bridged.scrapingJobId,
    scrapingPollUrl: bridged.scrapingPollUrl,
    scrapingMessage: result.status === 'SCRAPING_INITIATED'
      ? `Scraping job ${result.scrapingJobId} initiated. Retry in 30-60 seconds.`
      : undefined,
  };
}

async function fetchFromCpnu(radicado: string): Promise<FetchResult> {
  const result = await sharedFetchFromCpnu({
    radicado,
    mode: 'monitoring',
    includeParties: true,
  });
  return sharedResultToFetchResult(result);
}

async function fetchFromSamai(radicado: string): Promise<FetchResult> {
  const result = await sharedFetchFromSamai({
    radicado,
    mode: 'monitoring',
    includeParties: true,
  });
  return sharedResultToFetchResult(result);
}

async function fetchFromTutelasApi(identifier: string, identifierType: 'tutela_code' | 'radicado' = 'tutela_code'): Promise<FetchResult> {
  const result = await sharedFetchFromTutelas({
    radicado: identifier,
    mode: 'monitoring',
    includeParties: true,
  });
  return sharedResultToFetchResult(result);
}

/**
 * Map raw Corte Constitucional status to canonical status.
 * Delegates to shared adapter.
 */
function mapCorteStatus(estado: string): string {
  return sharedMapCorteStatus(estado);
}

/**
 * Extract tutela_code (T-XXXXXXX) from CPNU/SAMAI actuaciones text
 * Sometimes CPNU mentions "Expediente T-1234567" in actuación annotations
 */
function extractTutelaCodeFromActuaciones(actuaciones: ActuacionRaw[]): string | null {
  for (const act of actuaciones) {
    const text = `${act.actuacion || ''} ${act.anotacion || ''}`;
    const match = text.match(/\b(T-?\d{4,10})\b/i);
    if (match) return match[1].toUpperCase().replace(/^T(\d)/, 'T$1');
    const suMatch = text.match(/\b(SU-\d{3,4}\/\d{4})\b/i);
    if (suMatch) return suMatch[1].toUpperCase();
  }
  return null;
}

// ============= PUBLICACIONES =============
// NOTE: Publicaciones sync is now handled by a separate edge function:
// sync-publicaciones-by-work-item
// This function (sync-by-work-item) focuses only on actuaciones from CPNU/SAMAI/TUTELAS.

// ============= ORCHESTRATOR EXECUTION PATH =============
// When USE_ORCHESTRATOR_SYNC=true, this function handles provider sequencing
// via the shared orchestrator. Returns the aggregated FetchResult(s) for
// post-processing by the existing pipeline.

interface OrchestratorExecResult {
  /** Primary FetchResult for ingestion pipeline (or null if all failed) */
  fetchResult: FetchResult | null;
  /** All FetchResults from FANOUT (for TUTELA multi-source merge) */
  allFetchResults: FetchResult[];
  /** All provider labels that returned data */
  allSources: string[];
  /** Provider attempts for the response */
  providerAttempts: ProviderAttempt[];
  /** Provider order reason string */
  providerOrderReason: string;
  /** Warnings accumulated */
  warnings: string[];
  /** Whether scraping was initiated */
  scrapingInitiated: boolean;
  scrapingResult: FetchResult | null;
  /** Orchestrator sync run ID (for external_sync_runs) */
  syncRunId: string | null;
  /** Overall orchestrator status */
  orchestratorStatus: string;
}

async function executeViaOrchestrator(
  workItem: WorkItem,
  supabase: any,
  traceId: string,
  isScheduled: boolean,
  releaseGate?: { force_empty_provider?: string; force_empty_once?: boolean },
): Promise<OrchestratorExecResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Build provider fetch registry using existing inline functions as adapters
  const normalizedRadicado = workItem.radicado ? normalizeRadicado(workItem.radicado) : "";
  const hasTutelaCode = workItem.tutela_code && isValidTutelaCode(workItem.tutela_code);

  const registry = createFetchRegistry([
    {
      key: "CPNU",
      fetchFn: createLegacyAdapter(
        (radicado: string) => fetchFromCpnu(radicado),
      ),
    },
    {
      key: "SAMAI",
      fetchFn: createLegacyAdapter(
        (radicado: string) => fetchFromSamai(radicado),
      ),
    },
    {
      key: "TUTELAS",
      fetchFn: createLegacyAdapter(
        (identifier: string) => {
          // Use tutela_code if available, otherwise radicado
          if (hasTutelaCode) {
            return fetchFromTutelasApi(workItem.tutela_code!, "tutela_code");
          }
          return fetchFromTutelasApi(identifier, "radicado");
        },
      ),
    },
    // Note: PUBLICACIONES is handled by sync-publicaciones-by-work-item
    // SAMAI_ESTADOS is an EXTERNAL provider handled by the external enrichment section
  ]);

  const ctx: SyncRunContext = {
    workItemId: workItem.id,
    organizationId: workItem.organization_id,
    workflowType: workItem.workflow_type,
    radicado: normalizedRadicado || workItem.tutela_code || "",
    invokedBy: isScheduled ? "CRON" : "MANUAL",
    triggerSource: "sync-by-work-item",
  };

  console.log(`[sync-by-work-item] ORCHESTRATOR: Executing via orchestrateSync() for ${workItem.workflow_type}`);

  const orchResult = await orchestrateSync(
    ctx,
    registry,
    supabase,
    supabaseUrl,
    `Bearer ${supabaseServiceKey}`,
    {
      skipEstados: true, // Estados handled by sync-publicaciones-by-work-item
      timeoutMs: 30_000,
      releaseGate: releaseGate ? {
        forceEmptyProvider: releaseGate.force_empty_provider,
        forceEmptyOnce: releaseGate.force_empty_once,
      } : undefined,
    },
  );

  console.log(`[sync-by-work-item] ORCHESTRATOR: status=${orchResult.status}, attempts=${orchResult.providerAttempts.length}, acts_raw=${orchResult.totalInsertedActs}`);

  // Extract legacy FetchResults from orchestrator attempts
  const allFetchResults: FetchResult[] = [];
  const allSources: string[] = [];
  const providerAttempts: ProviderAttempt[] = [];
  const warnings: string[] = [];
  let scrapingInitiated = false;
  let scrapingResult: FetchResult | null = null;

  for (const attempt of orchResult.providerAttempts) {
    const legacyResult = extractLegacyResult(attempt.metadata as Record<string, unknown>);

    providerAttempts.push({
      provider: attempt.provider.toLowerCase(),
      status: attempt.status === "success" ? "success"
        : attempt.status === "empty" ? "empty"
        : attempt.status === "not_found" ? "not_found"
        : attempt.status === "timeout" ? "timeout"
        : attempt.status === "skipped" ? "skipped"
        : "error",
      latencyMs: attempt.latency_ms,
      message: attempt.error_message || undefined,
      actuacionesCount: legacyResult?.actuaciones?.length || 0,
    });

    if (legacyResult) {
      if (legacyResult.ok && legacyResult.actuaciones.length > 0) {
        allFetchResults.push(legacyResult as unknown as FetchResult);
        allSources.push(legacyResult.provider);
      }

      if (legacyResult.scrapingInitiated && legacyResult.scrapingJobId) {
        scrapingInitiated = true;
        if (!scrapingResult) scrapingResult = legacyResult as unknown as FetchResult;
      }

      if (!legacyResult.ok && legacyResult.error) {
        warnings.push(`${legacyResult.provider}: ${legacyResult.error}`);
      }
    }
  }

  // Determine primary fetchResult for the ingestion pipeline
  let fetchResult: FetchResult | null = null;
  if (allFetchResults.length === 1) {
    fetchResult = allFetchResults[0];
  } else if (allFetchResults.length > 1) {
    // Multiple results (FANOUT) — pick the one with most actuaciones as primary
    // The full set is in allFetchResults for TUTELA multi-source merge
    fetchResult = allFetchResults.reduce((best, curr) =>
      curr.actuaciones.length > best.actuaciones.length ? curr : best
    );
  }

  const providerOrderReason = orchResult.providerAttempts.length > 0
    ? `orchestrator_${orchResult.status.toLowerCase()}_${allSources.join("+") || "none"}`
    : "orchestrator_no_attempts";

  return {
    fetchResult,
    allFetchResults,
    allSources,
    providerAttempts,
    providerOrderReason,
    warnings,
    scrapingInitiated,
    scrapingResult,
    syncRunId: orchResult.syncRunId,
    orchestratorStatus: orchResult.status,
  };
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check short-circuit
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: 'OK', function: 'sync-by-work-item' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch { /* not JSON, proceed normally */ }

  // Get trace ID from header or generate new one
  const traceId = req.headers.get('X-Trace-Id') || crypto.randomUUID();
  const syncStartTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500, traceId);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check — skip for scheduled/cron callers using service role
    const authHeader = req.headers.get('Authorization');
    
    // Parse request body first to check _scheduled flag
    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400, traceId);
    }

    const { work_item_id, _scheduled, release_gate } = payload;
    
    if (!work_item_id) {
      return errorResponse('MISSING_WORK_ITEM_ID', 'work_item_id is required', 400, traceId);
    }

    let userId: string;

    if (_scheduled) {
      // FIX 6.3: Scheduled callers (cron/fallback) use service role — skip user auth + membership
      // Validate that caller is using service role key (not anon)
      const callerToken = authHeader?.replace('Bearer ', '') || '';
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
      if (callerToken === anonKey) {
        return errorResponse('UNAUTHORIZED', 'Scheduled mode requires service role', 403, traceId);
      }
      userId = 'system-scheduled';
      console.log(`[sync-by-work-item] Scheduled mode: skipping auth + membership check for work_item_id=${work_item_id}`);
    } else {
      // Interactive callers: full auth + membership check
      if (!authHeader) {
        await logTrace(supabase, {
          trace_id: traceId,
          step: 'AUTHZ_FAILED',
          success: false,
          error_code: 'UNAUTHORIZED',
          message: 'Missing Authorization header',
        });
        return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401, traceId);
      }

      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '');
      
      const token = authHeader.replace('Bearer ', '');
      const { data: claims, error: authError } = await anonClient.auth.getClaims(token);
      
      if (authError || !claims?.claims?.sub) {
        await logTrace(supabase, {
          trace_id: traceId,
          step: 'AUTHZ_FAILED',
          success: false,
          error_code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        });
        return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401, traceId);
      }

      userId = claims.claims.sub as string;
    }

    // ── Guardrail: release_gate is platform-admin-only ──
    // Reject release_gate payload from non-platform-admins to prevent
    // test hooks from being used by unauthorized callers.
    let sanitizedReleaseGate = release_gate;
    if (release_gate && Object.keys(release_gate).length > 0) {
      if (_scheduled) {
        // Scheduled/service-role callers: allow (they're system-level)
        console.log(`[sync-by-work-item] release_gate accepted for scheduled caller`);
      } else {
        // Interactive callers: must be platform admin
        const { data: paCheck } = await supabase
          .from("platform_admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (!paCheck) {
          console.warn(`[sync-by-work-item] release_gate REJECTED: user ${userId.slice(0, 8)}… is not platform admin`);
          return errorResponse(
            'FORBIDDEN',
            'release_gate is restricted to platform administrators',
            403,
            traceId,
          );
        }
        console.log(`[sync-by-work-item] release_gate accepted for platform admin ${userId.slice(0, 8)}…`);
      }
    } else {
      sanitizedReleaseGate = undefined;
    }

    console.log(`[sync-by-work-item] Starting sync for work_item_id=${work_item_id}, user=${userId}, trace_id=${traceId}`);

    // Log sync start
    await logTrace(supabase, {
      trace_id: traceId,
      work_item_id,
      step: 'SYNC_START',
      success: true,
      message: `Starting sync for work_item_id=${work_item_id}`,
      meta: { user_id: userId.slice(0, 8) + '...', scheduled: !!_scheduled },
    });

    // Fetch work item
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, owner_id, organization_id, workflow_type, radicado, tutela_code, scrape_status, last_crawled_at, expediente_url, stage_inference_enabled, last_inference_date, authority_name, authority_city, authority_department')
      .eq('id', work_item_id)
      .maybeSingle();

    if (workItemError || !workItem) {
      console.log(`[sync-by-work-item] Work item not found: ${work_item_id}`);
      await logTrace(supabase, {
        trace_id: traceId,
        work_item_id,
        step: 'WORK_ITEM_NOT_FOUND',
        success: false,
        error_code: 'WORK_ITEM_NOT_FOUND',
        message: 'Work item not found or access denied',
      });
      return errorResponse('WORK_ITEM_NOT_FOUND', 'Work item not found or access denied', 404, traceId);
    }

    // Log work item loaded
    await logTrace(supabase, {
      trace_id: traceId,
      work_item_id,
      organization_id: workItem.organization_id,
      workflow_type: workItem.workflow_type,
      step: 'WORK_ITEM_LOADED',
      success: true,
      message: `Loaded work item: ${workItem.workflow_type}`,
      meta: {
        has_radicado: !!workItem.radicado,
        has_tutela_code: !!workItem.tutela_code,
        radicado_preview: workItem.radicado ? workItem.radicado.slice(0, 10) + '...' : null,
      },
    });

    // ============= MULTI-TENANT SECURITY: Verify user is member of org =============
    // FIX 6.3: Skip for scheduled callers (already verified by cron infrastructure)
    if (!_scheduled) {
      const { data: membership, error: membershipError } = await supabase
        .from('organization_memberships')
        .select('id, role')
        .eq('organization_id', workItem.organization_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (membershipError || !membership) {
        console.log(`[sync-by-work-item] ACCESS DENIED: User ${userId} is not member of org ${workItem.organization_id}`);
        return errorResponse(
          'ACCESS_DENIED', 
          'You do not have permission to sync this work item. You must be a member of the organization.', 
          403
        );
      }

      console.log(`[sync-by-work-item] Access verified: user ${userId} has role ${membership.role} in org ${workItem.organization_id}`);
    }

    // Determine provider order based on workflow_type
    const providerOrder = getProviderOrder(workItem.workflow_type);
    const useOrchestrator = await shouldUseOrchestrator(supabase, workItem.organization_id);
    console.log(`[sync-by-work-item] Workflow ${workItem.workflow_type}: primary=${providerOrder.primary}, fallback=${providerOrder.fallback || 'none'}, fallbackEnabled=${providerOrder.fallbackEnabled}, orchestrator=${useOrchestrator}`);

    const result: SyncResult = {
      ok: false,
      work_item_id,
      workflow_type: workItem.workflow_type,
      inserted_count: 0,
      skipped_count: 0,
      latest_event_date: null,
      provider_used: null,
      provider_attempts: [],
      provider_order_reason: `workflow_type=${workItem.workflow_type}`,
      warnings: [],
      errors: [],
    };

    // ============= RESOLVE IDENTIFIER BASED ON WORKFLOW =============
    let fetchResult: FetchResult | null = null;

    if (useOrchestrator) {
      // ============= ORCHESTRATOR PATH (Phase 2.5) =============
      // Delegate provider selection, sequencing, CHAIN/FANOUT, concurrency,
      // and per-attempt recording to the shared orchestrator.
      // Post-processing (ingestion, stage inference, alerts, etc.) remains inline.

      // Pre-validate identifiers (same as inline path)
      if (workItem.workflow_type === 'TUTELA') {
        const hasRadicado = workItem.radicado && isValidRadicado(workItem.radicado);
        const hasTutelaCode = workItem.tutela_code && isValidTutelaCode(workItem.tutela_code);
        if (!hasRadicado && !hasTutelaCode) {
          return errorResponse(
            'MISSING_IDENTIFIER',
            'TUTELA workflow requires a valid tutela_code (format: T + 6-10 digits, e.g., T11728622) or a 23-digit radicado. Please edit the work item to add one.',
            400
          );
        }
      } else if (!['PETICION', 'GOV_PROCEDURE'].includes(workItem.workflow_type)) {
        if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
          return errorResponse(
            'MISSING_RADICADO',
            'This workflow requires a valid radicado (23 digits). Please edit the work item to add it.',
            400
          );
        }
      }

      const orchExec = await executeViaOrchestrator(workItem, supabase, traceId, !!_scheduled, sanitizedReleaseGate);

      // Transfer orchestrator results into SyncResult
      result.provider_attempts = orchExec.providerAttempts;
      result.provider_order_reason = orchExec.providerOrderReason;
      result.warnings.push(...orchExec.warnings);
      fetchResult = orchExec.fetchResult;

      // Handle scraping-initiated case
      if (!fetchResult && orchExec.scrapingInitiated && orchExec.scrapingResult) {
        const sr = orchExec.scrapingResult;
        result.ok = false;
        result.provider_used = sr.provider;
        result.scraping_initiated = true;
        result.scraping_job_id = sr.scrapingJobId;
        result.scraping_poll_url = sr.scrapingPollUrl;
        result.scraping_provider = sr.provider;
        result.scraping_message = sr.scrapingMessage ||
          `Record not found in cache. Scraping initiated. Retry in 30-60 seconds.`;

        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'SCRAPING_INITIATED',
          provider: sr.provider,
          success: true,
          message: `Orchestrator: scraping initiated by ${sr.provider}`,
          meta: { job_id: sr.scrapingJobId, orchestrator: true },
        });

        await supabase
          .from('work_items')
          .update({
            scrape_status: 'IN_PROGRESS',
            scrape_provider: sr.provider,
            scrape_job_id: sr.scrapingJobId,
            last_scrape_initiated_at: new Date().toISOString(),
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', work_item_id);

        await enqueueScrapingRetry(supabase, {
          workItemId: work_item_id,
          organizationId: workItem.organization_id,
          radicado: workItem.radicado || '',
          workflowType: workItem.workflow_type,
          stage: (workItem as any).stage || null,
          provider: sr.provider,
          kind: 'ACT_SCRAPE_RETRY',
          scrapingJobId: sr.scrapingJobId,
          errorCode: 'SCRAPING_TIMEOUT',
          errorMessage: 'Orchestrator: scraping initiated, retry scheduled',
        });

        result.trace_id = traceId;
        result.code = 'SCRAPING_TIMEOUT_RETRY_SCHEDULED';
        return jsonResponse(result, 202);
      }

      // For TUTELA FANOUT with multiple sources, run smart consolidation
      if (workItem.workflow_type === 'TUTELA' && orchExec.allFetchResults.length > 1) {
        // Replicate existing TUTELA consolidation logic using orchestrator results
        const allActuaciones: ActuacionRaw[] = [];
        let bestMetadata: FetchResult['caseMetadata'] = {};
        let bestSujetos: FetchResult['sujetos'] = [];

        for (const provResult of orchExec.allFetchResults) {
          for (const act of provResult.actuaciones) {
            (act as any)._source = provResult.provider;
            allActuaciones.push(act);
          }
          if (provResult.caseMetadata) {
            bestMetadata = mergeTutelaMetadata(bestMetadata || {}, provResult.caseMetadata, provResult.provider);
          }
          if (provResult.sujetos && provResult.sujetos.length > (bestSujetos?.length || 0)) {
            bestSujetos = provResult.sujetos;
          }
        }

        // Run smart consolidation (same as inline TUTELA path)
        if (allActuaciones.length > 0 && orchExec.allSources.length > 1) {
          console.log(`[sync-by-work-item] ORCHESTRATOR TUTELA: Smart consolidation of ${allActuaciones.length} actuaciones from ${orchExec.allSources.join(', ')}`);

          const bySource = new Map<string, ActuacionRaw[]>();
          for (const act of allActuaciones) {
            const src = (act as any)._source || 'unknown';
            if (!bySource.has(src)) bySource.set(src, []);
            bySource.get(src)!.push(act);
          }

          const sortedSources = [...bySource.keys()].sort((a, b) => {
            const idxA = TUTELA_SOURCE_PRIORITY.indexOf(a);
            const idxB = TUTELA_SOURCE_PRIORITY.indexOf(b);
            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
          });

          const consolidated: ConsolidatedActuacion[] = [];
          for (const source of sortedSources) {
            const acts = bySource.get(source)!;
            for (const act of acts) {
              const match = findCrossProviderDuplicate(act, source, consolidated);
              if (match) {
                if (!match.sources.includes(source)) {
                  match.sources.push(source);
                }
              } else {
                consolidated.push({ best: act, sources: [source], crossProviderData: {} });
              }
            }
          }

          // Build merged fetchResult
          fetchResult = {
            ok: true,
            actuaciones: consolidated.map((c) => {
              const act = { ...c.best };
              if (c.sources.length > 1) {
                (act as any)._consolidated_sources = c.sources;
                (act as any)._cross_provider_data = c.crossProviderData;
              }
              return act;
            }),
            caseMetadata: bestMetadata,
            sujetos: bestSujetos,
            provider: orchExec.allSources.join('+'),
            latencyMs: 0,
            httpStatus: 200,
          };
          result.provider_order_reason = `orchestrator_fanout_consolidated: ${orchExec.allSources.join('+')}`;
        }
      }

      // Log orchestrator completion
      await logTrace(supabase, {
        trace_id: traceId,
        work_item_id,
        organization_id: workItem.organization_id,
        workflow_type: workItem.workflow_type,
        step: 'ORCHESTRATOR_COMPLETE',
        provider: fetchResult?.provider || 'none',
        success: !!fetchResult?.ok,
        message: `Orchestrator: ${orchExec.orchestratorStatus}, providers=${orchExec.allSources.join(',')}`,
        meta: {
          orchestrator_status: orchExec.orchestratorStatus,
          sync_run_id: orchExec.syncRunId,
          providers_with_data: orchExec.allSources,
          total_attempts: orchExec.providerAttempts.length,
        },
      });

    } else {
    // ============= LEGACY INLINE PATH =============
    // Original provider selection logic (preserved for rollback via USE_ORCHESTRATOR_SYNC=false)

    if (workItem.workflow_type === 'TUTELA') {
      // ============= TUTELA: PARALLEL MULTI-PROVIDER SYNC =============
      // A tutela can span CPNU, SAMAI, and Corte Constitucional (TUTELAS API).
      // Query ALL providers in parallel, merge and deduplicate results.
      
      const hasRadicado = workItem.radicado && isValidRadicado(workItem.radicado);
      const hasTutelaCode = workItem.tutela_code && isValidTutelaCode(workItem.tutela_code);
      
      if (!hasRadicado && !hasTutelaCode) {
        return errorResponse(
          'MISSING_IDENTIFIER',
          'TUTELA workflow requires a valid tutela_code (format: T + 6-10 digits, e.g., T11728622) or a 23-digit radicado. Please edit the work item to add one.',
          400
        );
      }
      
      const normalizedRadicado = hasRadicado ? normalizeRadicado(workItem.radicado!) : '';
      
      console.log(`[sync-by-work-item] TUTELA: Launching parallel providers. radicado=${hasRadicado ? normalizedRadicado : 'N/A'}, tutela_code=${hasTutelaCode ? workItem.tutela_code : 'N/A'}`);
      
      // Fire all available providers in parallel
      const providerPromises: Array<Promise<FetchResult>> = [];
      const providerLabels: string[] = [];
      
      if (hasRadicado) {
        providerPromises.push(fetchFromCpnu(normalizedRadicado));
        providerLabels.push('cpnu');
        providerPromises.push(fetchFromSamai(normalizedRadicado));
        providerLabels.push('samai');
      }
      if (hasTutelaCode) {
        // T-code available: use direct /expediente lookup
        providerPromises.push(fetchFromTutelasApi(workItem.tutela_code!, 'tutela_code'));
        providerLabels.push('tutelas');
      } else if (hasRadicado) {
        // No T-code: try TUTELAS with radicado-based /search
        providerPromises.push(fetchFromTutelasApi(normalizedRadicado, 'radicado'));
        providerLabels.push('tutelas');
      }
      
      const settledResults = await Promise.allSettled(providerPromises);
      
      // Collect all successful actuaciones and merge metadata
      const allActuaciones: ActuacionRaw[] = [];
      const allSources: string[] = [];
      let bestMetadata: FetchResult['caseMetadata'] = {};
      let bestSujetos: FetchResult['sujetos'] = [];
      let anyScrapingInitiated = false;
      let scrapingResult: FetchResult | null = null;
      
      for (let i = 0; i < settledResults.length; i++) {
        const settled = settledResults[i];
        const label = providerLabels[i];
        
        if (settled.status === 'rejected') {
          result.provider_attempts.push({
            provider: label,
            status: 'error',
            latencyMs: 0,
            message: settled.reason?.message || 'Promise rejected',
          });
          result.warnings.push(`${label}: Promise rejected`);
          continue;
        }
        
        const provResult = settled.value;
        
        result.provider_attempts.push({
          provider: label,
          status: provResult.ok ? 'success' : (provResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: provResult.latencyMs || 0,
          message: provResult.error,
          actuacionesCount: provResult.actuaciones.length,
        });
        
        // Track scraping-initiated providers
        if (provResult.scrapingInitiated && provResult.scrapingJobId) {
          anyScrapingInitiated = true;
          if (!scrapingResult) scrapingResult = provResult;
        }
        
        if (provResult.ok && provResult.actuaciones.length > 0) {
          // Tag each actuacion with its source
          for (const act of provResult.actuaciones) {
            (act as any)._source = label;
            allActuaciones.push(act);
          }
          allSources.push(label);
          
      // Merge metadata using "best available" strategy per spec §4.1
          if (provResult.caseMetadata) {
            bestMetadata = mergeTutelaMetadata(bestMetadata || {}, provResult.caseMetadata, label);
          }
          
          if (provResult.sujetos && provResult.sujetos.length > (bestSujetos?.length || 0)) {
            bestSujetos = provResult.sujetos;
          }
        } else if (!provResult.ok) {
          result.warnings.push(`${label}: ${provResult.error || 'Not found'}`);
        }
      }
      
      console.log(`[sync-by-work-item] TUTELA parallel results: ${allSources.length} providers with data, ${allActuaciones.length} total actuaciones`);
      
      // If NO providers returned data but scraping was initiated, return 202
      if (allActuaciones.length === 0 && anyScrapingInitiated && scrapingResult) {
        console.log(`[sync-by-work-item] TUTELA: No data yet, scraping initiated by ${scrapingResult.provider}`);
        
        result.ok = false;
        result.provider_used = scrapingResult.provider;
        result.scraping_initiated = true;
        result.scraping_job_id = scrapingResult.scrapingJobId;
        result.scraping_poll_url = scrapingResult.scrapingPollUrl;
        result.scraping_provider = scrapingResult.provider;
        result.scraping_message = scrapingResult.scrapingMessage || 
          `TUTELA data not found in cache. Scraping initiated. Retry in 30-60 seconds.`;
        
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'SCRAPING_INITIATED',
          provider: scrapingResult.provider,
          success: true,
          message: `Parallel TUTELA: scraping initiated by ${scrapingResult.provider}`,
          meta: { job_id: scrapingResult.scrapingJobId, sources_checked: providerLabels },
        });
        
        await supabase
          .from('work_items')
          .update({
            scrape_status: 'IN_PROGRESS',
            scrape_provider: scrapingResult.provider,
            scrape_job_id: scrapingResult.scrapingJobId,
            last_scrape_initiated_at: new Date().toISOString(),
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', work_item_id);
        
        // Enqueue delayed retry for TUTELA SCRAPING_TIMEOUT
        await enqueueScrapingRetry(supabase, {
          workItemId: work_item_id,
          organizationId: workItem.organization_id,
          radicado: workItem.radicado || '',
          workflowType: workItem.workflow_type,
          stage: (workItem as any).stage || null,
          provider: scrapingResult.provider === 'tutelas-api' ? 'tutelas' : (scrapingResult.provider || 'tutelas'),
          kind: 'ACT_SCRAPE_RETRY',
          scrapingJobId: scrapingResult.scrapingJobId,
          errorCode: 'SCRAPING_TIMEOUT',
          errorMessage: 'TUTELA scraping initiated, retry scheduled',
        });

        result.trace_id = traceId;
        result.provider_order_reason = 'tutela_parallel_scraping_initiated';
        result.code = 'SCRAPING_TIMEOUT_RETRY_SCHEDULED';
        return jsonResponse(result, 202);
      }
      
      // ============= SMART CONSOLIDATION: TWO-TIER CROSS-PROVIDER DEDUP =============
      if (allActuaciones.length > 0 && allSources.length > 1) {
        console.log(`[sync-by-work-item] TUTELA: Smart consolidation of ${allActuaciones.length} actuaciones from ${allSources.join(', ')}`);
        
        // Step 1: Group actuaciones by source, ordered by priority
        const bySource = new Map<string, ActuacionRaw[]>();
        for (const act of allActuaciones) {
          const src = (act as any)._source || 'unknown';
          if (!bySource.has(src)) bySource.set(src, []);
          bySource.get(src)!.push(act);
        }
        
        // Step 2: Process sources in priority order (CPNU first, then SAMAI, then TUTELAS)
        const sortedSources = [...bySource.keys()].sort((a, b) => {
          const idxA = TUTELA_SOURCE_PRIORITY.indexOf(a);
          const idxB = TUTELA_SOURCE_PRIORITY.indexOf(b);
          return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        });
        
        // Step 3: Build consolidated list — first source inserts all, subsequent sources dedup
        const consolidated: ConsolidatedActuacion[] = [];
        let skippedCrossProvider = 0;
        let enrichedCrossProvider = 0;
        
        for (const source of sortedSources) {
          const acts = bySource.get(source)!;
          
          for (const act of acts) {
            // For the first source, everything is new
            if (consolidated.length === 0 || source === sortedSources[0]) {
              // Check within same source (Tier 1 prefix dedup)
              const match = findCrossProviderDuplicate(act, source, consolidated);
              if (match) {
                // Same source, same event — shouldn't happen often but handle gracefully
                if (!match.sources.includes(source)) match.sources.push(source);
                skippedCrossProvider++;
              } else {
                consolidated.push({
                  best: act,
                  sources: [source],
                  crossProviderData: {},
                });
              }
              continue;
            }
            
            // Tier 2: Cross-provider fuzzy match
            const match = findCrossProviderDuplicate(act, source, consolidated);
            
            if (match) {
              // Cross-provider match found — enrich, don't insert
              if (!match.sources.includes(source)) {
                match.sources.push(source);
              }
              
              // If new provider has richer annotation, store as supplementary data
              const newAnnotationLen = (act.anotacion || '').length;
              const existingAnnotationLen = (match.best.anotacion || '').length;
              
              if (newAnnotationLen > existingAnnotationLen) {
                // Store richer annotation in crossProviderData (never overwrite primary)
                match.crossProviderData[`cross_provider_${source}`] = {
                  actuacion: act.actuacion,
                  anotacion: act.anotacion,
                  fecha_registro: act.fecha_registro,
                  indice: act.indice,
                };
                enrichedCrossProvider++;
              } else {
                // Still preserve the cross-provider raw payload
                match.crossProviderData[`cross_provider_${source}`] = {
                  actuacion: act.actuacion,
                  anotacion: act.anotacion,
                };
              }
              
              skippedCrossProvider++;
            } else {
              // Genuinely new record from this provider
              consolidated.push({
                best: act,
                sources: [source],
                crossProviderData: {},
              });
            }
          }
        }
        
        console.log(`[sync-by-work-item] TUTELA: Smart consolidation: ${allActuaciones.length} → ${consolidated.length} unique (skipped=${skippedCrossProvider}, enriched=${enrichedCrossProvider})`);
        
        // Build merged fetchResult with cross-provider data embedded in raw_data
        fetchResult = {
          ok: true,
          actuaciones: consolidated.map(g => {
            // Embed cross-provider data and source tracking into the actuacion's raw data
            const enrichedAct = { ...g.best };
            // Store sources and cross-provider data for the insert loop to use
            (enrichedAct as any)._consolidated_sources = g.sources;
            (enrichedAct as any)._cross_provider_data = Object.keys(g.crossProviderData).length > 0
              ? g.crossProviderData : undefined;
            return enrichedAct;
          }),
          caseMetadata: bestMetadata,
          sujetos: bestSujetos,
          provider: allSources.join('+'),
          latencyMs: Math.max(...result.provider_attempts.map(a => a.latencyMs)),
          httpStatus: 200,
        };
        result.provider_order_reason = `tutela_parallel_merged: ${allSources.join('+')}`;
        result.provider_used = allSources.join('+');
        
        // Log multi-source trace
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'MULTI_SOURCE_MERGE',
          provider: allSources.join('+'),
          success: true,
          message: `Smart consolidation: ${allActuaciones.length} → ${consolidated.length} unique from ${allSources.join(', ')}`,
          meta: {
            sources: allSources,
            raw_count: allActuaciones.length,
            deduped_count: consolidated.length,
            skipped_cross_provider: skippedCrossProvider,
            enriched_cross_provider: enrichedCrossProvider,
            multi_source_count: consolidated.filter(g => g.sources.length > 1).length,
          },
        });
      } else if (allActuaciones.length > 0) {
        // Single source with data
        const winnerIdx = settledResults.findIndex((s, i) => 
          s.status === 'fulfilled' && s.value.ok && s.value.actuaciones.length > 0
        );
        if (winnerIdx >= 0) {
          fetchResult = (settledResults[winnerIdx] as PromiseFulfilledResult<FetchResult>).value;
          result.provider_order_reason = `tutela_parallel_single: ${fetchResult.provider}`;
        }
      }
      
      // ============= TUTELA T-CODE EXTRACTION =============
      // If we don't have a tutela_code yet, try to extract it from CPNU/SAMAI actuaciones
      if (!workItem.tutela_code && fetchResult && fetchResult.actuaciones.length > 0) {
        const extractedCode = extractTutelaCodeFromActuaciones(fetchResult.actuaciones);
        if (extractedCode) {
          console.log(`[sync-by-work-item] TUTELA: Extracted tutela_code="${extractedCode}" from actuaciones`);
          // Save to caseMetadata so it gets persisted in the metadata update section
          if (fetchResult.caseMetadata) {
            (fetchResult.caseMetadata as any).tutela_code = extractedCode;
          }
        }
      }
      // If no actuaciones at all and no scraping, fetchResult stays null → handled by existing failure logic below
      
    } else if (workItem.workflow_type === 'PENAL_906') {
      // ============= PENAL_906: Use CPNU (Publicaciones handled by separate function) =============
      // NOTE: Publicaciones sync is now handled by sync-publicaciones-by-work-item.
      // This function syncs actuaciones from CPNU.
      // The UI should call both sync-by-work-item AND sync-publicaciones-by-work-item for PENAL_906.
      
      if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
        return errorResponse(
          'MISSING_RADICADO',
          'PENAL_906 workflow requires a valid radicado (23 digits). Please edit the work item to add it.',
          400
        );
      }
      
      const normalizedRadicado = normalizeRadicado(workItem.radicado);
      console.log(`[sync-by-work-item] PENAL_906: Calling CPNU for actuaciones (radicado=${normalizedRadicado})`);
      console.log(`[sync-by-work-item] Note: Publicaciones sync is handled by sync-publicaciones-by-work-item`);
      
      // Fetch from CPNU for actuaciones
      fetchResult = await fetchFromCpnu(normalizedRadicado);
      
      result.provider_attempts.push({
        provider: 'cpnu',
        status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
        latencyMs: fetchResult.latencyMs || 0,
        message: fetchResult.error,
        actuacionesCount: fetchResult.actuaciones.length,
      });
      
      result.provider_order_reason = 'penal_906_cpnu_actuaciones';
      result.warnings.push('Para publicaciones, use sync-publicaciones-by-work-item');
      
    } else {
      // CGP/LABORAL/CPACA: require radicado (23 digits)
      if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
        return errorResponse(
          'MISSING_RADICADO',
          'This workflow requires a valid radicado (23 digits). Please edit the work item to add it.',
          400
        );
      }
      
      const normalizedRadicado = normalizeRadicado(workItem.radicado);
      console.log(`[sync-by-work-item] Radicado workflow (${workItem.workflow_type}): using radicado=${normalizedRadicado}, provider_order=${providerOrder.primary}→${providerOrder.fallback || 'none'}`);
      
      // ============= WORKFLOW-AWARE PROVIDER SELECTION =============
      if (providerOrder.primary === 'samai') {
        // CPACA: SAMAI primary
        console.log(`[sync-by-work-item] CPACA: Calling SAMAI as primary provider`);
        
        // Log PROVIDER_REQUEST trace step with request path (no host/secrets)
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'PROVIDER_REQUEST_START',
          provider: 'samai',
          success: true,
          message: `SAMAI request: /proceso/${normalizedRadicado}`,
          meta: { 
            request_path: `/proceso/${normalizedRadicado}`,
            request_method: 'GET',
            is_primary: true,
          },
        });
        
        fetchResult = await fetchFromSamai(normalizedRadicado);
        
        // Log PROVIDER_RESPONSE trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'PROVIDER_RESPONSE_RECEIVED',
          provider: 'samai',
          http_status: fetchResult.httpStatus || (fetchResult.ok ? 200 : 404),
          latency_ms: fetchResult.latencyMs || 0,
          success: fetchResult.ok,
          error_code: fetchResult.ok ? null : (fetchResult.isEmpty ? 'PROVIDER_404' : 'PROVIDER_ERROR'),
          message: fetchResult.error || (fetchResult.ok ? `Found ${fetchResult.actuaciones.length} actuaciones` : 'Not found'),
          meta: { 
            actuaciones_count: fetchResult.actuaciones.length,
            is_empty: fetchResult.isEmpty || false,
            request_path: `/proceso/${normalizedRadicado}`,
          },
        });
        
        result.provider_attempts.push({
          provider: 'samai',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        // ============= CHECK IF SCRAPING WAS AUTO-INITIATED BY SAMAI =============
        // If scraping was initiated, DO NOT attempt CPNU fallback - return 202 immediately
        if (fetchResult.scrapingInitiated && fetchResult.scrapingJobId) {
          console.log(`[sync-by-work-item] SAMAI: Auto-scraping initiated, skipping CPNU fallback`);
          
          result.ok = false;
          result.provider_used = 'samai';
          result.scraping_initiated = true;
          result.scraping_job_id = fetchResult.scrapingJobId;
          result.scraping_poll_url = fetchResult.scrapingPollUrl;
          result.scraping_provider = 'samai';
          result.scraping_message = fetchResult.scrapingMessage || 
            `Record not found in SAMAI cache. Scraping initiated (job ${fetchResult.scrapingJobId}). Retry sync in 30-60 seconds.`;
          
          // Log SCRAPING_INITIATED trace step
          await logTrace(supabase, {
            trace_id: traceId,
            work_item_id,
            organization_id: workItem.organization_id,
            workflow_type: workItem.workflow_type,
            step: 'SCRAPING_INITIATED',
            provider: 'samai',
            http_status: null,
            latency_ms: fetchResult.latencyMs || null,
            success: true,
            error_code: null,
            message: `Scraping job created: ${fetchResult.scrapingJobId}`,
            meta: {
              job_id: fetchResult.scrapingJobId,
              poll_url: fetchResult.scrapingPollUrl,
              radicado_preview: workItem.radicado?.slice(0, 10) + '...',
            },
          });
          
          // Update work_item with SCRAPING status and metadata
          await supabase
            .from('work_items')
            .update({
              scrape_status: 'IN_PROGRESS',
              scrape_provider: 'samai',
              scrape_job_id: fetchResult.scrapingJobId,
              scrape_poll_url: fetchResult.scrapingPollUrl,
              last_scrape_initiated_at: new Date().toISOString(),
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', work_item_id);
          
          // Enqueue delayed retry for SAMAI SCRAPING_TIMEOUT
          await enqueueScrapingRetry(supabase, {
            workItemId: work_item_id,
            organizationId: workItem.organization_id,
            radicado: workItem.radicado || '',
            workflowType: workItem.workflow_type,
            stage: (workItem as any).stage || null,
            provider: 'samai',
            kind: 'ACT_SCRAPE_RETRY',
            scrapingJobId: fetchResult.scrapingJobId,
            errorCode: 'SCRAPING_TIMEOUT',
            errorMessage: 'SAMAI scraping initiated, retry scheduled',
          });

          result.trace_id = traceId;
          result.code = 'SCRAPING_TIMEOUT_RETRY_SCHEDULED';
          return jsonResponse(result, 202);
        }
        
        // CPNU fallback for CPACA (only if explicitly enabled and NO scraping was initiated)
        if (!fetchResult.ok && providerOrder.fallbackEnabled && providerOrder.fallback === 'cpnu') {
          console.log(`[sync-by-work-item] SAMAI failed/empty (no scraping), trying CPNU fallback`);
          result.warnings.push(`SAMAI (primary): ${fetchResult.error}`);
          
          const cpnuResult = await fetchFromCpnu(normalizedRadicado);
          
          result.provider_attempts.push({
            provider: 'cpnu',
            status: cpnuResult.ok ? 'success' : (cpnuResult.isEmpty ? 'not_found' : 'error'),
            latencyMs: cpnuResult.latencyMs || 0,
            message: cpnuResult.error,
            actuacionesCount: cpnuResult.actuaciones.length,
          });
          
          if (cpnuResult.ok) {
            fetchResult = cpnuResult;
            result.provider_order_reason = 'cpaca_samai_failed_cpnu_fallback';
          } else {
            result.warnings.push(`CPNU fallback: ${cpnuResult.error}`);
          }
        } else if (!fetchResult.ok && !providerOrder.fallbackEnabled && !fetchResult.scrapingInitiated) {
          // Log that CPNU fallback is disabled for CPACA (only if no scraping was triggered)
          result.provider_attempts.push({
            provider: 'cpnu',
            status: 'skipped',
            latencyMs: 0,
            message: 'CPNU fallback disabled for CPACA workflow',
          });
        }
        
      } else {
        // ============= CGP/LABORAL: CPNU PRIMARY, NO FALLBACK TO SAMAI =============
        // Civil, labor, and family processes in CPNU are NOT in SAMAI
        // Attempting SAMAI fallback is technically useless and generates noise
        console.log(`[sync-by-work-item] ${workItem.workflow_type}: Calling CPNU as PRIMARY provider (NO SAMAI fallback)`);
        
        // Log PROVIDER_REQUEST trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'PROVIDER_REQUEST_START',
          provider: 'cpnu',
          success: true,
          message: `CPNU request: /snapshot?numero_radicacion=${normalizedRadicado}`,
          meta: { 
            request_path: `/snapshot?numero_radicacion=${normalizedRadicado}`,
            request_method: 'GET',
            is_primary: true,
            fallback_enabled: false, // Explicitly NO fallback for CGP/LABORAL
          },
        });
        
        fetchResult = await fetchFromCpnu(normalizedRadicado);
        
        // Log PROVIDER_RESPONSE trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'PROVIDER_RESPONSE_RECEIVED',
          provider: 'cpnu',
          http_status: fetchResult.httpStatus || (fetchResult.ok ? 200 : 404),
          latency_ms: fetchResult.latencyMs || 0,
          success: fetchResult.ok,
          error_code: fetchResult.ok ? null : (fetchResult.isEmpty ? 'PROVIDER_404' : 'PROVIDER_ERROR'),
          message: fetchResult.error || (fetchResult.ok ? `Found ${fetchResult.actuaciones.length} actuaciones` : 'Not found'),
          meta: { 
            actuaciones_count: fetchResult.actuaciones.length,
            is_empty: fetchResult.isEmpty || false,
            request_path: `/snapshot?numero_radicacion=${normalizedRadicado}`,
          },
        });
        
        result.provider_attempts.push({
          provider: 'cpnu',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        // ============= CHECK IF SCRAPING WAS AUTO-INITIATED BY CPNU =============
        // If scraping was initiated, return 202 immediately (NO fallback)
        if (fetchResult.scrapingInitiated && fetchResult.scrapingJobId) {
          console.log(`[sync-by-work-item] CPNU: Auto-scraping initiated. Returning 202 (NO SAMAI fallback for ${workItem.workflow_type})`);
          
          result.ok = false;
          result.provider_used = 'cpnu';
          result.scraping_initiated = true;
          result.scraping_job_id = fetchResult.scrapingJobId;
          result.scraping_poll_url = fetchResult.scrapingPollUrl;
          result.scraping_provider = 'cpnu';
          result.scraping_message = fetchResult.scrapingMessage || 
            `Record not found in CPNU cache. Scraping initiated (job ${fetchResult.scrapingJobId}). Retry sync in 30-60 seconds.`;
          
          // Log SCRAPING_INITIATED trace step
          await logTrace(supabase, {
            trace_id: traceId,
            work_item_id,
            organization_id: workItem.organization_id,
            workflow_type: workItem.workflow_type,
            step: 'SCRAPING_INITIATED',
            provider: 'cpnu',
            http_status: null,
            latency_ms: fetchResult.latencyMs || null,
            success: true,
            error_code: null,
            message: `Scraping job created: ${fetchResult.scrapingJobId}`,
            meta: {
              job_id: fetchResult.scrapingJobId,
              poll_url: fetchResult.scrapingPollUrl,
              radicado_preview: workItem.radicado?.slice(0, 10) + '...',
              workflow_type: workItem.workflow_type,
              fallback_attempted: false, // Explicit: NO SAMAI fallback
            },
          });
          
          // Update work_item with SCRAPING status and metadata
          await supabase
            .from('work_items')
            .update({
              scrape_status: 'IN_PROGRESS',
              scrape_provider: 'cpnu',
              scrape_job_id: fetchResult.scrapingJobId,
              scrape_poll_url: fetchResult.scrapingPollUrl,
              last_scrape_initiated_at: new Date().toISOString(),
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', work_item_id);
          
          // Enqueue delayed retry for SCRAPING_TIMEOUT
          await enqueueScrapingRetry(supabase, {
            workItemId: work_item_id,
            organizationId: workItem.organization_id,
            radicado: workItem.radicado || '',
            workflowType: workItem.workflow_type,
            stage: (workItem as any).stage || null,
            provider: 'cpnu',
            kind: 'ACT_SCRAPE_RETRY',
            scrapingJobId: fetchResult.scrapingJobId,
            errorCode: 'SCRAPING_TIMEOUT',
            errorMessage: fetchResult.scrapingMessage || 'Scraping initiated, retry scheduled',
          });

          result.trace_id = traceId;
          result.code = 'SCRAPING_TIMEOUT_RETRY_SCHEDULED';
          return jsonResponse(result, 202);
        }
        
        // ============= CGP/LABORAL: NO SAMAI FALLBACK =============
        // If CPNU fails with an error (not 404/scraping), return 502 immediately
        if (!fetchResult.ok && !fetchResult.scrapingInitiated) {
          // Check if it's an empty result (404) vs actual error
          if (fetchResult.isEmpty) {
            // 404 without scraping initiated - this shouldn't happen normally
            // (auto-scraping should have triggered), but handle gracefully
            console.log(`[sync-by-work-item] CPNU: Record not found (NO SAMAI fallback for ${workItem.workflow_type})`);
            result.warnings.push(`CPNU: ${fetchResult.error || 'Not found'}`);
            // Log that SAMAI fallback is NOT attempted
            result.provider_attempts.push({
              provider: 'samai',
              status: 'skipped',
              latencyMs: 0,
              message: `SAMAI fallback disabled for ${workItem.workflow_type} - civil/labor processes are NOT in SAMAI`,
            });
          } else {
            // Actual CPNU error (timeout, 5xx, network error)
            console.error(`[sync-by-work-item] ❌ CPNU failed for ${workItem.workflow_type} (NO SAMAI fallback)`, {
              work_item_id,
              workflow_type: workItem.workflow_type,
              radicado: workItem.radicado?.slice(0, 10) + '...',
              error_message: fetchResult.error,
              http_status: fetchResult.httpStatus,
            });
            
            // Log SYNC_FAILED with explicit no-fallback note
            await logTrace(supabase, {
              trace_id: traceId,
              work_item_id,
              organization_id: workItem.organization_id,
              workflow_type: workItem.workflow_type,
              step: 'SYNC_FAILED',
              provider: 'cpnu',
              http_status: fetchResult.httpStatus || null,
              latency_ms: fetchResult.latencyMs || null,
              success: false,
              error_code: 'CPNU_SYNC_FAILED',
              message: `CPNU failed: ${fetchResult.error}. NO fallback configured for ${workItem.workflow_type}.`,
              meta: {
                radicado_preview: workItem.radicado?.slice(0, 10) + '...',
                fallback_attempted: false,
                reason: 'CGP/LABORAL workflows use CPNU only - SAMAI does not have civil/labor cases',
              },
            });
            
            // Update work_item status to FAILED
            await supabase
              .from('work_items')
              .update({
                scrape_status: 'FAILED',
                last_checked_at: new Date().toISOString(),
              })
              .eq('id', work_item_id);
            
            // Return 502 with clear error message
            return jsonResponse({
              ok: false,
              code: 'CPNU_SYNC_FAILED',
              message: `CPNU provider failed and no fallback is configured for ${workItem.workflow_type}. Error: ${fetchResult.error}`,
              provider: 'cpnu',
              provider_attempts: result.provider_attempts,
              work_item_id,
              workflow_type: workItem.workflow_type,
              trace_id: traceId,
            }, 502);
          }
        }
      }
    }
    } // end else (legacy inline path)

    // Handle fetch failure - with enhanced diagnostics and auto-scraping
    if (!fetchResult || !fetchResult.ok) {
      const errorCode = fetchResult?.isEmpty ? 'PROVIDER_NOT_FOUND' : 'PROVIDER_ERROR';
      const providerUsed = fetchResult?.provider || providerOrder.primary;
      
      result.errors.push(fetchResult?.error || 'All providers failed to fetch data');
      result.code = errorCode;
      result.provider_used = providerUsed;
      
      // ============= CHECK IF SCRAPING WAS AUTO-INITIATED =============
      if (fetchResult?.scrapingInitiated && fetchResult.scrapingJobId) {
        console.log(`[sync-by-work-item] Auto-scraping initiated: jobId=${fetchResult.scrapingJobId}`);
        
        // Populate scraping fields in result
        result.scraping_initiated = true;
        result.scraping_job_id = fetchResult.scrapingJobId;
        result.scraping_poll_url = fetchResult.scrapingPollUrl;
        result.scraping_provider = providerUsed;
        result.scraping_message = fetchResult.scrapingMessage || 
          `Record not found in cache. Scraping initiated (job ${fetchResult.scrapingJobId}). Retry sync in 30-60 seconds.`;
        
        // Log SCRAPING_INITIATED trace step
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'SCRAPING_INITIATED',
          provider: providerUsed,
          http_status: null,
          latency_ms: null,
          success: true,
          error_code: null,
          message: `Scraping job created: ${fetchResult.scrapingJobId}`,
          meta: {
            job_id: fetchResult.scrapingJobId,
            poll_url: fetchResult.scrapingPollUrl,
            radicado_preview: workItem.radicado?.slice(0, 10) + '...',
          },
        });
        
        // Update work_item with SCRAPING status and metadata
        await supabase
          .from('work_items')
          .update({
            scrape_status: 'IN_PROGRESS',
            scrape_provider: providerUsed,
            scrape_job_id: fetchResult.scrapingJobId,
            scrape_poll_url: fetchResult.scrapingPollUrl,
            last_scrape_initiated_at: new Date().toISOString(),
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', work_item_id);
        
        // Enqueue delayed retry for SCRAPING_TIMEOUT (generic path)
        await enqueueScrapingRetry(supabase, {
          workItemId: work_item_id,
          organizationId: workItem.organization_id,
          radicado: workItem.radicado || '',
          workflowType: workItem.workflow_type,
          stage: (workItem as any).stage || null,
          provider: providerUsed,
          kind: 'ACT_SCRAPE_RETRY',
          scrapingJobId: fetchResult.scrapingJobId,
          errorCode: 'SCRAPING_TIMEOUT',
          errorMessage: fetchResult.scrapingMessage || 'Scraping initiated, retry scheduled',
        });

        // Return with scraping info - use 202 Accepted to indicate async processing
        result.ok = false; // Still "failed" to get data, but scraping is happening
        result.trace_id = traceId;
        result.code = 'SCRAPING_TIMEOUT_RETRY_SCHEDULED';
        return jsonResponse(result, 202);
      }
      
      // Log SYNC_FAILED trace step with diagnostics (no scraping)
      await logTrace(supabase, {
        trace_id: traceId,
        work_item_id,
        organization_id: workItem.organization_id,
        workflow_type: workItem.workflow_type,
        step: 'SYNC_FAILED',
        provider: providerUsed,
        http_status: fetchResult?.httpStatus || null,
        latency_ms: fetchResult?.latencyMs || null,
        success: false,
        error_code: errorCode,
        message: `${providerUsed.toUpperCase()}: ${fetchResult?.error || 'Provider failed'}`,
        meta: {
          radicado_preview: workItem.radicado?.slice(0, 10) + '...',
          provider_attempts: result.provider_attempts.length,
          request_path: `/snapshot?numero_radicacion=${normalizeRadicado(workItem.radicado || '')}`,
        },
      });
      
      // Update scrape status to FAILED + track consecutive failures & 404s
      // CRITICAL: Only increment consecutive_404_count on strict 404-type signals.
      // SCRAPING_TIMEOUT, empty cache, and rate limits must NOT inflate this counter,
      // as it drives auto-demonitoring decisions.
      const classifiedErrorCode = classifyProviderError(fetchResult, errorCode);
      const STRICT_404_CODES = ['PROVIDER_404', 'RECORD_NOT_FOUND', 'PROVIDER_NOT_FOUND', 'UPSTREAM_ROUTE_MISSING', 'PROVIDER_ROUTE_NOT_FOUND'];
      const isStrict404 = STRICT_404_CODES.includes(classifiedErrorCode) || errorCode === 'PROVIDER_NOT_FOUND';
      
      // Fetch current counters for increment
      const { data: currentItem } = await supabase
        .from('work_items')
        .select('consecutive_404_count, consecutive_failures')
        .eq('id', work_item_id)
        .single();
      
      const update404Payload: Record<string, unknown> = {
        scrape_status: 'FAILED',
        last_checked_at: new Date().toISOString(),
        last_error_code: classifiedErrorCode,
        last_error_at: new Date().toISOString(),
        consecutive_failures: ((currentItem as any)?.consecutive_failures || 0) + 1,
      };
      if (isStrict404) {
        update404Payload.consecutive_404_count = ((currentItem as any)?.consecutive_404_count || 0) + 1;
        update404Payload.provider_reachable = false;
      }
      await supabase
        .from('work_items')
        .update(update404Payload)
        .eq('id', work_item_id);
      
      result.trace_id = traceId;
      return jsonResponse(result);
    }

    result.provider_used = fetchResult.provider;
    console.log(`[sync-by-work-item] Provider ${fetchResult.provider} returned ${fetchResult.actuaciones.length} actuaciones`);

    // Handle empty actuaciones — settled empty, NOT success.
    // Provider responded correctly but returned zero records.
    // This is non-transient (no retry needed) and non-404 (no demonitor).
    if (fetchResult.actuaciones.length === 0) {
      result.ok = false;
      result.code = 'PROVIDER_EMPTY_RESULT';
      result.warnings.push('Provider returned valid response with zero actuaciones');
      
      // Fetch current consecutive_failures for increment
      const { data: currentItemEmpty } = await supabase
        .from('work_items')
        .select('consecutive_failures')
        .eq('id', work_item_id)
        .single();
      
      await supabase
        .from('work_items')
        .update({
          scrape_status: 'EMPTY',
          last_crawled_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
          // Clear transient error codes so UI badge resets (no "retry scheduled" spinner)
          last_error_code: 'PROVIDER_EMPTY_RESULT',
          // Increment consecutive_failures to surface patterns, but NOT consecutive_404_count
          consecutive_failures: ((currentItemEmpty as any)?.consecutive_failures || 0) + 1,
          provider_reachable: true,
        })
        .eq('id', work_item_id);
      
      // Log trace for forensics
      await logTrace(supabase, {
        trace_id: traceId,
        work_item_id,
        organization_id: workItem.organization_id,
        workflow_type: workItem.workflow_type,
        step: 'SYNC_EMPTY',
        provider: fetchResult.provider,
        http_status: fetchResult.httpStatus || 200,
        latency_ms: fetchResult.latencyMs || null,
        success: false,
        error_code: 'PROVIDER_EMPTY_RESULT',
        message: `Provider ${fetchResult.provider} returned valid response with 0 actuaciones`,
        meta: { radicado_preview: workItem.radicado?.slice(0, 10) + '...' },
      });
      
      result.trace_id = traceId;
      return jsonResponse(result);
    }

    // ============= INGEST ACTUACIONES WITH DEDUPLICATION =============
    // FIX: Calculate latestDate from ALL fetched data, not just inserted rows
    // This ensures latest_event_date reflects the provider's actual newest event
    let latestDate: string | null = null;
    const attemptedFingerprints: string[] = []; // Track fingerprints for post-insert verification

    // ============= SEMANTIC DEDUP: Load existing (date+description) pairs ONCE =============
    // This prevents SAMAI duplicates where the same court event produces slightly different
    // annotation text across scraping runs, resulting in different fingerprints.
    const { data: existingActsForDedup } = await supabase
      .from('work_item_acts')
      .select('act_date, description')
      .eq('work_item_id', work_item_id)
      .eq('is_archived', false);

    const existingSemanticSet = new Set(
      (existingActsForDedup || []).map(a => {
        // Extract just the actuacion part (before " - " annotation separator)
        const descOnly = (a.description || '').split(' - ')[0].toUpperCase().trim();
        return `${a.act_date || ''}|${descOnly}`;
      })
    );
    console.log(`[sync-by-work-item] Loaded ${existingSemanticSet.size} existing (date+desc) pairs for semantic dedup`);

    for (const act of fetchResult.actuaciones) {
      const actDate = parseColombianDate(act.fecha);
      
      // IMPORTANT: Track latest date from ALL fetched actuaciones (for metadata update)
      // This happens BEFORE deduplication so we report the true latest event date
      if (actDate && (!latestDate || actDate > latestDate)) {
        latestDate = actDate;
      }
      
      // Include indice in fingerprint to prevent collisions for same-day actuaciones
      // FIX 1.2: Include provider source in fingerprint to prevent cross-provider collisions
      // For consolidated TUTELA records, use the actual source of the "best" record
      const actSourceForFingerprint = (act as any)._source || fetchResult.provider;
      // FANOUT/TUTELA: exclude source from fingerprint for cross-provider dedup
      const isFanoutWorkflow = workItem.workflow_type === 'TUTELA';
      const fingerprint = generateFingerprint(work_item_id, act.fecha, act.actuacion, act.indice, actSourceForFingerprint, isFanoutWorkflow);

      // Check for existing record using fingerprint (fast, indexed)
      const { data: existing } = await supabase
        .from('work_item_acts')
        .select('id')
        .eq('work_item_id', work_item_id)
        .eq('hash_fingerprint', fingerprint)
        .maybeSingle();

      if (existing) {
        result.skipped_count++;
        continue;
      }

      // ============= SEMANTIC DEDUP: Check date + normalized description =============
      // Catches SAMAI variants where annotation text differs slightly
      const semanticKey = `${actDate || ''}|${(act.actuacion || '').toUpperCase().trim()}`;
      if (existingSemanticSet.has(semanticKey)) {
        console.log(`[sync-by-work-item] SEMANTIC DEDUP: Skipping "${act.actuacion}" on ${actDate} (already exists with different fingerprint)`);
        result.skipped_count++;
        continue;
      }
      // Add to set to prevent intra-batch duplicates too
      existingSemanticSet.add(semanticKey);

      // Build description from actuacion + anotacion
      const description = `${act.actuacion}${act.anotacion ? ' - ' + act.anotacion : ''}`;
      const eventSummary = description.slice(0, 500);
      
      // BUG FIX: Insert into 'work_item_acts' (canonical table) instead of legacy 'actuaciones'
      // The UI reads from work_item_acts, not actuaciones
      // FIX 2.2: Derive date_confidence from date_source
      const dateSource = actDate ? 'api_explicit' : 'inferred_sync';
      const dateConfidenceMap: Record<string, string> = {
        api_explicit: 'high',
        parsed_filename: 'medium',
        parsed_annotation: 'medium',
        parsed_title: 'medium',
        inferred_sync: 'low',
      };
      const dateConfidence = dateConfidenceMap[dateSource] || 'low';

      // FIX 2.3: Set raw_schema_version for future data migrations
      // For consolidated multi-source records, use the actual source of the "best" actuacion
      const actSource = (act as any)._source || fetchResult.provider;
      const rawSchemaVersion = actSource === 'cpnu' ? 'cpnu_v2' : 
                                actSource === 'samai' ? 'samai_2026_02' : 
                                `${actSource}_v1`;

      // Build raw_data with cross-provider enrichment (TUTELA smart consolidation)
      const rawDataPayload: Record<string, unknown> = {
        actuacion: act.actuacion,
        anotacion: act.anotacion,
        fecha_registro: act.fecha_registro,
        estado: act.estado,
        anexos: act.anexos,
        indice: act.indice,
        documentos: act.documentos,
      };
      
      // Embed cross-provider data if this is a consolidated TUTELA record
      const consolidatedSources = (act as any)._consolidated_sources as string[] | undefined;
      const crossProviderData = (act as any)._cross_provider_data as Record<string, unknown> | undefined;
      if (consolidatedSources && consolidatedSources.length > 1) {
        rawDataPayload._sources = consolidatedSources;
      }
      if (crossProviderData) {
        Object.assign(rawDataPayload, crossProviderData);
      }

      // Determine source_platform from the actual source of the best record
      const sourcePlatformMap: Record<string, string> = {
        'cpnu': 'CPNU', 'samai': 'SAMAI', 'tutelas': 'TUTELAS', 'tutelas-api': 'TUTELAS',
      };

      // ── Upsert via RPC with explicit sources[] array merge ──
      // Uses ON CONFLICT (work_item_id, hash_fingerprint) DO UPDATE SET sources = array_union(...)
      // This ensures cross-provider provenance is additively preserved.
      const { data: rpcResult, error: insertError } = await supabase.rpc('rpc_upsert_work_item_acts', {
        records: JSON.stringify([{
          owner_id: workItem.owner_id,
          organization_id: workItem.organization_id,
          work_item_id,
          workflow_type: workItem.workflow_type,
          description: description,
          act_date: actDate,
          act_date_raw: act.fecha,
          event_date: actDate,
          event_summary: eventSummary,
          source: actSource,
          source_platform: sourcePlatformMap[actSource] || actSource,
          sources: consolidatedSources && consolidatedSources.length > 1 ? consolidatedSources : [actSource],
          hash_fingerprint: fingerprint,
          scrape_date: new Date().toISOString().split('T')[0],
          despacho: fetchResult.caseMetadata?.despacho || act.nombre_despacho || null,
          date_source: dateSource,
          date_confidence: dateConfidence,
          raw_schema_version: rawSchemaVersion,
          raw_data: rawDataPayload,
        }]),
      });

      if (insertError) {
        console.error(`[sync-by-work-item] RPC upsert error:`, insertError);
        result.errors.push(`Failed to upsert actuacion: ${insertError.message}`);
      } else {
        const counts = rpcResult as { inserted_count: number; updated_count: number; skipped_count: number; errors: string[] };
        if (counts.inserted_count > 0) {
          result.inserted_count++;
          attemptedFingerprints.push(fingerprint);
        } else if (counts.updated_count > 0) {
          // Provenance was merged (sources[] updated) — count as "updated" not "inserted"
          result.skipped_count++;
          console.log(`[sync-by-work-item] ♻️ Provenance merged for existing act (fingerprint: ${fingerprint.slice(0,12)}...)`);
        } else {
          result.skipped_count++;
        }
        if (counts.errors && counts.errors.length > 0) {
          result.errors.push(...counts.errors);
        }
        // Note: latestDate is now calculated from ALL fetched actuaciones (before insert loop)
        // to ensure we report the true latest event even for deduped records
        
        // ============= DETECT SIGNIFICANT EVENTS & CREATE ALERTS =============
        const significantEvent = detectSignificantEvent(act.actuacion, act.anotacion || '');
        if (significantEvent) {
          // Use the event type in the fingerprint (not the whole object)
          const alertFingerprint = `alert_${work_item_id.slice(0, 8)}_${significantEvent.type}_${actDate || 'no-date'}`;
          
          // Check for existing alert with same fingerprint
          const { data: existingAlert } = await supabase
            .from('alert_instances')
            .select('id')
            .eq('entity_id', work_item_id)
            .eq('fingerprint', alertFingerprint)
            .maybeSingle();
          
          if (!existingAlert) {
            const { error: alertError } = await supabase
              .from('alert_instances')
              .insert({
                owner_id: workItem.owner_id,
                organization_id: workItem.organization_id,
                entity_id: work_item_id,
                entity_type: 'WORK_ITEM',
                severity: significantEvent.severity,
                title: significantEvent.title,
                message: `${act.actuacion}${act.anotacion ? ' - ' + act.anotacion : ''}`.slice(0, 500),
                status: 'PENDING', // Must be: PENDING, SENT, ACKNOWLEDGED, RESOLVED, CANCELLED, DISMISSED
                fingerprint: alertFingerprint,
                payload: {
                  event_type: significantEvent.type,
                  event_date: actDate,
                  provider: fetchResult.provider,
                },
              });
            
            if (alertError) {
              console.warn(`[sync-by-work-item] Failed to create alert for ${significantEvent.type}:`, alertError.message);
            } else {
              console.log(`[sync-by-work-item] Created alert for ${significantEvent.type}`);
            }
          }
        }
        
        // ============= STAGE INFERENCE (with daily rate limiting) =============
        // CRITICAL: Never auto-apply stages. All suggestions require explicit user approval.
        
        // Check if inference is enabled for this work item
        if (workItem.stage_inference_enabled === false) {
          console.log(`[sync-by-work-item] Stage inference disabled for work item ${work_item_id}`);
        } else {
          // Check daily rate limit (once per work item per day)
          const { data: rateLimitCheck } = await supabase
            .rpc('check_inference_rate_limit', { 
              p_work_item_id: work_item_id,
              p_timezone: 'America/Bogota'
            });
          
          const canRunInference = rateLimitCheck?.can_run === true;
          
          if (!canRunInference) {
            console.log(`[sync-by-work-item] Inference rate limit reached for work item ${work_item_id} (last run: ${rateLimitCheck?.last_run_date})`);
          } else {
            const stageSuggestion = inferStageFromActuacion(
              workItem.workflow_type,
              act.actuacion,
              act.anotacion || ''
            );
            
            if (stageSuggestion && stageSuggestion.confidence >= 0.7) {
              const suggestionFingerprint = `stage_${work_item_id.slice(0, 8)}_${stageSuggestion.suggestedStage}_${new Date().toISOString().split('T')[0]}`;
              
              // Check for existing pending suggestion
              const { data: existingSuggestion } = await supabase
                .from('work_item_stage_suggestions')
                .select('id')
                .eq('work_item_id', work_item_id)
                .eq('status', 'PENDING')
                .maybeSingle();
              
              if (!existingSuggestion) {
                // ALL suggestions are created as PENDING - never auto-apply
                const { error: suggestionError } = await supabase
                  .from('work_item_stage_suggestions')
                  .insert({
                    work_item_id,
                    owner_id: workItem.owner_id,
                    organization_id: workItem.organization_id,
                    suggested_stage: stageSuggestion.suggestedStage,
                    confidence: stageSuggestion.confidence,
                    reason: stageSuggestion.reason,
                    source_type: 'ACTUACION',
                    event_fingerprint: suggestionFingerprint,
                    status: 'PENDING', // ALWAYS PENDING - requires explicit user approval
                  });
                
                if (suggestionError) {
                  console.warn(`[sync-by-work-item] Failed to create stage suggestion:`, suggestionError.message);
                } else {
                  console.log(`[sync-by-work-item] Created PENDING stage suggestion: ${stageSuggestion.suggestedStage} (confidence: ${stageSuggestion.confidence}) - requires user approval`);
                  
                  // Record inference run to enforce daily rate limit
                  await supabase.rpc('record_inference_run', {
                    p_work_item_id: work_item_id,
                    p_timezone: 'America/Bogota'
                  });
                }
              }
            }
          }
        }
      }
    }

    result.latest_event_date = latestDate;

    // ============= UPDATE WORK ITEM METADATA =============
    // Strategy: ALWAYS UPDATE work_item with latest provider data (overwrite)
    // This ensures metadata stays fresh on each sync
    // ── Layer 2A: Sync Integrity Check ──
    // Build provider results map for integrity validation
    const integrityProviderResults: Record<string, { called: boolean; statusCode: number; recordsReceived: number; recordsUpserted: number; status: string; error?: string }> = {};
    for (const attempt of result.provider_attempts) {
      integrityProviderResults[attempt.provider] = {
        called: true,
        statusCode: attempt.status === 'success' ? 200 : (attempt.status === 'timeout' ? 0 : 500),
        recordsReceived: attempt.actuacionesCount || 0,
        recordsUpserted: result.inserted_count, // approximation for primary provider
        status: attempt.status === 'success' ? 'SUCCESS' : (attempt.status === 'empty' ? 'EMPTY' : (attempt.status === 'timeout' ? 'TIMEOUT' : 'ERROR')),
        error: attempt.message || undefined,
      };
    }

    // Validate sync integrity before setting last_synced_at
    const anyProviderSucceeded = result.provider_attempts.some(a => a.status === 'success' || a.status === 'empty');
    const allProvidersFailed = result.provider_attempts.length > 0 && result.provider_attempts.every(a => a.status === 'error' || a.status === 'timeout');

    const syncOk = anyProviderSucceeded && !allProvidersFailed;
    const nowIso = new Date().toISOString();

    if (!syncOk) {
      console.warn(`[SYNC_INTEGRITY_FAIL] ALL_PROVIDERS_FAILED for work_item ${work_item_id}. last_synced_at will NOT advance.`, {
        providers: result.provider_attempts.map(a => ({ provider: a.provider, status: a.status })),
        correlationId: traceId,
      });
    }

    const updatePayload: Record<string, unknown> = {
      scrape_status: allProvidersFailed ? 'FAILED' : (result.errors.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS'),
      last_crawled_at: nowIso,
      last_checked_at: nowIso,
      last_attempted_sync_at: nowIso, // ALWAYS update attempt timestamp
      // CRITICAL INVARIANT: last_synced_at only advances on actual success
      ...(syncOk ? { last_synced_at: nowIso } : {}),
      total_actuaciones: fetchResult.actuaciones.length,
      scrape_provider: fetchResult.provider,
      // Reset failure counters only on success
      ...(syncOk ? {
        consecutive_404_count: 0,
        consecutive_failures: 0,
        last_error_code: null,
        provider_reachable: true,
      } : {
        provider_reachable: false,
        last_error_code: result.code || 'ALL_PROVIDERS_FAILED',
      }),
    };

    if (latestDate) {
      updatePayload.last_action_date = latestDate;
    }

    // Update expediente_url if returned and not already set
    if (fetchResult.expedienteUrl && !workItem.expediente_url) {
      updatePayload.expediente_url = fetchResult.expedienteUrl;
    }

    // ============= EXTRACT SUJETOS PROCESALES (demandantes/demandados) =============
    // Uses canonicalizeRole from shared partyNormalization module
    if (fetchResult.sujetos && fetchResult.sujetos.length > 0) {
      const demandantes = fetchResult.sujetos
        .filter(s => canonicalizeRole(s.tipo) === 'DEMANDANTE')
        .map(s => s.nombre)
        .filter(Boolean)
        .join(' | ');
      
      const demandados = fetchResult.sujetos
        .filter(s => canonicalizeRole(s.tipo) === 'DEMANDADO')
        .map(s => s.nombre)
        .filter(Boolean)
        .join(' | ');
      
      const ministerioPublico = fetchResult.sujetos
        .filter(s => s.tipo.toLowerCase().includes('ministerio'))
        .map(s => s.nombre)
        .filter(Boolean)
        .join(' | ');

      if (demandantes) updatePayload.demandantes = demandantes;
      if (demandados) updatePayload.demandados = demandados;
      if (ministerioPublico) updatePayload.ministerio_publico = ministerioPublico;
      updatePayload.total_sujetos_procesales = fetchResult.sujetos.length;
      
      console.log(`[sync-by-work-item] Extracted ${fetchResult.sujetos.length} sujetos procesales from response`);
    } else if (fetchResult.caseMetadata?.total_sujetos && fetchResult.caseMetadata.total_sujetos > 0) {
      // Fallback: use total_sujetos from caseMetadata if sujetos array not available
      updatePayload.total_sujetos_procesales = fetchResult.caseMetadata.total_sujetos;
      console.log(`[sync-by-work-item] Using total_sujetos from caseMetadata: ${fetchResult.caseMetadata.total_sujetos}`);
    }

    // ============= UPDATE ALL CASE METADATA FROM PROVIDER =============
    if (fetchResult.caseMetadata) {
      const meta = fetchResult.caseMetadata;
      
      // Basic metadata (always update)
      if (meta.despacho) updatePayload.authority_name = meta.despacho;
      // Only set demandantes/demandados from caseMetadata if not already set from sujetos
      if (meta.demandante && !updatePayload.demandantes) updatePayload.demandantes = meta.demandante;
      if (meta.demandado && !updatePayload.demandados) updatePayload.demandados = meta.demandado;
      
      // SAMAI-specific metadata (update if present)
      if (meta.origen) updatePayload.origen = meta.origen;
      if (meta.ponente) updatePayload.ponente = meta.ponente;
      if (meta.clase_proceso) updatePayload.clase_proceso = meta.clase_proceso;
      if (meta.etapa) updatePayload.etapa = meta.etapa;
      if (meta.ubicacion) updatePayload.ubicacion_expediente = meta.ubicacion;
      if (meta.formato_expediente) updatePayload.formato_expediente = meta.formato_expediente;
      if (meta.tipo_proceso) updatePayload.tipo_proceso = meta.tipo_proceso;
      if (meta.subclase) updatePayload.subclase_proceso = meta.subclase;
      if (meta.recurso) updatePayload.tipo_recurso = meta.recurso;
      if (meta.naturaleza) updatePayload.naturaleza_proceso = meta.naturaleza;
      if (meta.asunto) updatePayload.asunto = meta.asunto;
      if (meta.medida_cautelar) updatePayload.medida_cautelar = meta.medida_cautelar;
      if (meta.ministerio_publico && !updatePayload.ministerio_publico) {
        updatePayload.ministerio_publico = meta.ministerio_publico;
      }
      
      // New SAMAI fields - Salas and tracking info
      if (meta.sala_conoce) updatePayload.samai_sala_conoce = meta.sala_conoce;
      if (meta.sala_decide) updatePayload.samai_sala_decide = meta.sala_decide;
      if (meta.veces_en_corporacion) updatePayload.samai_veces_en_corporacion = meta.veces_en_corporacion;
      if (meta.guid) updatePayload.samai_guid = meta.guid;
      if (meta.consultado_en) updatePayload.samai_consultado_en = meta.consultado_en;
      if (meta.fuente) updatePayload.samai_fuente = meta.fuente;
      
      // Parse and update important dates
      if (meta.fecha_radicado) {
        const parsedDate = parseColombianDate(meta.fecha_radicado);
        if (parsedDate) updatePayload.fecha_radicado = parsedDate;
      }
      if (meta.fecha_presenta_demanda) {
        const parsedDate = parseColombianDate(meta.fecha_presenta_demanda);
        if (parsedDate) updatePayload.fecha_presenta_demanda = parsedDate;
      }
      if (meta.fecha_para_sentencia) {
        const parsedDate = parseColombianDate(meta.fecha_para_sentencia);
        if (parsedDate) updatePayload.fecha_para_sentencia = parsedDate;
      }
      // fecha_sentencia can be text like "SIN SENTENCIA" or a date
      if (meta.fecha_sentencia) {
      updatePayload.fecha_sentencia = meta.fecha_sentencia;
      }

      // TUTELA-specific metadata columns
      if (meta.corte_status) updatePayload.corte_status = meta.corte_status;
      if (meta.sentencia_ref) updatePayload.sentencia_ref = meta.sentencia_ref;
      if (meta.tutela_code && !workItem.tutela_code) updatePayload.tutela_code = meta.tutela_code;
    }

    // ============= PROVIDER SOURCES TRACKING (TUTELA) =============
    if (workItem.workflow_type === 'TUTELA' && result.provider_attempts.length > 0) {
      const providerSources: Record<string, Record<string, unknown>> = {};
      const syncTime = new Date().toISOString();
      
      for (const attempt of result.provider_attempts) {
        providerSources[attempt.provider] = {
          found: attempt.status === 'success',
          last_sync: syncTime,
          ...(attempt.actuacionesCount != null ? { actuaciones_count: attempt.actuacionesCount } : {}),
          ...(attempt.message && attempt.status !== 'success' ? { error: attempt.message } : {}),
        };
      }
      
      // If TUTELAS returned corte_status, include it in provider_sources
      const meta = fetchResult.caseMetadata || {};
      if (meta.corte_status && (providerSources['tutelas'] || providerSources['tutelas-api'])) {
        const tutelaSources = (providerSources['tutelas'] || providerSources['tutelas-api']) as Record<string, unknown>;
        tutelaSources.corte_status = meta.corte_status;
      }
      
      updatePayload.provider_sources = providerSources;
    }

    await supabase
      .from('work_items')
      .update(updatePayload)
      .eq('id', work_item_id);

    // Set initial sync completion marker (idempotent: only on first successful sync)
    try {
      await supabase
        .from('work_items')
        .update({ acts_initial_sync_completed_at: new Date().toISOString() } as any)
        .eq('id', work_item_id)
        .is('acts_initial_sync_completed_at' as any, null);
    } catch {
      // best-effort: marker setting should never break sync
      console.warn('[sync-by-work-item] Failed to set acts_initial_sync_completed_at marker');
    }

    // ============= PUBLICACIONES SYNC =============
    // NOTE: Publicaciones sync is now handled entirely by sync-publicaciones-by-work-item.
    // This edge function (sync-by-work-item) focuses only on actuaciones from CPNU/SAMAI/TUTELAS.
    // The UI should call sync-publicaciones-by-work-item separately for deadline tracking.
    if (['CGP', 'LABORAL'].includes(workItem.workflow_type) && workItem.radicado) {
      console.log(`[sync-by-work-item] ${workItem.workflow_type}: Publicaciones sync is handled by sync-publicaciones-by-work-item (call separately)`);
    }

    // ============= CASCADE: COURTHOUSE EMAIL RESOLUTION =============
    // If new despacho data arrived from the provider and differs from what we had,
    // trigger courthouse email resolution to auto-resolve/update the email.
    const newDespacho = fetchResult.caseMetadata?.despacho;
    const previousDespacho = workItem.authority_name;
    
    if (newDespacho && newDespacho !== previousDespacho) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        
        console.log(`[sync-by-work-item] Despacho changed ("${previousDespacho}" → "${newDespacho}"), triggering courthouse resolution`);
        
        // Update raw_courthouse_input with new data
        await supabase
          .from('work_items')
          .update({
            raw_courthouse_input: {
              name: newDespacho,
              city: fetchResult.caseMetadata?.ciudad || workItem.authority_city || '',
              department: fetchResult.caseMetadata?.departamento || workItem.authority_department || '',
              source: 'sync-by-work-item',
            },
          } as any)
          .eq('id', work_item_id);

        // Invoke resolver (non-blocking)
        const resolveResponse = await fetch(
          `${supabaseUrl}/functions/v1/resolve-courthouse-email`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              work_item_id: work_item_id,
              courthouse_name: newDespacho,
              city: fetchResult.caseMetadata?.ciudad || workItem.authority_city || '',
              department: fetchResult.caseMetadata?.departamento || workItem.authority_department || '',
            }),
          }
        );
        const resolveResult = await resolveResponse.json();
        console.log(`[sync-by-work-item] Courthouse resolution:`, {
          ok: resolveResult.ok,
          method: resolveResult.method,
          needs_review: resolveResult.needs_review,
        });
      } catch (resolveErr) {
        // Non-blocking — courthouse resolution failure shouldn't block sync
        console.warn(`[sync-by-work-item] Courthouse resolution failed (non-blocking):`, resolveErr);
      }
    }

    // ============= EXTERNAL PROVIDER ENRICHMENT (data_kind-aware subchains) =============
    // After built-in sync completes, resolve external provider routes and execute
    // TWO independent subchains: one for ACTUACIONES, one for ESTADOS.
    // Routes with scope=BOTH are called in both subchains.
    // Compatibility gating prevents incompatible providers from being called.
    //
    // Spec:
    //   - data_kind=ACTUACIONES: procedural actions (fed by CPNU, SAMAI, etc.)
    //   - data_kind=ESTADOS: procedural status/publications (fed by SAMAI_ESTADOS, Publicaciones, etc.)
    //   - Primary mapping: CGP→CPNU(acts)/Publicaciones(estados), CPACA→SAMAI(acts)/SAMAI_ESTADOS(estados)
    //   - Fallback providers are merged if non-duplicate; provenance always preserved
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const adminDb = createClient(supabaseUrl, supabaseServiceKey);

      // Import coverage matrix for compatibility gating
      const { isProviderCompatible, routeScopeToDataKinds } = await import("../_shared/providerCoverageMatrix.ts");

      // Query global routes for this workflow
      const { data: globalRoutes } = await adminDb
        .from('provider_category_routes_global')
        .select('id, workflow, scope, route_kind, priority, provider_connector_id, enabled, is_authoritative, provider_connectors(id, name, key)')
        .eq('workflow', workItem.workflow_type)
        .eq('enabled', true)
        .order('priority');

      // Query org override routes
      const { data: orgRoutes } = await adminDb
        .from('provider_category_routes_org_override')
        .select('id, workflow, scope, route_kind, priority, provider_connector_id, enabled, is_authoritative, provider_connectors(id, name, key)')
        .eq('organization_id', workItem.organization_id)
        .eq('workflow', workItem.workflow_type)
        .eq('enabled', true)
        .order('priority');

      // Use org overrides if available, otherwise global
      const activeRoutes = (orgRoutes && orgRoutes.length > 0) ? orgRoutes : (globalRoutes || []);

      if (activeRoutes.length > 0) {
        console.log(`[sync-by-work-item] External provider enrichment: ${activeRoutes.length} route(s) for ${workItem.workflow_type}`);

        // ── Execute subchains by data_kind ──
        const DATA_KINDS = ["ACTUACIONES", "ESTADOS"] as const;
        for (const dataKind of DATA_KINDS) {
          // Filter routes applicable to this data_kind
          const scopeFilter = dataKind === "ACTUACIONES" ? "ACTS" : "PUBS";
          const applicableRoutes = activeRoutes.filter((route: any) => {
            const routeScope = route.scope || "BOTH";
            return routeScope === scopeFilter || routeScope === "BOTH";
          });

          if (applicableRoutes.length === 0) continue;

          console.log(`[sync-by-work-item] Subchain ${dataKind}: ${applicableRoutes.length} route(s)`);

          for (let routeIdx = 0; routeIdx < applicableRoutes.length; routeIdx++) {
            const route = applicableRoutes[routeIdx];
            const connectorId = route.provider_connector_id;
            const connectorInfo = (route as any).provider_connectors;
            const connectorName = connectorInfo?.name || connectorId?.slice(0, 8);
            const connectorKey = connectorInfo?.key || connectorName;
            const providerOrder = routeIdx;
            const providerOrderReason = route.route_kind === "PRIMARY"
              ? `PRIMARY (priority=${route.priority})`
              : `FALLBACK (priority=${route.priority})`;

            // ── Compatibility gate ──
            const compat = isProviderCompatible(connectorKey, workItem.workflow_type, dataKind);
            if (!compat.compatible) {
              console.log(`[sync-by-work-item] SKIP ${connectorName} for ${dataKind}: ${compat.reason}`);
              await logTrace(supabase, {
                trace_id: traceId,
                work_item_id,
                organization_id: workItem.organization_id,
                workflow_type: workItem.workflow_type,
                step: 'EXTERNAL_PROVIDER_COMPAT_SKIP',
                provider: connectorName,
                success: false,
                error_code: 'INCOMPATIBLE_PROVIDER',
                message: compat.reason,
                meta: {
                  connector_id: connectorId,
                  connector_key: connectorKey,
                  subchain_kind: dataKind,
                  data_kind: dataKind,
                  route_kind: route.route_kind,
                  route_scope: route.scope,
                  route_scope_effective: dataKind,
                  provider_order: providerOrder,
                  provider_order_reason: providerOrderReason,
                },
              });
              continue;
            }

            // Resolve instance: PLATFORM scope for global, ORG scope for org override
            const isOrgRoute = orgRoutes && orgRoutes.length > 0;
            let instanceQuery = adminDb
              .from('provider_instances')
              .select('id, name, base_url')
              .eq('connector_id', connectorId)
              .eq('is_enabled', true);

            if (isOrgRoute) {
              instanceQuery = instanceQuery.eq('organization_id', workItem.organization_id);
            } else {
              instanceQuery = instanceQuery.is('organization_id', null);
            }

            const { data: instances } = await instanceQuery.order('created_at', { ascending: false }).limit(1);
            const instance = instances?.[0];

            if (!instance) {
              console.warn(`[sync-by-work-item] SKIP external provider ${connectorName} (${dataKind}): no active instance (${isOrgRoute ? 'ORG' : 'PLATFORM'})`);
              result.warnings.push(`External provider ${connectorName} (${dataKind}): MISSING_INSTANCE`);

              await logTrace(supabase, {
                trace_id: traceId,
                work_item_id,
                organization_id: workItem.organization_id,
                workflow_type: workItem.workflow_type,
                step: 'EXTERNAL_PROVIDER_SKIP',
                provider: connectorName,
                success: false,
                error_code: isOrgRoute ? 'MISSING_ORG_INSTANCE' : 'MISSING_PLATFORM_INSTANCE',
                message: `No enabled ${isOrgRoute ? 'ORG' : 'PLATFORM'} instance for connector ${connectorName}`,
                meta: {
                  connector_id: connectorId,
                  subchain_kind: dataKind,
                  route_kind: route.route_kind,
                  data_kind: dataKind,
                  route_scope_effective: dataKind,
                  provider_order: providerOrder,
                  provider_order_reason: providerOrderReason,
                },
              });
              continue;
            }

            // Ensure work_item_sources entry exists for this provider
            const { data: existingSource } = await adminDb
              .from('work_item_sources')
              .select('id')
              .eq('work_item_id', work_item_id)
              .eq('provider_instance_id', instance.id)
              .maybeSingle();

            let sourceId = existingSource?.id;
            if (!sourceId) {
              // Auto-create source binding
              const { data: newSource, error: sourceErr } = await adminDb
                .from('work_item_sources')
                .insert({
                  work_item_id,
                  provider_instance_id: instance.id,
                  organization_id: workItem.organization_id,
                  provider_case_id: workItem.radicado || work_item_id,
                  source_input_type: 'RADICADO',
                  source_input_value: workItem.radicado || work_item_id,
                  scrape_status: 'SCRAPING_PENDING',
                })
                .select('id')
                .single();
              if (sourceErr) {
                console.warn(`[sync-by-work-item] Source creation error for ${connectorName} (${dataKind}): ${sourceErr.message}`);
              }
              sourceId = newSource?.id;
            }

            if (!sourceId) {
              console.warn(`[sync-by-work-item] Could not create source for ${connectorName} (${dataKind})`);
              continue;
            }

            // Call provider-sync-external-provider (non-blocking best effort)
            try {
              console.log(`[sync-by-work-item] Calling external provider ${connectorName} for ${dataKind} (instance: ${instance.name}, role: ${route.route_kind})`);
              const extStart = Date.now();

              const extResp = await fetch(
                `${supabaseUrl}/functions/v1/provider-sync-external-provider`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    work_item_source_id: sourceId,
                    work_item_id,
                    provider_instance_id: instance.id,
                  }),
                }
              );
              const extData = await extResp.json().catch(() => ({}));
              const extLatency = Date.now() - extStart;

              const reportedDataKind = extData.data_kind || dataKind.toLowerCase();
              const insertedCount = extData[`inserted_${reportedDataKind}`] || extData.inserted_actuaciones || extData.inserted_estados || 0;

              result.provider_attempts.push({
                provider: `ext:${connectorName}`,
                status: extData.ok ? 'success' : (extData.empty ? 'empty' : 'error'),
                latencyMs: extLatency,
                message: extData.error || (extData.ok ? `External sync OK (${dataKind})` : undefined),
                actuacionesCount: insertedCount,
              });

              if (extData.ok && insertedCount > 0) {
                result.inserted_count += insertedCount;
                result.warnings.push(`External ${connectorName}: +${insertedCount} ${dataKind}`);
              }

              await logTrace(supabase, {
                trace_id: traceId,
                work_item_id,
                organization_id: workItem.organization_id,
                workflow_type: workItem.workflow_type,
                step: 'EXTERNAL_PROVIDER_SYNC',
                provider: connectorName,
                http_status: extResp.status,
                latency_ms: extLatency,
                success: !!extData.ok,
                error_code: extData.code || null,
                message: extData.ok
                  ? `External ${connectorName} (${dataKind}): inserted=${insertedCount}`
                  : `External ${connectorName} (${dataKind}): ${extData.error || 'failed'}`,
                meta: {
                  connector_id: connectorId,
                  connector_key: connectorKey,
                  instance_id: instance.id,
                  source_id: sourceId,
                  subchain_kind: dataKind,
                  route_kind: route.route_kind,
                  data_kind: dataKind,
                  route_scope: route.scope,
                  route_scope_effective: dataKind,
                  provider_order: providerOrder,
                  provider_order_reason: providerOrderReason,
                  dedupe_result: {
                    inserted: insertedCount,
                    provenance_written: extData.provenance_upserted || 0,
                    provenance_from_dedup: extData.provenance_from_dedup || 0,
                    acts_confirmed: extData.acts_confirmed || 0,
                  },
                },
              });
            } catch (extErr: any) {
              console.warn(`[sync-by-work-item] External provider ${connectorName} (${dataKind}) failed (non-blocking):`, extErr?.message);
              result.provider_attempts.push({
                provider: `ext:${connectorName}`,
                status: 'error',
                latencyMs: 0,
                message: extErr?.message || 'Invocation failed',
              });
            }
          }
        }
      }
    } catch (extEnrichErr: any) {
      // External provider enrichment should never block the main sync
      console.warn(`[sync-by-work-item] External provider enrichment failed (non-blocking):`, extEnrichErr?.message);
      result.warnings.push(`External provider enrichment error: ${extEnrichErr?.message}`);
    }

    result.ok = true;

    // ── LAYER 2: POST-INSERT VERIFICATION ──
    // Detect silent trigger failures that roll back inserts without errors
    if (result.inserted_count > 0 && attemptedFingerprints.length > 0) {
      try {
        const { data: persistedRows, error: verifyErr } = await supabase
          .from('work_item_acts')
          .select('hash_fingerprint')
          .eq('work_item_id', work_item_id)
          .in('hash_fingerprint', attemptedFingerprints);

        if (!verifyErr && persistedRows) {
          const persistedSet = new Set(persistedRows.map((r: any) => r.hash_fingerprint));
          const missingFps = attemptedFingerprints.filter(fp => !persistedSet.has(fp));

          if (missingFps.length > 0) {
            const msg = `[DATA_LOSS_DETECTED] ${missingFps.length}/${attemptedFingerprints.length} act inserts did NOT persist for ${work_item_id} (likely trigger bug)`;
            console.error(msg);
            result.warnings.push(msg);
            result.inserted_count = persistedSet.size; // correct the count

            // Write trace for forensics
            try {
              await logTrace(supabase, {
                trace_id: traceId,
                work_item_id,
                organization_id: workItem.organization_id,
                workflow_type: workItem.workflow_type,
                step: 'DATA_LOSS_DETECTED',
                success: false,
                error_code: 'TRIGGER_SILENT_FAILURE',
                message: msg,
                meta: {
                  attempted: attemptedFingerprints.length,
                  persisted: persistedSet.size,
                  missing_fingerprints: missingFps.slice(0, 10),
                },
              });
            } catch { /* trace is best-effort */ }

            // Write to trigger_error_log for watchdog visibility
            try {
              await supabase.from('trigger_error_log').insert({
                trigger_name: 'POST_INSERT_VERIFY',
                table_name: 'work_item_acts',
                error_message: `${missingFps.length} inserts silently failed for work_item ${work_item_id}`,
                work_item_id,
              });
            } catch { /* best-effort */ }
          } else {
            console.log(`[VERIFY_OK] All ${attemptedFingerprints.length} act inserts verified persisted`);
          }
        }
      } catch (verifyError: any) {
        console.warn(`[VERIFY_INSERTS] Verification query failed: ${verifyError?.message}`);
      }
    }

    // ── STRUCTURED SYNC LOG ──
    const syncDurationMs = Date.now() - syncStartTime;
    const isDebugOrg = workItem.organization_id === 'a0000000-0000-0000-0000-000000000001';
    const syncLog = {
      correlationId: traceId,
      workItemId: work_item_id,
      category: workItem.workflow_type,
      radicado: workItem.radicado || workItem.tutela_code || 'N/A',
      orgId: workItem.organization_id,
      trigger: _scheduled ? 'scheduled' : 'manual',
      providersSelected: result.provider_attempts.map((a: ProviderAttempt) => a.provider),
      providerResults: Object.fromEntries(
        result.provider_attempts.map((a: ProviderAttempt) => [a.provider, {
          called: true,
          durationMs: a.latencyMs,
          status: a.status,
          recordsUpserted: a.actuacionesCount || 0,
          error: a.message || undefined,
        }])
      ),
      totalActsUpserted: result.inserted_count,
      totalActsSkipped: result.skipped_count,
      status: result.errors.length > 0 ? 'PARTIAL' : 'SUCCESS',
      durationMs: syncDurationMs,
      orchestrator: useOrchestrator,
    };
    console.log(`[SYNC_LOG] ${JSON.stringify(syncLog)}`);

    // Debug mode: write detailed trace for super admin org
    if (isDebugOrg) {
      try {
        await logTrace(supabase, {
          trace_id: traceId,
          work_item_id,
          organization_id: workItem.organization_id,
          workflow_type: workItem.workflow_type,
          step: 'SYNC_LOG_DEBUG',
          success: true,
          message: `SyncLog: ${result.inserted_count} inserted, ${result.skipped_count} skipped, ${syncDurationMs}ms`,
          meta: syncLog,
        });
      } catch { /* debug trace is best-effort */ }
    }

    // ── Record external_sync_run (best-effort, non-blocking) ──
    // Skip if orchestrator already recorded (USE_ORCHESTRATOR_SYNC=true)
    if (!useOrchestrator) {
      try {
        const invokedBy = _scheduled ? 'CRON' : 'MANUAL';
        await supabase.from('external_sync_runs').insert({
          work_item_id,
          organization_id: workItem.organization_id,
          invoked_by: invokedBy,
          trigger_source: 'sync-by-work-item',
          started_at: new Date(syncStartTime).toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - syncStartTime,
          status: result.ok ? (result.errors.length > 0 ? 'PARTIAL' : 'SUCCESS') : 'FAILED',
          provider_attempts: result.provider_attempts.map((a: any) => ({
            provider: a.provider,
            data_kind: 'ACTUACIONES',
            status: a.status,
            latency_ms: a.latencyMs || 0,
            error_code: a.message?.includes('error') ? 'PROVIDER_ERROR' : null,
            inserted_count: a.actuacionesCount || 0,
            skipped_count: 0,
          })),
          total_inserted_acts: result.inserted_count,
          total_skipped_acts: result.skipped_count,
          error_code: result.code || null,
          error_message: result.errors.length > 0 ? result.errors.join('; ').slice(0, 500) : null,
        });
      } catch { /* sync run recording is best-effort */ }
    }

    return jsonResponse(result);

  } catch (err: any) {
    // Enhanced error classification for better diagnostics
    const errorDetail = {
      name: err?.name || 'UnknownError',
      message: (err?.message || 'No message').substring(0, 500),
      httpStatus: err?.status || err?.statusCode || null,
      responsePreview: null as string | null,
      isTimeout: err?.name === 'AbortError' || err?.message?.includes('timeout'),
      isNetworkError: err?.message?.includes('fetch') || err?.message?.includes('network'),
    };

    // Try to get response body preview if available
    if (err?.response) {
      try {
        const bodyText = typeof err.response === 'string'
          ? err.response
          : await err.response.text?.();
        errorDetail.responsePreview = bodyText?.substring(0, 200) || null;
      } catch { /* ignore */ }
    }

    const errorCode = errorDetail.isTimeout ? 'PROVIDER_TIMEOUT'
      : errorDetail.isNetworkError ? 'NETWORK_ERROR'
      : errorDetail.httpStatus === 503 ? 'PROVIDER_UNAVAILABLE'
      : errorDetail.httpStatus === 429 ? 'PROVIDER_RATE_LIMITED'
      : 'INTERNAL_ERROR';

    console.error(`[sync-by-work-item] Unhandled error (${errorCode}):`, errorDetail.message);

    // Log enhanced trace if we have context
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseServiceKey) {
        const supabaseForTrace = createClient(supabaseUrl, supabaseServiceKey);
        await logTrace(supabaseForTrace, {
          trace_id: traceId,
          work_item_id: work_item_id,
          step: 'SYNC_FAILED',
          provider: result?.provider_used || 'unknown',
          http_status: errorDetail.httpStatus,
          success: false,
          error_code: errorCode,
          message: `${errorCode}: ${errorDetail.message}`,
          meta: {
            error_name: errorDetail.name,
            response_preview: errorDetail.responsePreview,
            is_timeout: errorDetail.isTimeout,
            provider_attempts: result?.provider_attempts?.length || 0,
          },
        });
      }
    } catch { /* trace logging should never fail the response */ }

    return errorResponse(
      errorCode,
      errorDetail.message,
      500,
      traceId
    );
  }
});
