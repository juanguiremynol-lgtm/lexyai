/**
 * Server-to-server edge function call with explicit service identity.
 *
 * supabase-js >= 2.9x `functions.invoke` omits `Authorization: Bearer <key>`
 * for opaque (`sb_secret_`) keys, sending only `apikey`. Scheduled callees
 * (e.g. sync-by-work-item `_scheduled`) require a verified bearer or cron
 * header, so implicit invokes were rejected as CALLER_UNAUTHORIZED.
 * Never log the key.
 */
export async function invokeInternal(
  functionName: string,
  body: Record<string, unknown>,
  invoker: string,
  opts: { taskId?: string | null; timeoutMs?: number } = {},
): Promise<{ data: any; error: Error | null; status: number }> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return { data: null, error: new Error("Missing service configuration"), status: 0 };
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json",
    "x-invoker-function": invoker,
  };
  if (opts.taskId) headers["x-retry-task-id"] = opts.taskId;
  try {
    const res = await fetch(`${url}/functions/v1/${functionName}`, {
      method: "POST", headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 110_000),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
    const error = res.ok ? null : new Error(`${functionName} HTTP ${res.status}: ${(data?.code ?? data?.error ?? "").toString().slice(0, 120)}`);
    return { data, error, status: res.status };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error(String(e)), status: 0 };
  }
}
