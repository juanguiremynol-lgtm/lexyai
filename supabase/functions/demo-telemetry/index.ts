/**
 * demo-telemetry — Server-side analytics + rate-limit guard for demo lookups.
 *
 * Endpoints:
 *   POST /demo-telemetry { action: "event", events: [...] }   → log analytics events
 *   POST /demo-telemetry { action: "rate-check", ip_hint: string } → check rate limit (called by demo-radicado-lookup)
 *
 * Security:
 *   - No auth required (public demo)
 *   - PII redaction: IP hashed with server-side salt, no raw radicado stored
 *   - Writes use service_role only
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Server-side salt for hashing — stable per deployment
const HASH_SALT = Deno.env.get("DEMO_HASH_SALT") || "andromeda-demo-salt-2025";

// Rate limit defaults (adjustable via env)
const RL_IP_HOUR = parseInt(Deno.env.get("DEMO_RL_IP_HOUR") || "30", 10);
const RL_IP_DAY = parseInt(Deno.env.get("DEMO_RL_IP_DAY") || "120", 10);
const RL_SESSION_HOUR = parseInt(Deno.env.get("DEMO_RL_SESSION_HOUR") || "12", 10);
const RL_RADICADO_HOUR = parseInt(Deno.env.get("DEMO_RL_RADICADO_HOUR") || "20", 10);

const VALID_EVENTS = new Set([
  "demo_view",
  "demo_lookup_submitted",
  "demo_lookup_result",
  "demo_cta_clicked",
  "demo_rate_limited",
]);

const VALID_UA_BUCKETS = new Set(["mobile", "tablet", "desktop", "unknown"]);

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashIp(ip: string): Promise<string> {
  return sha256Hex(HASH_SALT + ip);
}

async function hashRadicado(radicado: string): Promise<string> {
  return sha256Hex(HASH_SALT + radicado.replace(/\D/g, ""));
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function sanitizeString(val: unknown, maxLen: number): string | null {
  if (typeof val !== "string") return null;
  return val.slice(0, maxLen).replace(/[<>"']/g, "");
}

function sanitizeInt(val: unknown, min = 0, max = 100000): number | null {
  const n = typeof val === "number" ? val : parseInt(String(val), 10);
  if (isNaN(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ═══════════════════════════════════════════
// RATE LIMITING (Postgres-backed)
// ═══════════════════════════════════════════

interface RateLimitCheck {
  allowed: boolean;
  retry_after_seconds: number;
  reason?: string;
}

async function checkRateLimits(
  supabase: ReturnType<typeof getServiceClient>,
  ipHash: string,
  sessionId: string | null,
  radicadoHash: string | null,
): Promise<RateLimitCheck> {
  const now = new Date();
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  // Check all limits in parallel
  const checks = await Promise.all([
    getCounter(supabase, `ip:${ipHash}`, hourStart, "hour"),
    getCounter(supabase, `ip:${ipHash}`, dayStart, "day"),
    sessionId ? getCounter(supabase, `session:${sessionId}`, hourStart, "hour") : Promise.resolve(0),
    radicadoHash ? getCounter(supabase, `rad:${radicadoHash}`, hourStart, "hour") : Promise.resolve(0),
  ]);

  const [ipHour, ipDay, sessionHour, radicadoHour] = checks;

  if (ipHour >= RL_IP_HOUR) {
    const retryAfter = Math.ceil((hourStart.getTime() + 3600000 - now.getTime()) / 1000);
    return { allowed: false, retry_after_seconds: Math.max(60, retryAfter), reason: "ip_hour" };
  }
  if (ipDay >= RL_IP_DAY) {
    const retryAfter = Math.ceil((dayStart.getTime() + 86400000 - now.getTime()) / 1000);
    return { allowed: false, retry_after_seconds: Math.max(60, retryAfter), reason: "ip_day" };
  }
  if (sessionId && sessionHour >= RL_SESSION_HOUR) {
    return { allowed: false, retry_after_seconds: 600, reason: "session_hour" };
  }
  if (radicadoHash && radicadoHour >= RL_RADICADO_HOUR) {
    return { allowed: false, retry_after_seconds: 300, reason: "radicado_hour" };
  }

  return { allowed: true, retry_after_seconds: 0 };
}

async function incrementCounters(
  supabase: ReturnType<typeof getServiceClient>,
  ipHash: string,
  sessionId: string | null,
  radicadoHash: string | null,
): Promise<void> {
  const now = new Date();
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const ops = [
    upsertCounter(supabase, `ip:${ipHash}`, hourStart, "hour"),
    upsertCounter(supabase, `ip:${ipHash}`, dayStart, "day"),
  ];
  if (sessionId) ops.push(upsertCounter(supabase, `session:${sessionId}`, hourStart, "hour"));
  if (radicadoHash) ops.push(upsertCounter(supabase, `rad:${radicadoHash}`, hourStart, "hour"));

  await Promise.all(ops);
}

async function getCounter(
  supabase: ReturnType<typeof getServiceClient>,
  key: string,
  windowStart: Date,
  windowType: string,
): Promise<number> {
  const { data } = await supabase
    .from("demo_rate_limit_counters")
    .select("count")
    .eq("key", key)
    .eq("window_start", windowStart.toISOString())
    .eq("window_type", windowType)
    .maybeSingle();
  return data?.count || 0;
}

async function upsertCounter(
  supabase: ReturnType<typeof getServiceClient>,
  key: string,
  windowStart: Date,
  windowType: string,
): Promise<void> {
  // Try insert first, then update on conflict
  const { error } = await supabase
    .from("demo_rate_limit_counters")
    .upsert(
      {
        key,
        window_start: windowStart.toISOString(),
        window_type: windowType,
        count: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key,window_start,window_type", ignoreDuplicates: false },
    )
    .select("id")
    .maybeSingle();

  if (error && error.code === "23505") {
    // Race condition: increment existing
    const { data: existing } = await supabase
      .from("demo_rate_limit_counters")
      .select("id, count")
      .eq("key", key)
      .eq("window_start", windowStart.toISOString())
      .eq("window_type", windowType)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("demo_rate_limit_counters")
        .update({ count: existing.count + 1, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
  }
}

// ═══════════════════════════════════════════
// EVENT LOGGING
// ═══════════════════════════════════════════

interface DemoEvent {
  event_name: string;
  session_id?: string;
  route?: string;
  variant?: string;
  frame?: string;
  referrer_domain?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  user_agent_bucket?: string;
  outcome?: string;
  category_inferred?: string;
  confidence?: string;
  cta_type?: string;
  radicado_hash?: string;
  radicado_length?: number;
  providers_checked?: number;
  providers_with_data?: number;
  latency_ms?: number;
  has_estados?: boolean;
  has_actuaciones?: boolean;
  conflicts_count?: number;
}

async function logEvents(
  supabase: ReturnType<typeof getServiceClient>,
  events: DemoEvent[],
  ipHash: string,
): Promise<void> {
  const rows = events
    .filter((e) => VALID_EVENTS.has(e.event_name))
    .slice(0, 10) // max 10 events per batch
    .map((e) => ({
      event_name: e.event_name,
      session_id: sanitizeString(e.session_id, 36),
      route: sanitizeString(e.route, 50),
      variant: sanitizeString(e.variant, 20),
      frame: sanitizeString(e.frame, 20),
      referrer_domain: sanitizeString(e.referrer_domain, 100),
      utm_source: sanitizeString(e.utm_source, 50),
      utm_medium: sanitizeString(e.utm_medium, 50),
      utm_campaign: sanitizeString(e.utm_campaign, 100),
      user_agent_bucket: VALID_UA_BUCKETS.has(e.user_agent_bucket || "") ? e.user_agent_bucket : "unknown",
      outcome: sanitizeString(e.outcome, 30),
      category_inferred: sanitizeString(e.category_inferred, 30),
      confidence: sanitizeString(e.confidence, 20),
      cta_type: sanitizeString(e.cta_type, 30),
      radicado_hash: sanitizeString(e.radicado_hash, 64),
      radicado_length: sanitizeInt(e.radicado_length, 0, 50),
      providers_checked: sanitizeInt(e.providers_checked, 0, 20),
      providers_with_data: sanitizeInt(e.providers_with_data, 0, 20),
      latency_ms: sanitizeInt(e.latency_ms, 0, 120000),
      has_estados: typeof e.has_estados === "boolean" ? e.has_estados : null,
      has_actuaciones: typeof e.has_actuaciones === "boolean" ? e.has_actuaciones : null,
      conflicts_count: sanitizeInt(e.conflicts_count, 0, 100),
      ip_hash: ipHash,
    }));

  if (rows.length > 0) {
    await supabase.from("demo_events").insert(rows);
  }
}

// ═══════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  if (req.method === "GET") {
    return json({ ok: true }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();

    // Health check via POST
    if (body.health_check) {
      return json({ ok: true }, 200);
    }

    // ═══ PRE-LAUNCH GATE (server-side enforcement) ═══
    const LAUNCH_AT = new Date("2026-03-01T05:00:00Z");
    const launchMode = Deno.env.get("LAUNCH_MODE") || "AUTO";
    const isPrelaunch = launchMode === "FORCE_PRELAUNCH" || (launchMode !== "FORCE_LIVE" && new Date() < LAUNCH_AT);
    if (isPrelaunch && body.action === "rate-check") {
      return json({
        blocked: true,
        reason: "PRELAUNCH",
        launchAt: LAUNCH_AT.toISOString(),
      }, 403);
    }

    const supabase = getServiceClient();
    const ip = getClientIp(req);
    const ipHash = await hashIp(ip);

    const action = body.action;

    // ── ACTION: rate-check ──
    // Called by demo-radicado-lookup BEFORE fan-out
    if (action === "rate-check") {
      const sessionId = sanitizeString(body.session_id, 36);
      const radicadoRaw = body.radicado ? String(body.radicado).replace(/\D/g, "") : null;
      const radicadoHash = radicadoRaw ? await hashRadicado(radicadoRaw) : null;

      const check = await checkRateLimits(supabase, ipHash, sessionId, radicadoHash);

      if (!check.allowed) {
        // Log rate-limit event
        await logEvents(supabase, [{
          event_name: "demo_rate_limited",
          session_id: sessionId || undefined,
          route: sanitizeString(body.route, 50) || undefined,
        }], ipHash).catch(() => {});

        return json({
          allowed: false,
          retry_after_seconds: check.retry_after_seconds,
          reason: check.reason,
        }, 200);
      }

      // Increment counters on success
      await incrementCounters(supabase, ipHash, sessionId, radicadoHash);

      return json({ allowed: true, retry_after_seconds: 0 }, 200);
    }

    // ── ACTION: event ──
    // Called by client-side to log analytics events
    if (action === "event") {
      const events = Array.isArray(body.events) ? body.events : [body];
      
      // Hash radicado if present in any event
      for (const evt of events) {
        if (evt.radicado_raw) {
          evt.radicado_hash = await hashRadicado(evt.radicado_raw);
          delete evt.radicado_raw;
        }
      }

      await logEvents(supabase, events, ipHash);
      return json({ ok: true }, 200);
    }

    return json({ error: "Unknown action" }, 400);

  } catch (err) {
    console.error("[demo-telemetry] Error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
