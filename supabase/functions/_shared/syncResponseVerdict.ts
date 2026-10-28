/** An explicit negative verdict must win over a transport-level HTTP 2xx. */
export function syncResponseOk(httpOk: boolean, body: unknown): boolean {
  if (!httpOk) return false;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const result = body as Record<string, unknown>;
  if (result.ok === false || result.success === false) return false;
  return result.ok === true || result.success === true;
}
