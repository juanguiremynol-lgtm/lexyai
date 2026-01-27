import { useState, useCallback, useRef } from 'react';
import { API_ENDPOINTS, API_TIMEOUTS, ERROR_CODES, type ErrorCode, type ResponseStatus } from "@/config/api";
import { supabase } from "@/integrations/supabase/client";
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
  jobId: string | null;
  startedAt: number | null;
  elapsedMs: number;
  status: 'idle' | 'healthcheck' | 'healthcheck_retry' | 'sending_request' | 'polling' | 'slow_warning' | 'completed' | 'failed' | 'timeout' | 'timeout_soft' | 'cancelled';
  message?: string;
  canContinue?: boolean; // User can choose to keep waiting
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

const initialPollingState: PollingState = {
  isPolling: false,
  attempt: 0,
  jobId: null,
  startedAt: null,
  elapsedMs: 0,
  status: 'idle',
  message: undefined,
  canContinue: false,
};

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

  if (data.success === false && data.status === 'completed') {
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

  const silencioError = detectSilencio(data);
  if (silencioError) {
    return {
      datos: data,
      error: silencioError,
      status: 'PARTIAL_SUCCESS',
    };
  }

  return {
    datos: data,
    error: null,
    status: 'SUCCESS',
  };
}

/**
 * Hook para consultar la Rama Judicial
 */
