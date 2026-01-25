import { supabase } from "@/integrations/supabase/client";

export type HealthStatus = 'OK' | 'WARN' | 'ERROR' | 'UNKNOWN';

export interface HealthEvent {
  id: string;
  organization_id: string | null;
  service: string;
  status: HealthStatus;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface HealthHeartbeat {
  service: string;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_status: HealthStatus;
  last_message: string | null;
  updated_at: string;
}

export interface JobRun {
  id: string;
  job_name: string;
  organization_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: 'RUNNING' | 'OK' | 'ERROR';
  processed_count: number;
  error: string | null;
  duration_ms: number | null;
}

// Known services and their display names
export const KNOWN_SERVICES: Record<string, string> = {
  'EMAIL_OUTBOX_WORKER': 'Procesador de Correos',
  'ESTADOS_SYNC': 'Sincronización Estados',
  'HEARING_REMINDERS': 'Recordatorios Audiencias',
  'PETICION_REMINDERS': 'Recordatorios Peticiones',
  'ESTADOS_STALENESS_CHECK': 'Verificación Estados',
  'TICKER_REFRESH': 'Actualización Ticker',
  'PROCESS_MONITOR': 'Monitor Procesos',
  'ICARUS_IMPORT': 'Importación ICARUS',
  'UI_ERROR': 'Error de Interfaz',
  'API_SYNC': 'Sincronización API',
};

/**
 * Log a system health event (non-blocking, fail-safe)
 */
export async function logHealthEvent(
  service: string,
  status: HealthStatus,
  options: {
    message?: string;
    metadata?: Record<string, unknown>;
    organizationId?: string | null;
  } = {}
): Promise<boolean> {
  try {
    // Cast to any to avoid TS2769 with generated types
    const insertData = {
      service,
      status,
      message: options.message || null,
      metadata: options.metadata || {},
      organization_id: options.organizationId || null,
    };
    
    const { error } = await (supabase.from("system_health_events") as any).insert(insertData);

    if (error) {
      console.warn("[system-health] Failed to log event:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[system-health] Error logging event:", err);
    return false;
  }
}

/**
 * Log a UI error event (debounced by error signature)
 */
const recentErrors = new Map<string, number>();
const ERROR_DEBOUNCE_MS = 60000; // 1 minute

export async function logUIError(
  error: Error,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    // Create signature from error message + stack first line
    const stackLine = error.stack?.split('\n')[1] || '';
    const signature = `${error.message}|${stackLine}`.slice(0, 200);
    const signatureHash = await hashString(signature);

    // Check debounce
    const lastLogged = recentErrors.get(signatureHash);
    if (lastLogged && Date.now() - lastLogged < ERROR_DEBOUNCE_MS) {
      return; // Skip, already logged recently
    }

    recentErrors.set(signatureHash, Date.now());

    // Clean old entries periodically
    if (recentErrors.size > 100) {
      const now = Date.now();
      for (const [key, time] of recentErrors.entries()) {
        if (now - time > ERROR_DEBOUNCE_MS) {
          recentErrors.delete(key);
        }
      }
    }

    // Get org ID if available
    let organizationId: string | null = null;
    try {
      const { data } = await supabase.from("profiles").select("organization_id").single();
      organizationId = data?.organization_id || null;
    } catch {
      // Ignore
    }

    await logHealthEvent('UI_ERROR', 'WARN', {
      message: error.message,
      metadata: {
        stack: error.stack?.slice(0, 1000),
        signature: signatureHash,
        ...context,
      },
      organizationId,
    });
  } catch {
    // Fail silently
  }
}

/**
 * Simple hash function for error signatures
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch recent health events
 */
export async function fetchHealthEvents(limit = 25): Promise<HealthEvent[]> {
  try {
    const { data, error } = await (supabase.from("system_health_events") as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []) as HealthEvent[];
  } catch { return []; }
}

export async function fetchHeartbeats(): Promise<HealthHeartbeat[]> {
  try {
    const { data, error } = await (supabase.from("system_health_heartbeat") as any)
      .select("*")
      .order("service");
    if (error) return [];
    return (data || []) as HealthHeartbeat[];
  } catch { return []; }
}

export async function fetchJobRuns(limit = 25): Promise<JobRun[]> {
  try {
    const { data, error } = await (supabase.from("job_runs") as any)
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []) as JobRun[];
  } catch { return []; }
}
