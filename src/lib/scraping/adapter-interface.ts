/**
 * Scraping Adapter Interface
 * 
 * This module defines the pluggable adapter layer for Rama Judicial scraping.
 * The system is designed to allow future enhancement scripts to replace or extend
 * current scraping without breaking core Case / Milestones / Alerts Engine logic.
 * 
 * @note "Scraping Adapter is designed to be enhanced/replaced by a user-provided script later."
 */

export type RadicadoLookupStatus = 
  | 'FOUND'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'UNAVAILABLE'
  | 'ERROR';

export type ScrapeStatus =
  | 'SUCCESS'
  | 'PARTIAL'
  | 'FAILED'
  | 'RATE_LIMITED';

export interface RadicadoMatch {
  radicado: string;
  despacho: string;
  demandante?: string;
  demandado?: string;
  lastActionDate?: string;
  sourceUrl: string;
  confidence: number;
}

export interface LookupResult {
  status: RadicadoLookupStatus;
  matches: RadicadoMatch[];
  errorMessage?: string;
  errorCode?: string;
  rawResponse?: unknown;
}

export interface RawActuacion {
  fechaActuacion: string;
  actuacion: string;
  anotacion?: string;
  fechaInicial?: string;
  fechaFinal?: string;
  fechaRegistro?: string;
  conDocumentos?: boolean;
  documentos?: Array<{ nombre: string; url: string }>;
  rawData?: Record<string, unknown>;
}

export interface SujetoProcesal {
  tipo: string;
  nombre: string;
}

export interface CaseMetadata {
  radicado: string;
  despacho?: string;
  ponente?: string;
  demandantes?: string;
  demandados?: string;
  tipoProceso?: string;
  clase?: string;
  ubicacion?: string;
  fechaRadicacion?: string;
  ultimaActuacion?: string;
  sourceUrl: string;
  sujetosProcesales?: SujetoProcesal[];
  totalActuaciones?: number;
}

export interface ScrapeResult {
  status: ScrapeStatus;
  caseMetadata?: CaseMetadata;
  actuaciones: RawActuacion[];
  screenshot?: string; // Base64 encoded
  rawHtml?: string;
  rawMarkdown?: string;
  errorMessage?: string;
  errorCode?: string;
  scrapedAt: string;
}

export interface NormalizedActuacion {
  rawText: string;
  normalizedText: string;
  actDate: string | null;
  actTime: string | null;
  actDateRaw: string;
  actTypeGuess: string | null;
  confidence: number;
  attachments: Array<{ label: string; url: string }>;
  sourceUrl: string;
  hashFingerprint: string;
}

/**
 * Adapter Capabilities - what data types this adapter can fetch
 * Used for capability-based routing and fallback ordering
 */
export type AdapterCapability = 
  | 'ACTUACIONES'      // Can fetch actuaciones/timeline
  | 'ESTADOS'          // Can fetch estados (status updates)
  | 'DOCUMENTS'        // Can fetch attached documents
  | 'CASE_METADATA'    // Can fetch case info (parties, court, etc.)
  | 'HEARINGS'         // Can fetch hearing schedules
  | 'NOTIFICATIONS';   // Can fetch notification status

/**
 * Workflow types that adapters can support
 */
export type SupportedWorkflowType = 
  | 'CGP' 
  | 'CPACA' 
  | 'TUTELA' 
  | 'LABORAL' 
  | 'PENAL_906'
  | 'GOV_PROCEDURE'
  | 'ALL';

/**
 * Abstract Scraping Adapter Interface
 * 
 * Implement this interface to create custom scrapers for different sources
 * or to enhance the default Rama Judicial scraper.
 */
export interface ScrapingAdapter {
  /** Unique identifier for this adapter */
  readonly id: string;
  
  /** Human-readable name */
  readonly name: string;
  
  /** Description of what this adapter does */
  readonly description: string;
  
  /** Whether this adapter is currently active/usable */
  readonly active: boolean;
  
  /** Capabilities this adapter provides */
  readonly capabilities: AdapterCapability[];
  
  /** Workflow types this adapter supports */
  readonly supportedWorkflows: SupportedWorkflowType[];
  
  /** Priority for fallback ordering (higher = try first) */
  readonly priority: number;
  
  /**
   * Check if adapter is configured and ready to use
   * Returns false if missing credentials or disabled
   */
  isReady(): Promise<boolean>;
  
  /**
   * Look up a radicado number and return matching cases
   */
  lookup(radicadoNumber: string): Promise<LookupResult>;
  
  /**
   * Scrape case details and actuaciones for a matched case
   */
  scrapeCase(match: RadicadoMatch): Promise<ScrapeResult>;
  
  /**
   * Normalize raw actuaciones into a standard format
   */
  normalizeActuaciones(actuacionesRaw: RawActuacion[], sourceUrl: string): NormalizedActuacion[];
}

/**
 * Feature flags for org-level integrations
 */
export interface OrgFeatureFlags {
  enableExternalApi: boolean;
  enableLegacyCpnu: boolean;
  enableGoogleIntegration: boolean;
  enableAwsIntegration: boolean;
  [key: string]: boolean;
}

/**
 * Configuration for org-level adapter selection
 */
export interface OrgAdapterConfig {
  organizationId: string;
  /** Ordered list of adapter IDs to try (first = highest priority) */
  adapterPriorityOrder: string[];
  /** Feature flags for future integrations */
  featureFlags: OrgFeatureFlags;
  /** Per-workflow adapter overrides */
  workflowOverrides?: Partial<Record<SupportedWorkflowType, string>>;
}

/**
 * Adapter Registry - manages available adapters
 */
export interface AdapterRegistry {
  /** Get the default adapter */
  getDefault(): ScrapingAdapter;
  
  /** Get an adapter by ID */
  getById(id: string): ScrapingAdapter | undefined;
  
  /** Register a new adapter */
  register(adapter: ScrapingAdapter): void;
  
  /** List all registered adapters */
  listAll(): ScrapingAdapter[];
  
  /** Set the default adapter */
  setDefault(id: string): void;
  
  /** Get adapter for a specific org and workflow (with fallback) */
  getForContext(organizationId: string | null, workflowType: SupportedWorkflowType): Promise<ScrapingAdapter>;
  
  /** Get adapters with a specific capability */
  getByCapability(capability: AdapterCapability): ScrapingAdapter[];
  
  /** Set org-level configuration (persists to DB) */
  setOrgConfig(config: OrgAdapterConfig): Promise<boolean>;
  
  /** Get org-level configuration (from cache/DB) */
  getOrgConfig(organizationId: string): Promise<OrgAdapterConfig | null>;
  
  /** Clear config cache for an organization */
  clearOrgConfigCache(organizationId: string): void;
}

/**
 * Compute a hash fingerprint for deduplication
 */
export function computeActuacionHash(
  actDate: string | null,
  normalizedText: string,
  sourceUrl: string
): string {
  const data = `${actDate || ''}|${normalizedText}|${sourceUrl}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Normalize text for comparison and storage
 */
export function normalizeActuacionText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/\s+/g, ' ')
    .trim();
}