export const useConsultaRamaJudicial = () => {
  const [state, setState] = useState<ConsultaState>({
    loading: false,
    datos: null,
    error: null,
    polling: initialPollingState,
    responseStatus: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const continueWaitingRef = useRef<boolean>(false);

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
    continueWaitingRef.current = false;
  }, []);

  /**
   * Health check with retries
   */
  const checkHealth = async (): Promise<{ ok: boolean; error?: string }> => {
    const retryDelays = API_TIMEOUTS.HEALTH_RETRY_DELAYS;
    
    for (let i = 0; i <= API_TIMEOUTS.MAX_HEALTH_RETRIES; i++) {
      try {
        setState(prev => ({
          ...prev,
          polling: {
            ...prev.polling,
            status: i === 0 ? 'healthcheck' : 'healthcheck_retry',
            message: i === 0 
              ? 'Verificando disponibilidad del servicio...' 
              : `Servicio iniciando (intento ${i + 1}/${API_TIMEOUTS.MAX_HEALTH_RETRIES + 1})...`,
          },
        }));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.HEALTH_CHECK_MS);
        
        const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.HEALTH}`, {
          method: 'GET',
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          return { ok: true };
        }
        
        // Try root endpoint as fallback
        if (response.status === 404) {
          const rootResponse = await fetch(`${API_BASE_URL}/`, {
            method: 'GET',
            signal: controller.signal,
          });
          if (rootResponse.ok) {
            return { ok: true };
          }
        }
        
        throw new Error(`Health check failed: ${response.status}`);
      } catch (err) {
        console.warn(`Health check attempt ${i + 1} failed:`, err);
        
        if (i < API_TIMEOUTS.MAX_HEALTH_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, retryDelays[i] || 5000));
        }
      }
    }
    
    return { ok: false, error: 'Servicio no disponible después de múltiples intentos' };
  };

  /**
   * Get current polling interval based on elapsed time
   */
  const getPollingInterval = (elapsedMs: number): number => {
    return elapsedMs < API_TIMEOUTS.POLLING_FAST_PHASE_MS 
      ? API_TIMEOUTS.POLLING_INTERVAL_FAST_MS 
      : API_TIMEOUTS.POLLING_INTERVAL_SLOW_MS;
  };

  /**
   * Continue waiting after soft timeout
   */
  const continueWaiting = useCallback(() => {
    continueWaitingRef.current = true;
    setState(prev => ({
      ...prev,
      polling: {
        ...prev.polling,
        status: 'polling',
        message: 'Continuando espera...',
        canContinue: false,
      },
    }));
  }, []);

  /**
   * Main consultation function
   */
  const consultar = useCallback(async (numeroRadicacion: string, options?: {
    retryCount?: number;
    fallbackSource?: string;
    skipHealthCheck?: boolean;
  }) => {
    cleanupPolling();
    
    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
      datos: null,
      responseStatus: null,
      polling: {
        ...initialPollingState,
        status: 'healthcheck',
        message: 'Iniciando consulta...',
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
        polling: { ...initialPollingState, status: 'failed' },
      }));
      return;
    }

    const radicado = normalized.radicado23;
    abortControllerRef.current = new AbortController();

    try {
      // Step 0: Health check (unless skipped)
      if (!options?.skipHealthCheck) {
        const health = await checkHealth();
        if (!health.ok) {
          setState(prev => ({
            ...prev,
            loading: false,
            error: buildError(
              ERROR_CODES.NETWORK_ERROR,
              health.error || 'Servicio no disponible. Intenta nuevamente en unos momentos.'
            ),
            responseStatus: 'UNAVAILABLE',
            polling: { ...initialPollingState, status: 'failed', message: health.error },
          }));
          return;
        }
      }

      // Step 1: Initial request to get jobId
      const searchUrl = `${API_BASE_URL}${API_ENDPOINTS.BUSCAR}?numero_radicacion=${radicado}`;
      
      setState(prev => ({
        ...prev,
        polling: { ...prev.polling, status: 'sending_request', message: 'Enviando consulta...' },
      }));

      const initialController = new AbortController();
      const initialTimeout = setTimeout(() => initialController.abort(), API_TIMEOUTS.INITIAL_REQUEST_MS);

      let response: Response;
      try {
        response = await fetch(searchUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          signal: initialController.signal,
        });
        clearTimeout(initialTimeout);
      } catch (fetchError) {
        clearTimeout(initialTimeout);
        const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        
        if (errorMsg.includes('abort') || errorMsg.includes('AbortError')) {
          setState(prev => ({
            ...prev,
            loading: false,
            error: buildError(
              ERROR_CODES.TIMEOUT, 
              'La solicitud inicial tardó demasiado. El servidor puede estar procesando. Intenta nuevamente.'
            ),
            responseStatus: 'UNAVAILABLE',
            polling: { ...initialPollingState, status: 'timeout', message: 'Timeout en solicitud inicial' },
          }));
          return;
        }
        throw fetchError;
      }

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
          polling: { ...initialPollingState, status: 'failed' },
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
          polling: { ...initialPollingState, status: 'failed' },
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
            jobId,
            startedAt: startTime,
            elapsedMs: 0,
            status: 'polling',
            message: 'Consultando portal de Rama Judicial...',
            canContinue: false,
          },
        }));

        // Start adaptive polling
        let attempts = 0;
        let lastPollTime = Date.now();
        
        const poll = async () => {
          const now = Date.now();
          const elapsedMs = now - startTime;
          attempts++;

          // Check for hard timeout (2 minutes)
          if (elapsedMs >= API_TIMEOUTS.MAX_TOTAL_TIME_MS && !continueWaitingRef.current) {
            cleanupPolling();
            setState(prev => ({
              ...prev,
              loading: false,
              error: buildError(ERROR_CODES.TIMEOUT, 'Tiempo máximo de espera alcanzado (2 minutos)'),
              responseStatus: 'UNAVAILABLE',
              polling: { 
                ...prev.polling, 
                isPolling: false, 
                status: 'timeout',
                elapsedMs,
                message: 'Tiempo agotado. Puedes intentar nuevamente.',
              },
            }));
            return;
          }

          // Check for soft timeout (90s) - show warning but allow continuing
          if (elapsedMs >= API_TIMEOUTS.SOFT_TIMEOUT_MS && !continueWaitingRef.current) {
            setState(prev => ({
              ...prev,
              polling: {
                ...prev.polling,
                status: 'timeout_soft',
                elapsedMs,
                message: 'La consulta está tardando más de lo normal. El portal puede estar lento.',
                canContinue: true,
              },
            }));
            // Continue polling but with warning shown
          } else {
            setState(prev => ({
              ...prev,
              polling: {
                ...prev.polling,
                attempt: attempts,
                elapsedMs,
                status: elapsedMs >= API_TIMEOUTS.SOFT_TIMEOUT_MS ? 'slow_warning' : 'polling',
                message: elapsedMs >= 30000 
                  ? `Consulta en progreso (${Math.round(elapsedMs / 1000)}s)... El portal puede estar lento.`
                  : `Consultando... (${Math.round(elapsedMs / 1000)}s)`,
              },
            }));
          }

          try {
            const pollController = new AbortController();
            const pollTimeout = setTimeout(() => pollController.abort(), 15000); // 15s per poll
            
            const pollUrl = `${API_BASE_URL}${API_ENDPOINTS.RESULTADO}/${jobId}`;
            const pollResponse = await fetch(pollUrl, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
              signal: pollController.signal,
            });
            
            clearTimeout(pollTimeout);

            if (!pollResponse.ok) {
              console.warn(`Polling attempt ${attempts} failed: HTTP ${pollResponse.status}`);
              scheduleNextPoll(elapsedMs);
              return;
            }

            const result: RamaJudicialApiResponse = await pollResponse.json();
            
            // Check if still running/queued - continue polling
            if (result.status === 'running' || result.status === 'queued') {
              scheduleNextPoll(elapsedMs);
              return;
            }
            
            // Check if completed
            if (result.status === 'completed') {
              cleanupPolling();
              
              const processed = processResponse(result);
              
              setState(prev => ({
                ...prev,
                loading: false,
                datos: processed.datos,
                error: processed.error,
                responseStatus: processed.status,
                polling: { 
                  ...prev.polling, 
                  isPolling: false, 
                  status: 'completed',
                  elapsedMs,
                },
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
                polling: { 
                  ...prev.polling, 
                  isPolling: false, 
                  status: 'failed',
                  elapsedMs,
                },
              }));
              return;
            }

            // Unknown status - continue polling
            scheduleNextPoll(elapsedMs);

          } catch (err) {
            console.warn(`Polling error on attempt ${attempts}:`, err);
            scheduleNextPoll(Date.now() - startTime);
          }
        };

        const scheduleNextPoll = (elapsedMs: number) => {
          const interval = getPollingInterval(elapsedMs);
          pollingIntervalRef.current = setTimeout(poll, interval);
        };

        // Start first poll
        scheduleNextPoll(0);

      } else if (data.proceso) {
        // Direct response without polling
        const processed = processResponse(data);
        
        setState(prev => ({
          ...prev,
          loading: false,
          datos: processed.datos,
          error: processed.error,
          responseStatus: processed.status,
          polling: { ...initialPollingState, status: 'completed' },
        }));

      } else if (data.estado === 'NO_ENCONTRADO' || data.success === false) {
        const processed = processResponse(data);
        
        setState(prev => ({
          ...prev,
          loading: false,
          datos: processed.datos,
          error: processed.error,
          responseStatus: processed.status,
          polling: { ...initialPollingState, status: 'completed' },
        }));

      } else {
        setState(prev => ({
          ...prev,
          loading: false,
          error: buildError(
            ERROR_CODES.UNEXPECTED_RESPONSE,
            `Respuesta inesperada: ${JSON.stringify(data).slice(0, 200)}`
          ),
          responseStatus: 'ERROR',
          polling: { ...initialPollingState, status: 'failed' },
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
          polling: { ...initialPollingState, status: 'cancelled' },
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
        polling: { ...initialPollingState, status: 'failed' },
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
      polling: { ...initialPollingState, status: 'cancelled' },
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
      polling: initialPollingState,
      responseStatus: null,
    });
  }, [cleanupPolling]);

  return {
    consultar,
    cancelar,
    limpiar,
    continueWaiting,
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
    isSoftTimeout: state.polling.status === 'timeout_soft',
    canContinueWaiting: state.polling.canContinue ?? false,
  };
};
