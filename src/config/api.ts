/**
 * API Configuration
 * Central configuration for external API endpoints
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
} as const;

export const ERROR_CODES = {
  INVALID_FORMAT: 'INVALID_FORMAT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  POLLING_ERROR: 'POLLING_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  API_ERROR: 'API_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  NO_DATA: 'NO_DATA',
  NO_PROCESS_DATA: 'NO_PROCESS_DATA',
  RATE_LIMITED: 'RATE_LIMITED',
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
  HTTP_ERROR: 'HTTP_ERROR',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

// Debug trace interface for detailed request tracking
export interface DebugTrace {
  id: string;
  timestamp: string;
  stage: string;
  type: 'request' | 'response' | 'poll' | 'error' | 'info';
  url?: string;
  method?: string;
  status?: number;
  duration?: number;
  headers?: Record<string, string>;
  body?: unknown;
  error?: string;
}
