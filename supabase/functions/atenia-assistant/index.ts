/**
 * atenia-assistant — Gemini-powered attending assistant for Atenia platform.
 *
 * Modes:
 *   CHAT: Answer user questions with DB context, propose safe actions
 *   EXECUTE: Execute a previously proposed allowlisted action
 *   DIAGNOSE_WORK_ITEM: One-click "why not syncing?" analysis
 *
 * Uses Lovable AI Gateway (same as provider-wizard-ai-guide).
 * Rate-limited: 20 req / 10 min / user.
 * All actions are logged to atenia_assistant_actions.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---- Rate limiting (in-memory per-isolate) ----
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ---- Action allowlist ----
const ACTION_ALLOWLIST = new Set([
  "RUN_SYNC_WORK_ITEM",
  "RUN_SYNC_PUBLICACIONES_WORK_ITEM",
  "TOGGLE_MONITORING",
  "RUN_MASTER_SYNC_SCOPE",
  "ESCALATE_TO_ADMIN_QUEUE",
  "CREATE_USER_REPORT",
  "UNLOCK_DANGER_ZONE",
  "GENERATE_PAYMENT_CERTIFICATE",
]);

// ---- Risk classification ----
function classifyRisk(actionType: string): "SAFE" | "CONFIRM_REQUIRED" {
  switch (actionType) {
    case "ESCALATE_TO_ADMIN_QUEUE":
    case "CREATE_USER_REPORT":
      return "SAFE";
    case "RUN_SYNC_WORK_ITEM":
    case "RUN_SYNC_PUBLICACIONES_WORK_ITEM":
      return "SAFE";
    case "UNLOCK_DANGER_ZONE":
      return "CONFIRM_REQUIRED";
    case "GENERATE_PAYMENT_CERTIFICATE":
      return "SAFE";
    case "TOGGLE_MONITORING":
    case "RUN_MASTER_SYNC_SCOPE":
      return "CONFIRM_REQUIRED";
    default:
      return "CONFIRM_REQUIRED";
  }
}

// ---- Secret redaction (reuse from provider-wizard-ai-guide) ----
const SECRET_SUBSTRINGS = [
  "secret", "api_key", "apikey", "hmac_secret", "token",
  "password", "authorization", "bearer", "credential", "private_key",
  "service_role", "anon_key",
];

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_SUBSTRINGS.some((s) => lower.includes(s));
}

function redactSecrets(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        result[key] = "[REDACTED]";
      } else if (typeof val === "string" && val.length > 20 && /^(sk_|pk_|Bearer |ey[A-Za-z0-9])/.test(val)) {
        result[key] = "[REDACTED_TOKEN]";
      } else {
        result[key] = redactSecrets(val);
      }
    }
    return result;
  }
  return obj;
}

// ---- System prompt ----
const SYSTEM_PROMPT = `You are Atenia AI, the attending assistant for the ATENIA legal-tech platform.

ROLE: You help users understand the status of their judicial work items (procesos), diagnose sync failures, summarize recent actuaciones/estados/alerts, and propose safe operational actions.

CRITICAL RULES (NON-NEGOTIABLE):
1. Answer ONLY from the provided CONTEXT. If information is missing, say exactly what data you need.
2. NEVER invent database fields, provider status, actuaciones, or legal events.
3. NEVER output secrets, base URLs, headers, API keys, or raw provider payloads.
4. If you propose an action, it must be one of the allowlisted types. State-changing actions must have risk=CONFIRM_REQUIRED.
5. Respond in the same language as the user's message (typically Spanish).
6. Be concise but thorough. Cite specific trace IDs, alert IDs, or dates when possible.

ALLOWLISTED ACTIONS:
- RUN_SYNC_WORK_ITEM: Trigger a sync for a specific work item
- RUN_SYNC_PUBLICACIONES_WORK_ITEM: Trigger publication sync for a work item
- TOGGLE_MONITORING: Enable/disable monitoring for a work item (CONFIRM_REQUIRED)
- RUN_MASTER_SYNC_SCOPE: Run master sync (platform admin only, CONFIRM_REQUIRED)
- ESCALATE_TO_ADMIN_QUEUE: Escalate issue to admin queue
- CREATE_USER_REPORT: Create a structured report for the supervisor panel
- UNLOCK_DANGER_ZONE: Temporarily enable the Danger Zone in Settings for 12 hours (CONFIRM_REQUIRED)
- GENERATE_PAYMENT_CERTIFICATE: Generate a payment/service certificate for the user's organization (SAFE)

BILLING & PAYMENT INQUIRY POLICY:
When a user asks about payments, invoices, subscription status, amounts paid, service certificates, or billing history:
1. You have access to billing context in the CONTEXT_JSON under "billing". Use it to answer directly.
2. "billing.subscription" contains the current subscription state (plan, status, price, period dates, trial info).
3. "billing.invoices" contains recent invoices with amounts, dates, statuses, and provider references.
4. "billing.checkout_sessions" contains completed checkout sessions with payment details.
5. When summarizing payment history, always include: amount in COP, period covered, status, and date.
6. If the user requests a "certificado de servicio", "constancia de pago", or similar, propose the GENERATE_PAYMENT_CERTIFICATE action with params: { period_from, period_to } covering the requested timeframe. If no timeframe specified, use the last 12 months.
7. For certificate generation, include a summary of: organization name, plan, total amount paid, and periods covered.
8. NEVER reveal internal billing IDs, gateway customer IDs, or provider-specific tokens.
9. All org members can view billing info. Only org admins can view detailed invoice breakdowns.

DANGER ZONE POLICY (CRITICAL):
When a user asks about deleting data, purging data, accessing the danger zone, or recovering soft-deleted items:
1. If the user is a regular member of an organization (NOT admin/owner), respond: "La recuperación de elementos eliminados y la purga de datos son funciones exclusivas del administrador de la organización. Contacte a su administrador para solicitar esta acción."
2. If the user is an org admin/owner OR has no organization, you may propose the UNLOCK_DANGER_ZONE action.
3. ALWAYS warn that: "⚠️ ADVERTENCIA: La Zona de Peligro permite eliminar datos de forma PERMANENTE e IRREVERSIBLE. El acceso se habilitará por 12 horas."
4. The action requires explicit user confirmation (risk=CONFIRM_REQUIRED).
5. Never propose UNLOCK_DANGER_ZONE proactively — only when the user explicitly requests danger zone access, data deletion, or data purge.

OUTPUT FORMAT: Always respond with valid JSON matching this structure:
{
  "answer": "<your response text>",
  "confidence": 0.0-1.0,
  "citations": [{"source": "db|trace|alert|provider", "id": "...", "note": "..."}],
  "proposed_actions": [{"type": "ACTION_TYPE", "risk": "SAFE|CONFIRM_REQUIRED", "why": "...", "params": {}}]
}`;

// ---- Context builder ----
async function buildContext(
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  scope: string,
  workItemId?: string,
) {
  const ctx: Record<string, unknown> = { scope };

  // Get user profile + org
  const { data: profile } = await userClient
    .from("profiles")
    .select("id, full_name, organization_id")
    .eq("id", userId)
    .maybeSingle();

  const orgId = profile?.organization_id;
  ctx.user = { id: userId, name: profile?.full_name, organization_id: orgId };

  // Check platform admin
  const { data: platformAdmin } = await adminClient
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  const isPlatformAdmin = !!platformAdmin;
  (ctx.user as any).is_platform_admin = isPlatformAdmin;

  // Check org admin
  if (orgId) {
    const { data: isAdmin } = await adminClient.rpc("is_org_admin", { org_id: orgId });
    (ctx.user as any).is_org_admin = !!isAdmin;
  }

  // Scope guard
  if (scope === "PLATFORM" && !isPlatformAdmin) {
    throw new Error("Forbidden: Platform scope requires platform admin role");
  }

  if (workItemId) {
    // Work item metadata
    const { data: wi } = await userClient
      .from("work_items")
      .select("id, radicado, title, status, stage, workflow_type, monitoring_enabled, monitoring_disabled_reason, scrape_status, last_synced_at, last_crawled_at, last_checked_at, last_action_date, consecutive_404_count, consecutive_failures, last_error_code, total_actuaciones, provider_sources, created_at, updated_at")
      .eq("id", workItemId)
      .maybeSingle();
    ctx.work_item = wi;

    if (wi) {
      // Latest actuaciones (from work_item_acts)
      const { data: acts } = await userClient
        .from("work_item_acts")
        .select("id, description, event_date, event_type, source_platform, created_at")
        .eq("work_item_id", workItemId)
        .order("event_date", { ascending: false })
        .limit(15);
      ctx.latest_acts = acts ?? [];

      // Latest publicaciones
      const { data: pubs } = await userClient
        .from("work_item_publicaciones")
        .select("id, description, pub_date, source_platform, created_at")
        .eq("work_item_id", workItemId)
        .order("pub_date", { ascending: false })
        .limit(10);
      ctx.latest_pubs = pubs ?? [];

      // Alerts
      const { data: alerts } = await userClient
        .from("alert_instances")
        .select("id, title, message, severity, status, fired_at, alert_type")
        .eq("entity_id", workItemId)
        .eq("entity_type", "work_item")
        .order("fired_at", { ascending: false })
        .limit(15);
      ctx.alerts = alerts ?? [];

      // Recent sync traces (last 24h, limit 30)
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: traces } = await userClient
        .from("sync_traces")
        .select("id, step, success, error_code, normalized_error_code, http_status, body_preview, latency_ms, created_at")
        .eq("work_item_id", workItemId)
        .gte("created_at", since24h)
        .order("created_at", { ascending: false })
        .limit(30);
      ctx.recent_traces = (traces ?? []).map((t: any) => redactSecrets(t));

      // External provider diagnostics (safe summary only)
      const { data: provInstances } = await userClient
        .from("provider_instances")
        .select("id, connector_id, scope, status")
        .eq("organization_id", orgId)
        .limit(10);
      ctx.provider_instances_summary = (provInstances ?? []).map((p: any) => ({
        id: p.id, connector_id: p.connector_id, scope: p.scope, status: p.status,
      }));
    }
  }

  // For ORG/PLATFORM scope: high-level health summary
  if (scope === "ORG" && orgId) {
    const { data: orgStats } = await userClient
      .from("work_items")
      .select("id, status, monitoring_enabled, scrape_status, last_error_code")
      .eq("organization_id", orgId)
      .limit(200);

    if (orgStats) {
      const total = orgStats.length;
      const monitored = orgStats.filter((w: any) => w.monitoring_enabled).length;
      const failing = orgStats.filter((w: any) => w.last_error_code && !["PROVIDER_EMPTY_RESULT"].includes(w.last_error_code)).length;
      ctx.org_health = { total_items: total, monitored, failing, sample_errors: orgStats.filter((w: any) => w.last_error_code).slice(0, 5).map((w: any) => ({ id: w.id, error: w.last_error_code })) };
    }
  }

  // ---- Billing context (available for any org member) ----
  if (orgId) {
    const billingCtx: Record<string, unknown> = {};

    // Current subscription state
    const { data: subState } = await adminClient
      .from("billing_subscription_state")
      .select("plan_code, status, billing_cycle_months, currency, current_price_cop_incl_iva, current_period_start, current_period_end, next_billing_at, trial_end_at, comped_until_at, comped_reason, created_at")
      .eq("organization_id", orgId)
      .maybeSingle();
    billingCtx.subscription = subState || null;

    // Organization name for certificates
    const { data: org } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    billingCtx.organization_name = org?.name || null;

    // Recent invoices (last 24 months, limit 50)
    const since24m = new Date(Date.now() - 24 * 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invoices } = await adminClient
      .from("billing_invoices")
      .select("id, status, currency, amount_cop_incl_iva, amount_usd, period_start, period_end, created_at, provider, hosted_invoice_url, discount_amount_cop")
      .eq("organization_id", orgId)
      .gte("created_at", since24m)
      .order("created_at", { ascending: false })
      .limit(50);
    billingCtx.invoices = (invoices ?? []).map((inv: any) => ({
      status: inv.status,
      amount_cop: inv.amount_cop_incl_iva,
      amount_usd: inv.amount_usd,
      currency: inv.currency,
      period_start: inv.period_start,
      period_end: inv.period_end,
      created_at: inv.created_at,
      discount_cop: inv.discount_amount_cop,
      has_invoice_url: !!inv.hosted_invoice_url,
    }));

    // Completed checkout sessions (last 24 months)
    const { data: sessions } = await adminClient
      .from("billing_checkout_sessions")
      .select("id, tier, status, billing_cycle_months, amount_cop_incl_iva, discount_amount_cop, completed_at, created_at, provider")
      .eq("organization_id", orgId)
      .eq("status", "COMPLETED")
      .gte("created_at", since24m)
      .order("created_at", { ascending: false })
      .limit(50);
    billingCtx.checkout_sessions = (sessions ?? []).map((s: any) => ({
      tier: s.tier,
      billing_cycle_months: s.billing_cycle_months,
      amount_cop: s.amount_cop_incl_iva,
      discount_cop: s.discount_amount_cop,
      completed_at: s.completed_at,
      created_at: s.created_at,
    }));

    // Legacy subscriptions table (for trial info)
    const { data: legacySub } = await userClient
      .from("subscriptions")
      .select("status, trial_started_at, trial_ends_at, current_period_end, canceled_at")
      .eq("organization_id", orgId)
      .maybeSingle();
    billingCtx.legacy_subscription = legacySub || null;

    ctx.billing = billingCtx;
  }

  return { ctx, orgId, isPlatformAdmin };
}

async function callGemini(system: string, userMessage: string, apiKey: string): Promise<any> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const status = response.status;
    const errText = await response.text();
    if (status === 429) throw new Error("AI_RATE_LIMITED");
    if (status === 402) throw new Error("AI_CREDITS_EXHAUSTED");
    throw new Error(`AI gateway error ${status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content || "";

  // Parse JSON from response
  try {
    const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) || rawContent.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
    return JSON.parse(jsonStr.trim());
  } catch {
    return {
      answer: rawContent.slice(0, 2000),
      confidence: 0.5,
      citations: [],
      proposed_actions: [],
    };
  }
}

// ---- Action executor ----
async function executeAction(
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  action: any,
  ctx: any,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  switch (action.type) {
    case "RUN_SYNC_WORK_ITEM": {
      const resp = await fetch(`${supabaseUrl}/functions/v1/sync-by-work-item`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ work_item_id: action.params?.work_item_id }),
      });
      const result = await resp.json().catch(() => ({ status: resp.status }));
      return { ok: resp.ok, result };
    }

    case "RUN_SYNC_PUBLICACIONES_WORK_ITEM": {
      const resp = await fetch(`${supabaseUrl}/functions/v1/sync-publicaciones-by-work-item`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ work_item_id: action.params?.work_item_id }),
      });
      const result = await resp.json().catch(() => ({ status: resp.status }));
      return { ok: resp.ok, result };
    }

    case "TOGGLE_MONITORING": {
      const enabled = action.params?.enabled;
      const reason = action.params?.reason;
      const { data, error } = await adminClient
        .from("work_items")
        .update({
          monitoring_enabled: enabled,
          monitoring_disabled_reason: enabled ? null : (reason || "Deshabilitado por asistente Atenia"),
          monitoring_disabled_at: enabled ? null : new Date().toISOString(),
          monitoring_disabled_by: enabled ? null : "atenia_assistant",
          updated_at: new Date().toISOString(),
        })
        .eq("id", action.params?.work_item_id)
        .select("id, monitoring_enabled")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { ok: true, result: data };
    }

    case "RUN_MASTER_SYNC_SCOPE": {
      if (!ctx.user?.is_platform_admin) throw new Error("Forbidden: platform admin required");
      const resp = await fetch(`${supabaseUrl}/functions/v1/scheduled-daily-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: action.params?.scope || "MONITORING_ONLY",
          organization_id: action.params?.org_id,
          force_refresh: false,
        }),
      });
      const result = await resp.json().catch(() => ({ status: resp.status }));
      return { ok: resp.ok, result };
    }

    case "ESCALATE_TO_ADMIN_QUEUE": {
      const { data, error } = await adminClient
        .from("atenia_ai_user_reports")
        .insert({
          organization_id: ctx.orgId,
          reporter_user_id: ctx.user.id,
          work_item_id: action.params?.work_item_id || null,
          description: action.params?.summary || "Escalado por asistente Atenia AI",
          report_type: "ASSISTANT_ESCALATION",
          status: "OPEN",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true, report_id: data?.id };
    }

    case "CREATE_USER_REPORT": {
      const { data, error } = await adminClient
        .from("atenia_ai_user_reports")
        .insert({
          organization_id: ctx.orgId,
          reporter_user_id: ctx.user.id,
          work_item_id: action.params?.work_item_id || null,
          description: action.params?.description || "Reporte creado por asistente",
          report_type: action.params?.report_type || "USER_REPORT",
          status: "OPEN",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true, report_id: data?.id };
    }

    case "UNLOCK_DANGER_ZONE": {
      const userId = ctx.user?.id;
      if (!userId) throw new Error("User ID required");

      // Check if user is org admin or has no org
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;
      const hasOrg = !!(ctx.user as any)?.organization_id;

      if (hasOrg && !isOrgAdmin) {
        throw new Error("Solo administradores de la organización pueden acceder a la Zona de Peligro.");
      }

      // Insert 12-hour unlock
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const { data, error } = await adminClient
        .from("danger_zone_unlocks")
        .insert({
          user_id: userId,
          granted_by: "atenia_assistant",
          expires_at: expiresAt,
        })
        .select("id, expires_at")
        .single();

      if (error) throw new Error(error.message);
      return { ok: true, unlock_id: data?.id, expires_at: data?.expires_at };
    }

    case "GENERATE_PAYMENT_CERTIFICATE": {
      const orgId = ctx.orgId;
      if (!orgId) throw new Error("Se requiere una organización para generar certificados.");

      const periodFrom = action.params?.period_from || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const periodTo = action.params?.period_to || new Date().toISOString().slice(0, 10);

      // Fetch organization
      const { data: org } = await adminClient
        .from("organizations")
        .select("name, metadata")
        .eq("id", orgId)
        .maybeSingle();

      // Fetch subscription state
      const { data: subState } = await adminClient
        .from("billing_subscription_state")
        .select("plan_code, status, billing_cycle_months, currency, current_price_cop_incl_iva, current_period_start, current_period_end, created_at")
        .eq("organization_id", orgId)
        .maybeSingle();

      // Fetch paid invoices in period
      const { data: invoices } = await adminClient
        .from("billing_invoices")
        .select("id, status, amount_cop_incl_iva, amount_usd, currency, period_start, period_end, created_at")
        .eq("organization_id", orgId)
        .in("status", ["paid", "PAID", "completed", "COMPLETED"])
        .gte("created_at", periodFrom)
        .lte("created_at", periodTo + "T23:59:59Z")
        .order("created_at", { ascending: true });

      // Fetch completed checkouts in period
      const { data: checkouts } = await adminClient
        .from("billing_checkout_sessions")
        .select("id, tier, amount_cop_incl_iva, discount_amount_cop, billing_cycle_months, completed_at, created_at")
        .eq("organization_id", orgId)
        .eq("status", "COMPLETED")
        .gte("created_at", periodFrom)
        .lte("created_at", periodTo + "T23:59:59Z")
        .order("created_at", { ascending: true });

      const paidInvoices = invoices ?? [];
      const completedCheckouts = checkouts ?? [];

      const totalPaidInvoices = paidInvoices.reduce((sum: number, inv: any) => sum + (inv.amount_cop_incl_iva || 0), 0);
      const totalPaidCheckouts = completedCheckouts.reduce((sum: number, s: any) => sum + (s.amount_cop_incl_iva || 0), 0);
      const totalPaid = totalPaidInvoices + totalPaidCheckouts;
      const totalDiscounts = completedCheckouts.reduce((sum: number, s: any) => sum + (s.discount_amount_cop || 0), 0);

      const certificate = {
        type: "CERTIFICADO_DE_SERVICIO",
        generated_at: new Date().toISOString(),
        organization: {
          name: org?.name || "N/A",
          id: orgId,
        },
        subscription: subState ? {
          plan: subState.plan_code,
          status: subState.status,
          billing_cycle_months: subState.billing_cycle_months,
          current_price_cop: subState.current_price_cop_incl_iva,
          currency: subState.currency,
          period_start: subState.current_period_start,
          period_end: subState.current_period_end,
          member_since: subState.created_at,
        } : null,
        period: { from: periodFrom, to: periodTo },
        payment_summary: {
          total_paid_cop: totalPaid,
          total_discounts_cop: totalDiscounts,
          net_paid_cop: totalPaid - totalDiscounts,
          invoice_count: paidInvoices.length,
          checkout_count: completedCheckouts.length,
        },
        invoices: paidInvoices.map((inv: any) => ({
          amount_cop: inv.amount_cop_incl_iva,
          period: `${inv.period_start || "N/A"} - ${inv.period_end || "N/A"}`,
          date: inv.created_at,
          status: inv.status,
        })),
        checkouts: completedCheckouts.map((s: any) => ({
          tier: s.tier,
          amount_cop: s.amount_cop_incl_iva,
          discount_cop: s.discount_amount_cop,
          billing_months: s.billing_cycle_months,
          completed_at: s.completed_at,
        })),
        disclaimer: "Este certificado es generado automáticamente por la plataforma ATENIA y refleja los registros de facturación del sistema. Para certificados oficiales con validez tributaria, contacte a soporte.",
      };

      return { ok: true, certificate };
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

// ---- Main handler ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Max 20 requests per 10 minutes." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? "CHAT";
    const message = String(body.message ?? "");
    const scope = body.scope ?? "WORK_ITEM";
    const workItemId = body.work_item_id as string | undefined;
    const sessionId = body.session_id as string | undefined;

    // Build context
    const { ctx, orgId, isPlatformAdmin } = await buildContext(userClient, adminClient, user.id, scope, workItemId);

    // ---- EXECUTE mode ----
    if (mode === "EXECUTE") {
      const action = body.action;
      if (!action?.type || !ACTION_ALLOWLIST.has(action.type)) {
        return respond({ error: "Action type not allowed" }, 400);
      }

      const risk = classifyRisk(action.type);
      if (risk === "CONFIRM_REQUIRED" && !body.confirmed) {
        return respond({ error: "CONFIRMATION_REQUIRED", risk, action_type: action.type }, 400);
      }

      try {
        const result = await executeAction(userClient, adminClient, action, { ...ctx, orgId });

        // Log action
        await adminClient.from("atenia_assistant_actions").insert({
          session_id: sessionId || null,
          organization_id: orgId,
          user_id: user.id,
          action_type: action.type,
          work_item_id: action.params?.work_item_id || workItemId || null,
          input: redactSecrets(action.params || {}),
          context_summary: `scope=${scope}, wi=${workItemId || "N/A"}`,
          result: redactSecrets(result),
          status: "EXECUTED",
        });

        return respond({ ok: true, action_type: action.type, result });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";

        // Log failed action
        await adminClient.from("atenia_assistant_actions").insert({
          session_id: sessionId || null,
          organization_id: orgId,
          user_id: user.id,
          action_type: action.type,
          work_item_id: action.params?.work_item_id || workItemId || null,
          input: redactSecrets(action.params || {}),
          result: { error: errMsg },
          status: "FAILED",
        });

        return respond({ ok: false, error: errMsg }, 500);
      }
    }

    // ---- CHAT / DIAGNOSE_WORK_ITEM mode ----
    if (!lovableApiKey) {
      return respond({
        answer: "El servicio de IA no está configurado. Contacte al administrador.",
        confidence: 0,
        citations: [],
        proposed_actions: [],
      });
    }

    // Find or create session
    let activeSessionId = sessionId;
    if (!activeSessionId && orgId) {
      const { data: session } = await adminClient
        .from("atenia_assistant_sessions")
        .insert({
          organization_id: orgId,
          user_id: user.id,
          scope,
          work_item_id: workItemId || null,
        })
        .select("id")
        .single();
      activeSessionId = session?.id;
    }

    // Build user message
    let userMessage = message;
    if (mode === "DIAGNOSE_WORK_ITEM") {
      userMessage = message || "Analiza este item de trabajo. ¿Por qué no se está actualizando? ¿Cuál es su estado actual de sincronización? ¿Qué debería hacer el usuario?";
    }

    const contextJson = JSON.stringify(redactSecrets(ctx));
    const fullMessage = `CONTEXT_JSON (${contextJson.length} chars):\n${contextJson.slice(0, 100000)}\n\nUSER_MESSAGE:\n${userMessage}`;

    // Store user message
    if (activeSessionId) {
      await adminClient.from("atenia_assistant_messages").insert({
        session_id: activeSessionId,
        role: "user",
        content: userMessage.slice(0, 10000),
        meta: { mode, work_item_id: workItemId },
      });
    }

    // Call Gemini
    const agentOut = await callGemini(SYSTEM_PROMPT, fullMessage, lovableApiKey);

    // Post-validate: strip any disallowed actions
    if (agentOut.proposed_actions) {
      agentOut.proposed_actions = agentOut.proposed_actions
        .filter((a: any) => ACTION_ALLOWLIST.has(a.type))
        .map((a: any) => ({
          ...a,
          risk: classifyRisk(a.type),
          params: {
            ...a.params,
            work_item_id: a.params?.work_item_id || workItemId,
          },
        }));
    }

    // Store assistant message
    if (activeSessionId) {
      await adminClient.from("atenia_assistant_messages").insert({
        session_id: activeSessionId,
        role: "assistant",
        content: JSON.stringify(agentOut).slice(0, 10000),
        meta: { model: "gemini-3-flash-preview", confidence: agentOut.confidence },
      });

      // Update session timestamp
      await adminClient
        .from("atenia_assistant_sessions")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", activeSessionId);
    }

    return respond({
      ok: true,
      session_id: activeSessionId,
      answer: agentOut.answer,
      confidence: agentOut.confidence ?? 0.5,
      citations: agentOut.citations ?? [],
      proposed_actions: agentOut.proposed_actions ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("atenia-assistant error:", msg);

    if (msg === "AI_RATE_LIMITED") {
      return respond({ error: "AI rate limit exceeded, please try again later." }, 429);
    }
    if (msg === "AI_CREDITS_EXHAUSTED") {
      return respond({ error: "AI credits exhausted." }, 402);
    }

    return respond({ error: msg }, 500);
  }
});

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
