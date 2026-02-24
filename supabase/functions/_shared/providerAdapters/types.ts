/**
 * types.ts — Shared types for the provider adapter layer.
 *
 * These types define the normalized output format that ALL provider adapters
 * must return. The normalized format is ready for either:
 *   - Persistence (orchestrator: upsert into work_item_acts / work_item_publicaciones)
 *   - Preview (creation wizard / demo: display to user without persisting)
 *
 * The adapter does NOT decide whether to persist — that's the caller's responsibility.
 */

// ═══════════════════════════════════════════
// NORMALIZED DATA TYPES
// ═══════════════════════════════════════════

/**
 * Normalized actuación (movement/event) from any provider.
 * This is the canonical intermediate format between raw provider response
 * and DB persistence.
 */
export interface NormalizedActuacion {
  /** ISO date YYYY-MM-DD */
  fecha_actuacion: string;
  /** Movement type name */
  actuacion: string;
  /** Description/annotation */
  anotacion: string | null;
  /** Pre-computed fingerprint for dedup (uses canonical algorithm) */
  hash_fingerprint: string;
  /** Canonical provider key (lowercase) */
  source_platform: string;
  /** Always an array, never scalar */
  sources: string[];
  /** Term start date */
  fecha_inicia_termino?: string;
  /** Term end date */
  fecha_finaliza_termino?: string;
  /** Registration date */
  fecha_registro?: string;
  /** Estado (SAMAI-specific) */
  estado?: string;
  /** Anexos count */
  anexos_count?: number;
  /** Sequence/index */
  indice?: string;
  /** Court/despacho name per actuación (CPNU-specific) */
  nombre_despacho?: string;
  /** Judicial instance (e.g., '00', '01', '02') */
  instancia?: string;
  /** Document attachments */
  documentos?: Array<{ nombre: string; url: string }>;
  /** Original provider response for debugging */
  raw_data?: Record<string, unknown>;
}

/**
 * Attachment on a publicación/estado.
 */
export interface PublicacionAttachment {
  type: 'pdf' | 'link';
  url: string;
  label?: string;
  provider?: string;
}

/**
 * Normalized publicación (estado electrónico) from any provider.
 */
export interface NormalizedPublicacion {
  /** Publication title */
  title: string;
  /** Publication type (Estado Electrónico, Edicto, Notificación, etc.) */
  tipo_publicacion: string;
  /** ISO date YYYY-MM-DD */
  fecha_fijacion: string;
  /** ISO date YYYY-MM-DD */
  fecha_desfijacion?: string;
  /** Pre-computed fingerprint for dedup */
  hash_fingerprint: string;
  /** Canonical provider key */
  source_platform: string;
  /** Always an array */
  sources: string[];
  /** Court name */
  juzgado?: string;
  /** PDF/document URL */
  pdf_url?: string;
  /** Entry/detail URL */
  entry_url?: string;
  /** Asset ID from provider */
  asset_id?: string;
  /** Key from provider */
  key?: string;
  /** Date when legal terms begin */
  terminos_inician?: string;
  /** File attachments */
  attachments?: PublicacionAttachment[];
  /** Provider classification */
  clasificacion?: {
    categoria?: string;
    descripcion?: string;
    prioridad?: number;
    es_descargable?: boolean;
  };
  /** Original provider response for debugging */
  raw_data?: Record<string, unknown>;
}

// ═══════════════════════════════════════════
// PROVIDER RESULT TYPES
// ═══════════════════════════════════════════

/**
 * Case metadata extracted from a provider response.
 */
export interface CaseMetadata {
  despacho?: string | null;
  ciudad?: string | null;
  departamento?: string | null;
  tipo_proceso?: string | null;
  clase_proceso?: string | null;
  fecha_radicacion?: string | null;
  // SAMAI-specific
  ponente?: string | null;
  etapa?: string | null;
  origen?: string | null;
  ubicacion?: string | null;
  formato_expediente?: string | null;
  subclase?: string | null;
  recurso?: string | null;
  naturaleza?: string | null;
  asunto?: string | null;
  medida_cautelar?: string | null;
  ministerio_publico?: string | null;
  total_sujetos?: number | null;
  sala_conoce?: string | null;
  sala_decide?: string | null;
  veces_en_corporacion?: number | null;
  guid?: string | null;
  consultado_en?: string | null;
  fuente?: string | null;
  // Dates
  fecha_presenta_demanda?: string | null;
  fecha_para_sentencia?: string | null;
  fecha_sentencia?: string | null;
  // Tutela-specific
  tutela_code?: string | null;
  corte_status?: string | null;
  sentencia_ref?: string | null;
}

/**
 * Parties (sujetos procesales) extracted from a provider response.
 */
export interface ExtractedParties {
  demandante: string | null;
  demandado: string | null;
  sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
}

/**
 * Adapter mode: controls endpoint selection and behavior.
 * - 'monitoring': ongoing sync, uses /snapshot endpoints where available
 * - 'discovery': creation wizard / demo, uses /buscar for fresh lookups
 */
export type AdapterMode = 'monitoring' | 'discovery';

/**
 * Common options for all provider adapters.
 */
export interface AdapterOptions {
  /** The radicado (or tutela code) to look up */
  radicado: string;
  /** Controls endpoint selection */
  mode: AdapterMode;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Whether to extract parties (sujetos procesales) */
  includeParties?: boolean;
  /** Work item ID (for fingerprint generation in monitoring mode) */
  workItemId?: string;
  /** Whether to use cross-provider dedup in fingerprints (FANOUT mode) */
  crossProviderDedup?: boolean;
  /** Whether to redact PII from results (demo mode) */
  redactPII?: boolean;
}

/**
 * Result status from a provider adapter call.
 */
export type ProviderStatus = 'SUCCESS' | 'EMPTY' | 'ERROR' | 'TIMEOUT' | 'SCRAPING_INITIATED';

/**
 * Result from a single provider adapter call.
 * Contains normalized data ready for either persistence or preview.
 */
export interface ProviderAdapterResult {
  /** Canonical provider key */
  provider: string;
  /** Overall status */
  status: ProviderStatus;
  /** Normalized actuaciones */
  actuaciones: NormalizedActuacion[];
  /** Normalized publicaciones/estados */
  publicaciones: NormalizedPublicacion[];
  /** Case metadata (despacho, parties, etc.) */
  metadata: CaseMetadata | null;
  /** Extracted parties */
  parties: ExtractedParties | null;
  /** Duration of the adapter call */
  durationMs: number;
  /** Error message if status is ERROR */
  errorMessage?: string;
  /** HTTP status code from the provider */
  httpStatus?: number;
  /** Raw provider response for debugging (only if requested) */
  rawResponse?: unknown;
  // Scraping job fields (for async providers)
  scrapingJobId?: string;
  scrapingPollUrl?: string;
}

/**
 * Result from a fan-out call to multiple providers.
 */
export interface FanoutResult {
  /** Per-provider results */
  results: ProviderAdapterResult[];
  /** Merged actuaciones (deduplicated) */
  mergedActuaciones: NormalizedActuacion[];
  /** Merged publicaciones (deduplicated) */
  mergedPublicaciones: NormalizedPublicacion[];
  /** Best-available metadata (first non-empty wins, per field) */
  mergedMetadata: CaseMetadata;
  /** Best-available parties */
  mergedParties: ExtractedParties;
  /** Total duration */
  durationMs: number;
}
