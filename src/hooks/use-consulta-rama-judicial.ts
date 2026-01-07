import { useState, useCallback, useRef } from 'react';
import { API_BASE_URL, API_ENDPOINTS, API_TIMEOUTS, ERROR_CODES, type ErrorCode, type ResponseStatus } from "@/config/api";
import { 
  normalizeRadicado, 
  validateCompleteness, 
  isFalseNegativeRisk,
  type CompletenessValidation 
} from "@/lib/radicado-utils";

/**
 * Extended API response interface matching the expected contract
 */
export interface RamaJudicialApiResponse {
  success: boolean;
  status?: string;
  jobId?: string;
  estado?: string;
  mensaje?: string;
  numero_radicacion?: string;
  fuente?: string;
  proceso?: {
    Despacho?: string;
    'Tipo de Proceso'?: string;
    'Clase de Proceso'?: string;
    Demandante?: string;
    Demandado?: string;
    [key: string]: string | undefined;
  };
  sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
  actuaciones?: Array<{
    'Fecha de Actuación'?: string;
    'Actuación'?: string;
    'Anotación'?: string;
    [key: string]: string | undefined;
  }>;
  estados_electronicos?: Array<{
    nombre_archivo?: string;
    despacho?: string;
    tipo_documento?: string;
    encontrado_el?: string;
  }>;
  total_actuaciones?: number;
  error?: string;
}

/**
 * Enhanced error structure with retry information
 */
export interface ConsultaError {
  code: ErrorCode;
  message: string;
  retriable: boolean;
  retryStrategy?: 'IMMEDIATE' | 'BACKOFF' | 'FALLBACK';
  attemptCount?: number;
  falseNegativeRisk?: boolean;
  completeness?: CompletenessValidation;
}

/**
 * Polling state for UI feedback
 */
export interface PollingState {
  isPolling: boolean;
  attempt: number;
  maxAttempts: number;
  jobId: string | null;
  startedAt: number | null;
  status: string;
}

/**
 * Hook state
 */
interface ConsultaState {
  loading: boolean;
  datos: RamaJudicialApiResponse | null;
  error: ConsultaError | null;
  polling: PollingState;
  responseStatus: ResponseStatus | null;
}

/**
 * Retriable error codes
 */
const RETRIABLE_CODES: ErrorCode[] = [
  'TIMEOUT',
  'NETWORK_ERROR',
  'POLLING_ERROR',
  'NOT_FOUND_PROVISIONAL',
  'INCOMPLETE_DATA',
  'SILENCIO_DATOS',
  'RATE_LIMITED',
];

/**
 * Build error object with context
 */
function buildError(
  code: ErrorCode,
  message: string,
  options: Partial<ConsultaError> = {}
): ConsultaError {
  const isRetriable = RETRIABLE_CODES.includes(code);

  return {
    code,
    message,
    retriable: isRetriable,
    retryStrategy: isRetriable ? 'BACKOFF' : undefined,
    ...options,
  };
}

/**
 * Detect silencio (technical success but semantic failure)
 */
function detectSilencio(data: RamaJudicialApiResponse): ConsultaError | null {
  // If success but missing critical data
  if (data.success === true || data.status === 'completed') {
    const validation = validateCompleteness(data);
    
    if (!validation.isComplete) {
      return buildError(
        ERROR_CODES.SILENCIO_DATOS,
        `Respuesta incompleta: faltan ${validation.missingFields.join(', ')}`,
        {
          completeness: validation,
          retriable: true,
          retryStrategy: 'FALLBACK',
        }
      );
    }

    // Check for empty arrays that should have data
    if (data.sujetos_procesales && data.sujetos_procesales.length === 0) {
      return buildError(
        ERROR_CODES.INCOMPLETE_DATA,
        'Sujetos procesales vacío',
        { retriable: true, retryStrategy: 'FALLBACK' }
      );
    }

    if (data.actuaciones && data.actuaciones.length === 0) {
      return buildError(
        ERROR_CODES.INCOMPLETE_DATA,
        'Actuaciones vacío',
        { retriable: true, retryStrategy: 'FALLBACK' }
      );
    }
  }

  return null;
}

