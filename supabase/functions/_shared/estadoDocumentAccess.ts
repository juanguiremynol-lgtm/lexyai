type Env = (key: string) => string | undefined;

/** Exact service origins, never service-name regexes across projects. */
export function estadoDocumentAccess(rawUrl: string, env: Env): { apiKey: string; source: 'publicaciones' | 'samai_estados' } | null {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('document_origin_not_authorized');
  const providers = [
    ['publicaciones', 'PUBLICACIONES_BASE_URL', 'https://publicaciones-procesales-api-11974381924.us-central1.run.app', 'PUBLICACIONES_X_API_KEY'],
    ['samai_estados', 'SAMAI_ESTADOS_BASE_URL', 'https://samai-estados-api-11974381924.us-central1.run.app', 'SAMAI_ESTADOS_API_KEY'],
  ] as const;
  for (const [source, baseKey, fallback, key] of providers) {
    const expected = new URL(env(baseKey) || fallback);
    if (url.origin !== expected.origin) continue;
    if (!url.pathname.startsWith('/pdf/')) throw new Error('document_path_not_authorized');
    const apiKey = env(key) || (source === 'publicaciones' ? env('EXTERNAL_X_API_KEY') : undefined);
    if (!apiKey) throw new Error('document_service_credential_missing');
    return { apiKey, source };
  }
  if (url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/andromeda-samai-documentos-2026/')) return null;
  if (url.hostname === 'samaicore.consejodeestado.gov.co' && url.pathname.startsWith('/api/DescargarProvidenciaPublica/')) return null;
  // Official Rama Judicial public portal (anonymous download, never a key).
  if (url.hostname === 'publicacionesprocesales.ramajudicial.gov.co' && url.pathname === '/c/document_library/get_file') return null;
  throw new Error('document_origin_not_authorized');
}

/** Authenticate each redirect independently; a key never follows an external
 * redirect. Unknown origins are rejected before issuing an HTTP request. */
export async function downloadEstadoDocument(url: string, env: Env, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    for (let redirect = 0; redirect <= 3; redirect++) {
      const auth = estadoDocumentAccess(url, env);
      const headers: Record<string, string> = { Accept: 'application/pdf' };
      if (auth) headers['X-API-Key'] = auth.apiKey;
      const response = await fetcher(url, { headers, signal: controller.signal, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('document_redirect_without_location');
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok) throw new Error(`origin_http_${response.status}`);
      if (Number(response.headers.get('content-length') || 0) > 40 * 1024 * 1024) throw new Error('pdf_size_outside_worker_limit');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 40 * 1024 * 1024) throw new Error('pdf_size_outside_worker_limit');
      return bytes;
    }
    throw new Error('document_redirect_limit');
  } finally {
    clearTimeout(timer);
  }
}
