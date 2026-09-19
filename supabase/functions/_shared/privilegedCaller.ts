/**
 * privilegedCaller — one gate in front of every service-role background job.
 *
 * AUDIT FINDING 2. Functions such as `scheduled-daily-digest`,
 * `process-email-outbox`, `outlook-token-refresh` and `digest-failure-watchdog`
 * run with `verify_jwt = false` (they are invoked by pg_cron and by each other,
 * which cannot present a user JWT). Disabling the gateway check is fine; what is
 * not fine is doing no check at all and then instantiating a service-role client.
 *
 * `requirePrivilegedCaller` must be called BEFORE any database read, write, run
 * claim, heartbeat or credential operation. A rejected request leaves no trace:
 * no outbox row, no run slot, no telemetry.
 *
 * Accepted identities:
 *   1. the dedicated cron secret in `x-cron-key` (see `cronAuth.ts`);
 *   2. a bearer token equal to the service-role key (function-to-function hops);
 *   3. a bearer JWT whose `role` claim is `service_role`.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { isCronCaller } from "./cronAuth.ts";

export type PrivilegedIdentity = "CRON_KEY" | "SERVICE_KEY" | "SERVICE_JWT";

export interface PrivilegedCallerResult {
  ok: boolean;
  identity: PrivilegedIdentity | null;
  /** Ready-to-return rejection; present only when `ok` is false. */
  response: Response | null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** True when the request carries a service-role identity. Never throws. */
export async function isPrivilegedCaller(req: Request): Promise<PrivilegedIdentity | null> {
  if (isCronCaller(req)) return "CRON_KEY";

  const token = bearer(req);
  if (!token) return null;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && timingSafeEqual(token, serviceKey)) return "SERVICE_KEY";

  // A distinct-but-valid service_role JWT (e.g. a rotated key) still qualifies.
  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await client.auth.getClaims(token);
    const claims = data?.claims as Record<string, unknown> | undefined;
    if (!error && claims?.role === "service_role") return "SERVICE_JWT";
  } catch (_e) {
    // fall through to rejection
  }
  return null;
}

/** True when the bearer token is a valid signed-in end user (not anonymous). */
export async function isAuthenticatedUser(req: Request): Promise<boolean> {
  const token = bearer(req);
  if (!token) return false;
  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await client.auth.getClaims(token);
    const claims = data?.claims as Record<string, unknown> | undefined;
    return !error && typeof claims?.sub === "string";
  } catch (_e) {
    return false;
  }
}

/**
 * Gate a privileged handler. Call this first; return `result.response` when
 * `ok` is false and do nothing else.
 *
 * `allowAuthenticatedUser` is for workers that a signed-in user may legitimately
 * nudge (the outbox drain fires right after a lawyer presses "send"). It still
 * shuts out anonymous callers, which is the finding being closed.
 */
export async function requirePrivilegedCaller(
  req: Request,
  corsHeaders: Record<string, string> = {},
  opts: { allowAuthenticatedUser?: boolean } = {},
): Promise<PrivilegedCallerResult> {
  const identity = await isPrivilegedCaller(req);
  if (identity) return { ok: true, identity, response: null };

  if (opts.allowAuthenticatedUser && (await isAuthenticatedUser(req))) {
    return { ok: true, identity: "SERVICE_JWT", response: null };
  }

  return {
    ok: false,
    identity: null,
    response: new Response(
      JSON.stringify({
        ok: false,
        error: "unauthorized",
        detail: "This endpoint accepts only the scheduled-job or service identity.",
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    ),
  };
}