/**
 * Process API response and detect false negatives
 */
function processResponse(data: RamaJudicialApiResponse): {
  datos: RamaJudicialApiResponse | null;
  error: ConsultaError | null;
  status: ResponseStatus;
} {
  // Check for explicit failure states
  if (data.status === 'failed') {
    return {
      datos: null,
      error: buildError(
        ERROR_CODES.API_ERROR,
        data.error || 'La consulta falló en el servidor',
        { retriable: true }
      ),
      status: 'ERROR',
    };
  }

  // Check for NO_ENCONTRADO - but verify it's not a false negative
  if (data.estado === 'NO_ENCONTRADO') {
    const isFalseNegative = isFalseNegativeRisk(data);
    
    if (isFalseNegative) {
      return {
        datos: null,
        error: buildError(
          ERROR_CODES.FALSE_NEGATIVE_RISK,
          'Posible falso negativo detectado - el proceso podría existir',
          { 
            retriable: true, 
            retryStrategy: 'FALLBACK',
            falseNegativeRisk: true,
          }
        ),
        status: 'NOT_FOUND_RETRY',
      };
    }

    // First attempt NOT_FOUND should be marked as provisional
    return {
      datos: null,
      error: buildError(
        ERROR_CODES.NOT_FOUND_PROVISIONAL,
        data.mensaje || 'No se encontró información del proceso - verificando en otras fuentes',
        { retriable: true, retryStrategy: 'FALLBACK' }
      ),
      status: 'NOT_FOUND_RETRY',
    };
  }

  // Check for success:false explicitly
  if (data.success === false && data.status === 'completed') {
    // This is the problematic case: completed but no success
    if (data.estado === 'NO_ENCONTRADO') {
      return {
        datos: null,
        error: buildError(
          ERROR_CODES.NOT_FOUND_PROVISIONAL,
          data.mensaje || 'Consulta completada sin resultados - se requiere verificación',
          { retriable: true, retryStrategy: 'FALLBACK' }
        ),
        status: 'NOT_FOUND_RETRY',
      };
    }
    
    return {
      datos: null,
      error: buildError(
        ERROR_CODES.API_ERROR,
        data.error || data.mensaje || 'La consulta no fue exitosa',
        { retriable: true }
      ),
      status: 'ERROR',
    };
  }

  // Check for missing proceso data
  if (!data.proceso) {
    return {
      datos: null,
      error: buildError(
        ERROR_CODES.NO_PROCESS_DATA,
        'Respuesta sin datos del proceso',
        { retriable: true, retryStrategy: 'FALLBACK' }
      ),
      status: 'NOT_FOUND_RETRY',
    };
  }

  // Check for silencio (incomplete data)
  const silencioError = detectSilencio(data);
  if (silencioError) {
    return {
      datos: data, // Keep partial data for debugging
      error: silencioError,
      status: 'PARTIAL_SUCCESS',
    };
  }

  // Full success
  return {
    datos: data,
    error: null,
    status: 'SUCCESS',
  };
}

/**
 * Hook para consultar la Rama Judicial
 * 
 * Maneja:
 * - Normalización de radicado
 * - Polling con job IDs
 * - Detección de falsos negativos
 * - Detección de silencios (datos incompletos)
 * - Reintentos y fallbacks
 */
