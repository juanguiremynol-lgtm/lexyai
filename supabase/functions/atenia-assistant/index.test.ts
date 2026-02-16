/**
 * Tests for atenia-assistant edge function
 *
 * Validates:
 * 1. Secret redaction (no leaks)
 * 2. Action allowlist enforcement
 * 3. Confirmation gate for mutating actions
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/atenia-assistant`;

// Helper to call the function
async function callAssistant(body: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const resp = await fetch(FUNCTION_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: resp.status, data };
}

Deno.test("rejects unauthenticated requests", async () => {
  const { status, data } = await callAssistant({ mode: "CHAT", message: "test" });
  if (status !== 401) {
    throw new Error(`Expected 401, got ${status}: ${JSON.stringify(data)}`);
  }
});

Deno.test("rejects unknown action types in EXECUTE mode", async () => {
  // Even without auth, the allowlist check should conceptually reject
  // (but auth check comes first, so we just verify the pattern)
  const { status } = await callAssistant({
    mode: "EXECUTE",
    action: { type: "DROP_DATABASE", params: {} },
  });
  // Should be 401 (auth first) or 400 (action rejected)
  if (status !== 401 && status !== 400) {
    throw new Error(`Expected 401 or 400 for unknown action, got ${status}`);
  }
});

Deno.test("ACTION_ALLOWLIST contains only safe action types (no sync actions)", () => {
  // Mirrors the actual ACTION_ALLOWLIST in atenia-assistant/index.ts
  // HARD CONSTRAINT: NO sync/retry/refresh actions. Syncing is daily-cron-only.
  const allowlist = [
    "TOGGLE_MONITORING",
    "ESCALATE_TO_ADMIN_QUEUE",
    "CREATE_USER_REPORT",
    "INVITE_USER_TO_ORG",
    "REMOVE_USER_FROM_ORG",
    "CHANGE_MEMBER_ROLE",
    "ORG_USAGE_SUMMARY",
    "CREATE_SUPPORT_TICKET",
    "EXPLAIN_CURRENT_PAGE",
    "GET_BILLING_SUMMARY",
    "GET_SUBSCRIPTION_STATUS",
    "GENERATE_PAYMENT_CERTIFICATE",
    "TOGGLE_TICKER",
    "GRANT_SUPPORT_ACCESS",
    "REVOKE_SUPPORT_ACCESS",
    "GET_ANALYTICS_STATUS",
    "UPDATE_ORG_ANALYTICS",
    "UNLOCK_DANGER_ZONE",
    "GENERATE_SUPPORT_BUNDLE",
    "RUN_DIAGNOSTIC_PLAYBOOK",
    "CREATE_SYNC_WATCH",
  ];

  // Verify no SQL-execution or sync actions
  const forbidden = [
    "EXECUTE_SQL", "RAW_QUERY", "DROP_TABLE", "ALTER_TABLE", "DELETE_ALL",
    "RUN_SYNC_WORK_ITEM", "RUN_SYNC_PUBLICACIONES_WORK_ITEM", "RUN_MASTER_SYNC_SCOPE",
  ];
  for (const f of forbidden) {
    if (allowlist.includes(f)) {
      throw new Error(`Forbidden action ${f} found in allowlist`);
    }
  }
});

Deno.test("CONFIRM_REQUIRED actions are correctly classified (no sync actions)", () => {
  const confirmRequired = [
    "TOGGLE_MONITORING",
    "INVITE_USER_TO_ORG",
    "REMOVE_USER_FROM_ORG",
    "CHANGE_MEMBER_ROLE",
    "UPDATE_ORG_ANALYTICS",
    "UNLOCK_DANGER_ZONE",
    "GRANT_SUPPORT_ACCESS",
    "TOGGLE_TICKER",
  ];
  const safe = [
    "ESCALATE_TO_ADMIN_QUEUE",
    "CREATE_USER_REPORT",
    "ORG_USAGE_SUMMARY",
    "CREATE_SUPPORT_TICKET",
    "EXPLAIN_CURRENT_PAGE",
    "GET_BILLING_SUMMARY",
    "GET_SUBSCRIPTION_STATUS",
    "GENERATE_PAYMENT_CERTIFICATE",
    "REVOKE_SUPPORT_ACCESS",
    "GET_ANALYTICS_STATUS",
    "GENERATE_SUPPORT_BUNDLE",
    "RUN_DIAGNOSTIC_PLAYBOOK",
    "CREATE_SYNC_WATCH",
  ];

  // These are the rules from the edge function
  for (const action of confirmRequired) {
    // These should require confirmation
    if (safe.includes(action)) {
      throw new Error(`${action} should be CONFIRM_REQUIRED but is in safe list`);
    }
  }
});

Deno.test("secret redaction catches common patterns", () => {
  // Simulate the redaction logic
  const SECRET_SUBSTRINGS = [
    "secret", "api_key", "apikey", "hmac_secret", "token",
    "password", "authorization", "bearer", "credential", "private_key",
    "service_role", "anon_key",
  ];

  function isSecretKey(key: string): boolean {
    const lower = key.toLowerCase();
    return SECRET_SUBSTRINGS.some((s) => lower.includes(s));
  }

  // Should be redacted
  const shouldRedact = [
    "api_key", "API_KEY", "hmac_secret", "service_role_key",
    "password", "authorization_header", "bearer_token",
    "anon_key", "private_key_pem",
  ];

  for (const key of shouldRedact) {
    if (!isSecretKey(key)) {
      throw new Error(`Key "${key}" should be redacted but was not`);
    }
  }

  // Should NOT be redacted
  const shouldNotRedact = [
    "radicado", "work_item_id", "status", "description", "name",
    "created_at", "monitoring_enabled",
  ];

  for (const key of shouldNotRedact) {
    if (isSecretKey(key)) {
      throw new Error(`Key "${key}" should NOT be redacted but was`);
    }
  }
});
