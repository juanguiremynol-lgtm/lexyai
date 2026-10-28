import type { ProviderAdapterResult } from './types.ts';

type Permit = { allowed: boolean; generation: number; probe_token: string | null; retry_at: string | null };
type Rpc = (name: string, body: Record<string, unknown>) => Promise<unknown>;

export function isSharedSessionBlock(status: number, body: unknown): boolean {
  const detail = body && typeof body === 'object' ? (body as Record<string, unknown>).detail : undefined;
  return status === 502 && typeof detail === 'string' && detail.startsWith(
    "Error al conectar con SAMAI: Client error '403 Forbidden' for url 'https://samai.consejodeestado.gov.co/Vistas/utiles/WEstados.aspx'",
  );
}

// RPC transport is internal and service-only. No key is returned or logged.
export function internalBreakerRpc(url: string, key: string): Rpc {
  return async (name, body) => {
    const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) throw new Error(`breaker RPC ${r.status}`);
    return await r.json();
  };
}

export async function withSamaiEstadosBreaker(rpc: Rpc, run: () => Promise<ProviderAdapterResult>): Promise<ProviderAdapterResult> {
  const pending = (why: string): ProviderAdapterResult => ({ provider: 'samai_estados', status: 'ERROR',
    actuaciones: [], publicaciones: [], metadata: null, parties: null, durationMs: 0, errorMessage: why });
  let permit: Permit;
  try {
    const rows = await rpc('acquire_samai_estados_breaker', {});
    permit = Array.isArray(rows) ? rows[0] as Permit : rows as Permit;
    if (!permit || typeof permit.allowed !== 'boolean') throw new Error('invalid permit');
  } catch { return pending('PROVIDER_BREAKER_UNAVAILABLE'); }
  if (!permit.allowed) return pending(`PROVIDER_BREAKER_OPEN:${permit.retry_at ?? ''}`);
  let result: ProviderAdapterResult;
  try { result = await run(); }
  catch { result = pending('PROVIDER_NETWORK_ERROR'); }
  const valid = result.httpStatus === 200 && (result.status === 'SUCCESS' || result.status === 'EMPTY');
  // Only the shared session-init 403 opens the circuit. A case-specific
  // failure, generic 502, timeout or document error cannot pause all cases.
  const transient = result.httpStatus === 502 && result.errorMessage === 'SAMAI_ESTADOS_SESSION_403';
  try {
    const sealed = await rpc('finish_samai_estados_breaker', { _generation: permit.generation,
      _probe_token: permit.probe_token, _outcome: valid ? 'VALID_RESPONSE' : transient ? 'TRANSIENT_FAILURE' : 'OTHER_FAILURE' });
    if (sealed !== true) return pending('PROVIDER_BREAKER_LEASE_LOST');
  } catch { return pending('PROVIDER_BREAKER_UNAVAILABLE'); }
  return result;
}