export const useConsultaRamaJudicial = () => {
  const [state, setState] = useState<ConsultaState>({
    loading: false,
    datos: null,
    error: null,
    polling: {
      isPolling: false,
      attempt: 0,
      maxAttempts: API_TIMEOUTS.MAX_POLLING_ATTEMPTS,
      jobId: null,
      startedAt: null,
      status: 'idle',
    },
    responseStatus: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Cleanup polling interval
   */
  const cleanupPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  /**
   * Main consultation function
   */
  const consultar = useCallback(async (numeroRadicacion: string, options?: {
    retryCount?: number;
    fallbackSource?: string;
  }) => {
    cleanupPolling();
    
    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
      datos: null,
      responseStatus: null,
      polling: {
        isPolling: false,
        attempt: 0,
        maxAttempts: API_TIMEOUTS.MAX_POLLING_ATTEMPTS,
        jobId: null,
        startedAt: null,
        status: 'initializing',
      },
    }));

    // Validate and normalize radicado
    const normalized = normalizeRadicado(numeroRadicacion);
    if (!normalized.ok || !normalized.radicado23) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: buildError(
          (normalized.error?.code as ErrorCode) || ERROR_CODES.INVALID_FORMAT,
          normalized.error?.message || 'Formato de radicado inválido'
        ),
        responseStatus: 'ERROR',
      }));
      return;
    }

    const radicado = normalized.radicado23;
    abortControllerRef.current = new AbortController();

    try {
      // Step 1: Initial request to get jobId
      const searchUrl = `${API_BASE_URL}${API_ENDPOINTS.BUSCAR}?numero_radicacion=${radicado}`;
      
      setState(prev => ({
        ...prev,
        polling: { ...prev.polling, status: 'sending_request' },
      }));

      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorCode: ErrorCode = ERROR_CODES.HTTP_ERROR;
        
        if (response.status === 429) errorCode = ERROR_CODES.RATE_LIMITED;
        if (response.status === 404) errorCode = ERROR_CODES.NOT_FOUND;
        
        setState(prev => ({
          ...prev,
          loading: false,
          error: buildError(errorCode, `HTTP ${response.status}: ${errorText.slice(0, 200)}`),
          responseStatus: 'ERROR',
        }));
        return;
      }

      let data: RamaJudicialApiResponse;
      try {
        data = await response.json();
      } catch {
        setState(prev => ({
          ...prev,
          loading: false,
          error: buildError(ERROR_CODES.PARSE_ERROR, 'Error parseando respuesta del servidor'),
          responseStatus: 'ERROR',
        }));
        return;
      }

      // Check if we got a jobId for polling
      if (data.jobId) {
        const jobId = data.jobId;
        const startTime = Date.now();
        
        setState(prev => ({
          ...prev,
          polling: {
            isPolling: true,
            attempt: 0,
            maxAttempts: API_TIMEOUTS.MAX_POLLING_ATTEMPTS,
            jobId,
            startedAt: startTime,
            status: 'polling',
          },
        }));

        // Start polling
        let attempts = 0;
        
        pollingIntervalRef.current = setInterval(async () => {
          attempts++;
          
          setState(prev => ({
            ...prev,
            polling: { ...prev.polling, attempt: attempts, status: 'polling' },
          }));

          try {
            const pollUrl = `${API_BASE_URL}${API_ENDPOINTS.RESULTADO}/${jobId}`;
            const pollResponse = await fetch(pollUrl, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
              signal: abortControllerRef.current?.signal,
            });

            if (!pollResponse.ok) {
              console.warn(`Polling attempt ${attempts} failed: HTTP ${pollResponse.status}`);
              if (attempts >= API_TIMEOUTS.MAX_POLLING_ATTEMPTS) {
                cleanupPolling();
                setState(prev => ({
                  ...prev,
                  loading: false,
                  error: buildError(ERROR_CODES.POLLING_ERROR, 'Error en polling después de múltiples intentos'),
                  responseStatus: 'ERROR',
                }));
              }
              return;
            }

            const result: RamaJudicialApiResponse = await pollResponse.json();
            
            // Check if completed
            if (result.status === 'completed') {
              cleanupPolling();
              
              // Process the response
              const processed = processResponse(result);
              
              setState(prev => ({
                ...prev,
                loading: false,
                datos: processed.datos,
                error: processed.error,
                responseStatus: processed.status,
                polling: { ...prev.polling, isPolling: false, status: 'completed' },
              }));
              return;
            }

            // Check if failed
            if (result.status === 'failed') {
              cleanupPolling();
              setState(prev => ({
                ...prev,
                loading: false,
                error: buildError(ERROR_CODES.API_ERROR, result.error || 'La consulta falló'),
                responseStatus: 'ERROR',
                polling: { ...prev.polling, isPolling: false, status: 'failed' },
              }));
              return;
            }

            // Timeout check
            if (attempts >= API_TIMEOUTS.MAX_POLLING_ATTEMPTS) {
              cleanupPolling();
              setState(prev => ({
                ...prev,
                loading: false,
                error: buildError(ERROR_CODES.TIMEOUT, 'Tiempo de espera agotado'),
                responseStatus: 'UNAVAILABLE',
                polling: { ...prev.polling, isPolling: false, status: 'timeout' },
              }));
            }

          } catch (err) {
            console.warn(`Polling error on attempt ${attempts}:`, err);
            
            if (attempts >= API_TIMEOUTS.MAX_POLLING_ATTEMPTS) {
              cleanupPolling();
              setState(prev => ({
                ...prev,
                loading: false,
                error: buildError(
                  ERROR_CODES.NETWORK_ERROR,
                  err instanceof Error ? err.message : 'Error de conexión durante polling'
                ),
                responseStatus: 'ERROR',
              }));
            }
          }
        }, API_TIMEOUTS.POLLING_INTERVAL_MS);

      } else if (data.proceso) {
        // Direct response without polling
        const processed = processResponse(data);
        
        setState(prev => ({
          ...prev,
          loading: false,
          datos: processed.datos,
          error: processed.error,
          responseStatus: processed.status,
        }));

      } else if (data.estado === 'NO_ENCONTRADO' || data.success === false) {
        // Immediate NOT_FOUND response
        const processed = processResponse(data);
        
        setState(prev => ({
          ...prev,
          loading: false,
          datos: processed.datos,
          error: processed.error,
          responseStatus: processed.status,
        }));

      } else {
        // Unknown response format
        setState(prev => ({
          ...prev,
          loading: false,
          error: buildError(
            ERROR_CODES.UNEXPECTED_RESPONSE,
            `Respuesta inesperada: ${JSON.stringify(data).slice(0, 200)}`
          ),
          responseStatus: 'ERROR',
        }));
      }

    } catch (err) {
      cleanupPolling();
      
      if (err instanceof Error && err.name === 'AbortError') {
        setState(prev => ({
          ...prev,
          loading: false,
          error: null,
          responseStatus: null,
        }));
        return;
      }

      setState(prev => ({
        ...prev,
        loading: false,
        error: buildError(
          ERROR_CODES.NETWORK_ERROR,
          err instanceof Error ? err.message : 'Error de conexión'
        ),
        responseStatus: 'ERROR',
      }));
    }
  }, [cleanupPolling]);

  /**
   * Cancel ongoing request
   */
  const cancelar = useCallback(() => {
    cleanupPolling();
    setState(prev => ({
      ...prev,
      loading: false,
      polling: {
        isPolling: false,
        attempt: 0,
        maxAttempts: API_TIMEOUTS.MAX_POLLING_ATTEMPTS,
        jobId: null,
        startedAt: null,
        status: 'cancelled',
      },
    }));
  }, [cleanupPolling]);

  /**
   * Clear state
   */
  const limpiar = useCallback(() => {
    cleanupPolling();
    setState({
      loading: false,
      datos: null,
      error: null,
      polling: {
        isPolling: false,
        attempt: 0,
        maxAttempts: API_TIMEOUTS.MAX_POLLING_ATTEMPTS,
        jobId: null,
        startedAt: null,
        status: 'idle',
      },
      responseStatus: null,
    });
  }, [cleanupPolling]);

  return {
    consultar,
    cancelar,
    limpiar,
    loading: state.loading,
    datos: state.datos,
    error: state.error,
    polling: state.polling,
    responseStatus: state.responseStatus,
    
    // Helpers for UI
    isNotFound: state.responseStatus === 'NOT_FOUND',
    isNotFoundRetry: state.responseStatus === 'NOT_FOUND_RETRY',
    isPartialSuccess: state.responseStatus === 'PARTIAL_SUCCESS',
    isSuccess: state.responseStatus === 'SUCCESS',
    hasFalseNegativeRisk: state.error?.falseNegativeRisk ?? false,
    hasIncompleteData: state.error?.code === ERROR_CODES.INCOMPLETE_DATA || 
                       state.error?.code === ERROR_CODES.SILENCIO_DATOS,
  };
};
