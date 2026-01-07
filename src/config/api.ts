/**
 * API Configuration
 * Central configuration for external API endpoints and error handling
 */

export const API_BASE_URL = 'https://rama-judicial-api.onrender.com';

export const API_ENDPOINTS = {
  BUSCAR: '/buscar',
  RESULTADO: '/resultado',
  HEALTH: '/health',
} as const;

export const API_TIMEOUTS = {
  INITIAL_REQUEST_MS: 30000,
  POLLING_INTERVAL_MS: 2000,
  MAX_POLLING_ATTEMPTS: 60,
  HEALTH_CHECK_MS: 10000,
  RETRY_DELAY_MS: 3000,
  MAX_RETRIES: 3,
} as const;

/**
 * Error codes for API responses
 * Extended to handle false negatives and silencios
 */
export const ERROR_CODES = {
  // Format errors
  INVALID_FORMAT: 'INVALID_FORMAT',
  EMPTY_INPUT: 'EMPTY_INPUT',
  
  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  POLLING_ERROR: 'POLLING_ERROR',
  
  // API response errors
  PARSE_ERROR: 'PARSE_ERROR',
  API_ERROR: 'API_ERROR',
  HTTP_ERROR: 'HTTP_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
  
  // Process not found - can be provisional or definitive
  NOT_FOUND: 'NOT_FOUND',
  NOT_FOUND_PROVISIONAL: 'NOT_FOUND_PROVISIONAL', // First attempt, needs retry
  NOT_FOUND_DEFINITIVE: 'NOT_FOUND_DEFINITIVE',   // After all retries exhausted
  
  // Data quality errors (silencios)
  NO_DATA: 'NO_DATA',
  NO_PROCESS_DATA: 'NO_PROCESS_DATA',
  INCOMPLETE_DATA: 'INCOMPLETE_DATA',    // Got response but missing critical fields
  SILENCIO_DATOS: 'SILENCIO_DATOS',      // Technical success but semantic failure
  
  // False negative indicators
  FALSE_NEGATIVE_RISK: 'FALSE_NEGATIVE_RISK',
  
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Response status for normalized API responses
 */
export type ResponseStatus = 
  | 'SUCCESS'           // Complete successful response
  | 'PARTIAL_SUCCESS'   // Got data but incomplete (silencio)
  | 'NOT_FOUND'         // Process definitively not found
  | 'NOT_FOUND_RETRY'   // Not found but should retry/fallback
  | 'ERROR'             // Technical error
  | 'UNAVAILABLE';      // Service unavailable

/**
 * Normalized API response structure
 */
export interface NormalizedApiResponse {
  success: boolean;
  status: ResponseStatus;
  jobId?: string;
  numero_radicacion: string;
  fuente?: 'UNIFICADA' | 'SIGLO_XXI' | 'EXTERNAL_API' | 'FALLBACK';
  proceso?: {
    despacho?: string;
    tipo?: string;
    clase?: string;
    contenido_radicacion?: string;
    sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
    actuaciones?: Array<{
      fecha_actuacion: string;
      actuacion: string;
      anotacion?: string;
      instancia?: string;
      fecha_registro?: string;
      inicia_termino?: string;
    }>;
    estados_electronicos?: Array<{
      nombre_archivo: string;
      despacho?: string;
      tipo_documento?: string;
      encontrado_el?: string;
    }>;
  };
  error?: {
    code: ErrorCode;
    message: string;
    retriable: boolean;
    retryStrategy?: 'IMMEDIATE' | 'BACKOFF' | 'FALLBACK';
  };
  debug?: {
    attempts: number;
    lastAttemptAt: string;
    fallbacksUsed: string[];
    screenshotPath?: string;
    htmlPath?: string;
  };
}

// Debug trace interface for detailed request tracking
export interface DebugTrace {
  id: string;
  timestamp: string;
  stage: string;
  type: 'request' | 'response' | 'poll' | 'error' | 'info' | 'retry' | 'fallback';
  url?: string;
  method?: string;
  status?: number;
  duration?: number;
  headers?: Record<string, string>;
  body?: unknown;
  error?: string;
  retryCount?: number;
  fallbackSource?: string;
}
