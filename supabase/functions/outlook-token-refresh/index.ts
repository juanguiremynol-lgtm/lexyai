/**
 * outlook-token-refresh — Proactive renewal of every live mailbox grant.
 *
 * Microsoft access tokens live about an hour. Until now they were only renewed
 * opportunistically, inside outlook-sync, which meant a grant could rot for
 * weeks without a single recorded attempt. This function runs on its own cron
 * and renews any connection whose token expires within the skew window, so the
 * failure surfaces the same day it happens instead of at the next sync attempt.
 *
 * It never touches REVOKED connections: a dead grant needs the lawyer, not a
 * retry. Tokens are never logged.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  ensureAccessToken,
  ConnectionRevokedError,
  REFRESH_SKEW_MS,
} from "../_shared/outlookGraph.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const horizon = new Date(Date.now() + REFRESH_SKEW_MS).toISOString();

  const { data: rows, error } = await admin
    .from("user_email_connections")
    .select(
      "id, user_id, ms_account_email, status, scopes, token_expires_at, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, refresh_failure_count",
    )
    .eq("provider", "outlook")
    .in("status", ["CONNECTED", "ERROR"])
    .not("refresh_token_cipher", "is", null)
    .or(`token_expires_at.is.null,token_expires_at.lte.${horizon}`);

  if (error) return json({ ok: false, error: error.message }, 500);

  const results: Array<{ id: string; outcome: string; code?: string }> = [];
  for (const conn of rows ?? []) {
    try {
      await ensureAccessToken(admin, conn as never);
      results.push({ id: conn.id, outcome: "REFRESHED" });
    } catch (e) {
      const code = e instanceof ConnectionRevokedError ? e.code : "UNKNOWN";
      // The row already carries the classified failure; here we only report.
      console.error(`[outlook-token-refresh] ${conn.id} failed: ${code}`);
      results.push({ id: conn.id, outcome: "FAILED", code });
    }
  }

  return json({
    ok: true,
    checked: rows?.length ?? 0,
    refreshed: results.filter((r) => r.outcome === "REFRESHED").length,
    failed: results.filter((r) => r.outcome === "FAILED").length,
    results,
  });
});
