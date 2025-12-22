// ============= CPNU ADAPTER TYPES =============
// Shared between edge function and tests

export interface ProcessEvent {
  source: string;
  event_type: string;
  event_date: string | null;
  title: string;
  description: string;
  detail?: string;
  attachments: Array<{ label: string; url: string }>;
  source_url: string;
  hash_fingerprint: string;
  raw_data?: Record<string, unknown>;
}

export interface SearchResult {
  radicado: string;
  despacho: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  fecha_radicacion?: string;
  detail_url?: string;
  id_proceso?: number | string;
}

export interface AttemptLog {
  phase: 'DISCOVER_API' | 'QUERY_LIST' | 'FETCH_DETAIL' | 'FETCH_ACTUACIONES' | 'FIRECRAWL_ACTIONS';
  url: string;
  method: string;
  status: number | null;
  latency_ms: number;
  error_type?: 'HTTP_ERROR' | 'TIMEOUT' | 'NON_JSON' | 'PARSE_ERROR' | 'NETWORK_ERROR' | 'FIRECRAWL_ERROR';
  response_snippet_1kb?: string;
  success: boolean;
}

export type Classification = 
  | 'SUCCESS'
  | 'NO_RESULTS_CONFIRMED'
  | 'ENDPOINT_404'
  | 'ENDPOINT_CHANGED'
  | 'BLOCKED_403_429'
  | 'NON_JSON_RESPONSE'
  | 'PARSE_BROKE'
  | 'INTERACTION_REQUIRED'
  | 'INTERACTION_FAILED_SELECTOR_CHANGED'
  | 'UNKNOWN';

export interface CandidateRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  description: string;
}

export interface ParseMeta {
  parseMethod: string;
  fieldsMissing?: string[];
  itemCount?: number;
}

export interface AdapterResponse {
  ok: boolean;
  source: string;
  run_id: string | null;
  classification: Classification;
  results?: SearchResult[];
  events?: ProcessEvent[];
  error?: string;
  attempts?: AttemptLog[];
  why_empty?: string;
}
