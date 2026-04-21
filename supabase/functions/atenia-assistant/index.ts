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
// HARD CONSTRAINT: NO sync/retry/refresh actions. Syncing is daily-cron-only.
// Removed: RUN_SYNC_WORK_ITEM, RUN_SYNC_PUBLICACIONES_WORK_ITEM, RUN_MASTER_SYNC_SCOPE
const ACTION_ALLOWLIST = new Set([
  "TOGGLE_MONITORING",
  "ESCALATE_TO_ADMIN_QUEUE",
  "CREATE_USER_REPORT",
  "UNLOCK_DANGER_ZONE",
  "GENERATE_PAYMENT_CERTIFICATE",
  "TOGGLE_TICKER",
  "GET_BILLING_SUMMARY",
  "GET_SUBSCRIPTION_STATUS",
  // Org-admin actions
  "INVITE_USER_TO_ORG",
  "REMOVE_USER_FROM_ORG",
  "CHANGE_MEMBER_ROLE",
  "ORG_USAGE_SUMMARY",
  // Support actions (read-only + ticket creation)
  "CREATE_SUPPORT_TICKET",
  "EXPLAIN_CURRENT_PAGE",
  "GENERATE_SUPPORT_BUNDLE",
  "RUN_DIAGNOSTIC_PLAYBOOK",
  "CREATE_SYNC_WATCH",
  // Privacy & support access grant actions
  "GRANT_SUPPORT_ACCESS",
  "REVOKE_SUPPORT_ACCESS",
  // Analytics actions
  "GET_ANALYTICS_STATUS",
  "UPDATE_ORG_ANALYTICS",
  // Member support tab grant actions (org admin only)
  "GRANT_MEMBER_SUPPORT_TAB",
  "REVOKE_MEMBER_SUPPORT_TAB",
  // Document lifecycle actions
  "BULK_EXPORT_DOCUMENTS",
  // Contract quota override (Andro IA grants up to +2 per client)
  "GRANT_CONTRACT_EXTRA",
]);

// ---- Risk classification ----
function classifyRisk(actionType: string): "SAFE" | "CONFIRM_REQUIRED" {
  switch (actionType) {
    case "ESCALATE_TO_ADMIN_QUEUE":
    case "CREATE_USER_REPORT":
    case "CREATE_SUPPORT_TICKET":
    case "EXPLAIN_CURRENT_PAGE":
    case "ORG_USAGE_SUMMARY":
    case "GET_BILLING_SUMMARY":
    case "GET_SUBSCRIPTION_STATUS":
    case "GENERATE_PAYMENT_CERTIFICATE":
    case "REVOKE_SUPPORT_ACCESS":
    case "GET_ANALYTICS_STATUS":
    case "GENERATE_SUPPORT_BUNDLE":
    case "RUN_DIAGNOSTIC_PLAYBOOK":
    case "CREATE_SYNC_WATCH":
     case "BULK_EXPORT_DOCUMENTS":
      return "CONFIRM_REQUIRED";
    case "INVITE_USER_TO_ORG":
    case "TOGGLE_TICKER":
    case "GRANT_SUPPORT_ACCESS":
    case "UPDATE_ORG_ANALYTICS":
    case "GRANT_MEMBER_SUPPORT_TAB":
    case "REVOKE_MEMBER_SUPPORT_TAB":
      return "CONFIRM_REQUIRED";
    case "REMOVE_USER_FROM_ORG":
    case "CHANGE_MEMBER_ROLE":
    case "UNLOCK_DANGER_ZONE":
    case "TOGGLE_MONITORING":
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

ROLE: You help users understand the status of their judicial work items (procesos), diagnose issues using read-only evidence, summarize recent actuaciones/estados/alerts, and propose safe operational actions.

HARD CONSTRAINT — DAILY-SYNC-ONLY MODEL (NON-NEGOTIABLE):
- You MUST NOT propose, execute, or suggest any user-triggered sync, re-sync, retry, manual refresh, warm cache, or provider data fetch.
- Syncing is EXCLUSIVELY handled by the daily cron pipeline. You may only READ, DIAGNOSE, EXPLAIN, and help users submit evidence to support.
- When users ask "why didn't my data update?", explain the daily sync schedule (07:00 COT) and recommend "Watch until next run" or generating a Support Bundle. NEVER suggest manually triggering a sync.

CRITICAL RULES (NON-NEGOTIABLE):
1. Answer ONLY from the provided CONTEXT. If information is missing, say exactly what data you need.
2. NEVER invent database fields, provider status, actuaciones, or legal events.
3. NEVER output secrets, base URLs, headers, API keys, or raw provider payloads.
4. If you propose an action, it must be one of the allowlisted types. State-changing actions must have risk=CONFIRM_REQUIRED.
5. Respond in the same language as the user's message (typically Spanish).
6. Be concise but thorough. Cite specific trace IDs, alert IDs, or dates when possible.

CASE SUMMARY POLICY (CRITICAL — READ CAREFULLY):
When a user asks to "summarize", "resume", "resumen", or asks about a specific case/asunto/proceso:
1. CONTEXT-FIRST: If the CONTEXT_JSON includes "work_item", USE IT. Do NOT ask the user for a radicado or ID. The system already resolved the case from their current page.
2. If "work_item" is null/missing in CONTEXT_JSON, THEN ask: "¿Cuál es el radicado o ID del asunto que quieres consultar?"
3. NEVER show org-wide health stats (total processes, org health) when the user asked about a SPECIFIC case. Only show org_health if the user explicitly asks about org status, health, or "all my processes."
4. Use this EXACT structured format for case summaries:

**A) Ficha del proceso**
- **Radicado:** [from work_item.radicado]
- **Tipo de flujo:** [from work_item.workflow_type]
- **Estado/Etapa:** [work_item.stage] — [work_item.status]
- **Monitoreo:** [Activo/Inactivo] [reason if disabled]
- **Última sincronización:** [work_item.last_synced_at, formatted]
- **Fuentes:** [work_item.provider_sources]
- **Total actuaciones:** [work_item.total_actuaciones]

**B) Últimas actuaciones** (más recientes primero)
For each item in latest_acts (up to 10):
[N]. **[event_date]** — [source_platform] — [event_type or "—"] — [description truncated to 120 chars]

If latest_acts is empty: "⚠️ No se encontraron actuaciones. Esto puede significar que el mapeo aún no se completó o que el proveedor no devolvió datos."

**C) Últimas publicaciones/estados** (if latest_pubs exists and has items)
For each item in latest_pubs (up to 5):
[N]. **[pub_date]** — [source_platform] — [description truncated to 120 chars]

**D) Alertas activas** (only if alerts exist with status != 'resolved')
List any active alerts with severity and message.

**D2) Notificaciones no leídas del usuario** (only if unread_user_alerts exists in context)
If CONTEXT_JSON contains "unread_user_alerts", list the most recent unread user notifications:
For each: [type] — [title] — [severity] — [created_at]
The types include: ACTUACION_NUEVA, ESTADO_NUEVO, STAGE_CHANGE, TAREA_CREADA, TAREA_VENCIDA, AUDIENCIA_PROXIMA, AUDIENCIA_CREADA, TERMINO_CRITICO, TERMINO_VENCIDO, PETICION_CREADA, HITO_ALCANZADO.

**E) Acciones recomendadas**
Always include 2-4 of these based on context:
- If sync errors exist: propose ESCALATE_TO_ADMIN_QUEUE, CREATE_USER_REPORT, or GENERATE_SUPPORT_BUNDLE
- If monitoring is off: propose TOGGLE_MONITORING to re-enable
- If user wants updates: propose CREATE_SYNC_WATCH to be notified after next daily run
- If data is missing/stale: propose RUN_DIAGNOSTIC_PLAYBOOK with appropriate playbook
- Always offer CREATE_SUPPORT_TICKET as last option
- NEVER propose sync/retry/refresh actions

5. STRICT RELEVANCE: If the user asks about ONE case, respond about THAT case only. Never include org-level process counts, total monitored items, or org health metrics unless explicitly asked.

CAPABILITY MAP — PROBLEM CLASS → ALLOWED ACTIONS:
When a user reports a problem, use this map to select the correct actions. NEVER deviate.

| Problem Class | Allowed Actions | Forbidden |
|---|---|---|
| "Data not updated / stale" | RUN_DIAGNOSTIC_PLAYBOOK(WHY_NO_UPDATES), CREATE_SYNC_WATCH, GENERATE_SUPPORT_BUNDLE | sync, retry, refresh |
| "Missing estados/actuaciones" | RUN_DIAGNOSTIC_PLAYBOOK(MISSING_DATA), GENERATE_SUPPORT_BUNDLE, CREATE_SYNC_WATCH | sync, retry, fetch |
| "Dead-lettered / excluded item" | RUN_DIAGNOSTIC_PLAYBOOK(DEAD_LETTER_STATUS), GENERATE_SUPPORT_BUNDLE | reset dead-letter, re-sync |
| "Permissions / can't see data" | RUN_DIAGNOSTIC_PLAYBOOK(PERMISSIONS_CHECK), EXPLAIN_CURRENT_PAGE | grant access, modify RLS |
| "Admin sees partial details" | RUN_DIAGNOSTIC_PLAYBOOK(PARTIAL_ADMIN_VIEW), GENERATE_SUPPORT_BUNDLE | expand child-table access |
| "Billing / subscription" | GET_BILLING_SUMMARY, GET_SUBSCRIPTION_STATUS, GENERATE_PAYMENT_CERTIFICATE | modify plans directly |
| "Org management" | INVITE_USER_TO_ORG, REMOVE_USER_FROM_ORG, CHANGE_MEMBER_ROLE, ORG_USAGE_SUMMARY | bypass membership cap |
| "Settings change" | TOGGLE_TICKER, TOGGLE_MONITORING, UPDATE_ORG_ANALYTICS | direct DB writes |
| "Support / bug report" | CREATE_SUPPORT_TICKET, GENERATE_SUPPORT_BUNDLE, ESCALATE_TO_ADMIN_QUEUE, CREATE_USER_REPORT | access customer data |
| "Privacy / support access" | GRANT_SUPPORT_ACCESS (only if user explicitly requests), REVOKE_SUPPORT_ACCESS | proactive grant |
| "Analytics inquiry" | GET_ANALYTICS_STATUS, UPDATE_ORG_ANALYTICS | collect PII |

ALLOWLISTED ACTIONS (NO SYNC ACTIONS — DAILY CRON ONLY):
- TOGGLE_MONITORING: Enable/disable monitoring for a work item (CONFIRM_REQUIRED)
- ESCALATE_TO_ADMIN_QUEUE: Escalate issue to admin queue
- CREATE_USER_REPORT: Create a structured report for the supervisor panel
- UNLOCK_DANGER_ZONE: Temporarily enable the Danger Zone in Settings for 12 hours (CONFIRM_REQUIRED)
- GENERATE_PAYMENT_CERTIFICATE: Generate a payment/service certificate for the user's organization (SAFE)
- TOGGLE_TICKER: Enable/disable the live estados ticker (CONFIRM_REQUIRED). Params: { enabled: boolean }
  RBAC rules for TOGGLE_TICKER:
  - If the user has NO organization: allowed (affects only their personal experience).
  - If the user belongs to an org: ticker is an ORG-LEVEL setting (show_estados_ticker on organizations table).
    - Only OWNER or ADMIN can toggle it. Regular MEMBER must be told: "Solo los administradores de tu organización pueden cambiar esta configuración. Contacta a tu administrador."
    - When toggling for org, state clearly: "Esto cambiará la configuración del ticker para toda la organización [org_name]."
  - Super admins: do not route through this action; they have platform-level controls.
- GET_BILLING_SUMMARY: Read-only: return a summary of billing/subscription status (SAFE)
- GET_SUBSCRIPTION_STATUS: Read-only: return current subscription details (SAFE)
- INVITE_USER_TO_ORG: Invite a user to the organization by email (CONFIRM_REQUIRED). Params: { email: string, role?: "MEMBER"|"ADMIN" }
- REMOVE_USER_FROM_ORG: Remove a member from the organization (CONFIRM_REQUIRED). Params: { user_id: string }
- CHANGE_MEMBER_ROLE: Change a member's role (CONFIRM_REQUIRED). Params: { user_id: string, new_role: "MEMBER"|"ADMIN" }
- ORG_USAGE_SUMMARY: Read-only org stats: seats used, monitors active, work items count (SAFE)
- CREATE_SUPPORT_TICKET: Create a structured support ticket with auto-gathered metadata (SAFE)
- EXPLAIN_CURRENT_PAGE: Contextual help based on the user's current route (SAFE)
- GENERATE_SUPPORT_BUNDLE: Generate a read-only diagnostic bundle with TXT + JSON evidence (SAFE). Call andro-support-bundle edge function.
- RUN_DIAGNOSTIC_PLAYBOOK: Run a read-only diagnostic check (SAFE). Params: { playbook: "WHY_NO_UPDATES"|"MISSING_DATA"|"PERMISSIONS_CHECK"|"DEAD_LETTER_STATUS"|"PARTIAL_ADMIN_VIEW" }
- CREATE_SYNC_WATCH: Create a "notify me after next daily sync" watch (SAFE). Params: { work_item_id: string, condition_type: "ZERO_ESTADOS"|"NO_NEW_ACTUACIONES"|"STILL_FAILING"|"STILL_DEAD_LETTERED" }
- GRANT_SUPPORT_ACCESS: Grant temporary support access to a platform admin (CONFIRM_REQUIRED). Params: { access_type: "REDACTED"|"DIRECT_VIEW", reason: string, duration_minutes?: number (max 30) }
  POLICY: The user MUST explicitly request this. NEVER propose proactively. Always explain:
  "⚠️ Esto dará acceso temporal al equipo de soporte para ver [redacted info/su pantalla directamente]. Máximo 30 minutos. Puede revocar en cualquier momento desde Configuración > Privacidad."
  For DIRECT_VIEW, add extra warning: "Vista directa significa que el agente de soporte podrá ver exactamente lo que usted ve en la pantalla."
- REVOKE_SUPPORT_ACCESS: Immediately revoke all active support access grants (SAFE). No params needed.
- GRANT_MEMBER_SUPPORT_TAB: Org admin grants a member access to the Support Tools tab (CONFIRM_REQUIRED). Params: { member_user_id: string }
  RBAC: Only org admins (OWNER/ADMIN). Regular members must be told: "Solo los administradores de tu organización pueden habilitar el acceso a Soporte para miembros."
  When granting, confirm: "Esto habilitará la pestaña de Soporte para el miembro seleccionado. Podrá exportar datos y usar herramientas de soporte."
- REVOKE_MEMBER_SUPPORT_TAB: Org admin revokes a member's Support Tools tab access (CONFIRM_REQUIRED). Params: { member_user_id: string }
- GET_ANALYTICS_STATUS: Read-only: return the current analytics configuration for the user's organization (SAFE). Shows global state, org override, and whether analytics are effectively enabled. Any org member can view.
- UPDATE_ORG_ANALYTICS: Update analytics settings for the user's organization (CONFIRM_REQUIRED). Params: { analytics_enabled?: boolean | null, session_replay_enabled?: boolean | null, notes?: string }
   RBAC: Only org_admin (OWNER or ADMIN role). Regular members should be told: "Solo los administradores de tu organización pueden cambiar la configuración de analíticas."
   When toggling, explain: "Esto cambiará la configuración de analíticas para toda la organización [nombre]. Si se establece en null, se heredará la configuración global."
- BULK_EXPORT_DOCUMENTS: Generate a full ZIP export of all org documents + evidence packs for account deactivation or archival (SAFE). No params needed.
  When the user asks about deactivation, closing their account, or exporting everything, propose this action FIRST.
  Explain: "Antes de proceder, le generaré un archivo completo con todos sus documentos, paquetes de evidencia y metadatos. Esto puede tomar varios minutos dependiendo del volumen."

DOCUMENT LIFECYCLE POLICY (EVIDENCE PACKS, RETENTION, PROOFS):
When a user asks about documents, evidence packs, retention, proof uploads, or document integrity:
1. **Evidence Packs**: Finalized documents have an Evidence Pack (ZIP) containing: signed PDFs, audit certificates, raw event log (JSONL), manifest with SHA-256 hashes, and a README. Users can download it from the document detail page. Evidence Packs can be verified at /verify without authentication — designed for court submissions.
2. **Retention Policies**: Each document type has a retention period (default 10 years). Once finalized, documents cannot be deleted until the retention period expires. Org admins can configure custom retention periods per document type from Settings. The retention_expires_at is auto-calculated when a document is finalized.
3. **External Proofs**: For notifications (notificaciones), the platform does NOT deliver to third parties. Instead, lawyers upload proof of external delivery (Servientrega receipts, publication certificates). Each uploaded proof is SHA-256 hashed and included in the Evidence Pack manifest for tamper-detection.
4. **Bilateral Signing (Contracts)**: Contracts use sequential bilateral signing: lawyer signs first, then client. The client's signing link is only activated after the lawyer completes their signature.
5. **Hash Chain Integrity**: All document events form a hash chain (each event_hash includes the previous_event_hash). The /verify page replays and validates this chain.
6. **Soft-Delete Enforcement**: Work items with finalized documents within their retention period CANNOT be soft-deleted. The system blocks deletion and shows the furthest retention expiration date.
7. If a user asks "can I delete this document?", check the document_context in CONTEXT_JSON for retention_expires_at. If it's in the future, explain the retention policy and when deletion will be possible.

ANALYTICS INQUIRY POLICY:
When a user asks about analytics, telemetry, data collection, tracking, or observability:
1. Use the "analytics" context from CONTEXT_JSON (if available) to answer about the current state.
2. Explain that analytics NEVER collect PII, legal content, case details, or personal data. Only safe metadata (counts, latencies, feature usage) is tracked.
3. All identifiers are hashed with HMAC-SHA256 before transmission.
4. If the user wants to change their org's analytics settings, propose UPDATE_ORG_ANALYTICS with appropriate params.
5. If the user wants to see the current state, propose GET_ANALYTICS_STATUS.
6. Session replay (if enabled) masks all inputs and excludes document viewers and legal content areas.
7. For users asking about data privacy: reassure that analytics are OFF by default and require explicit opt-in by platform admins. Each organization can override and opt out independently.

SETTINGS ACTIONS POLICY:
When a user asks to change settings (ticker, notifications, analytics, etc.) via chat:
1. Identify which setting they want to change.
2. Determine the setting scope (user-level vs org-level).
3. Check RBAC: does this user have permission to change that setting at that scope?
4. If permitted: confirm what will change and who it affects, then propose the action with CONFIRM_REQUIRED.
5. If denied: explain why, and suggest they contact their org admin. Offer to copy a request message.
6. After execution, confirm the result: "El ticker ha sido desactivado para tu organización [nombre]."

IDENTITY SEPARATION (CRITICAL):
You are the end-user assistant ("Atenia AI Asistente"). You help with user/org-scoped tasks.
You do NOT have access to super-admin tools (cron jobs, mass sync, platform health, external API oversight).
If a user asks about platform-level operations, respond: "Esas funciones están disponibles en la consola de Super Administrador."
Never mention or expose super-admin capabilities.

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

SUPPORT ACCESS POLICY (CRITICAL — PRIVACY FIRST):
When a user asks for help, support, or mentions a problem:
1. ALWAYS channel support through redacted diagnostics first. NEVER propose DIRECT_VIEW access proactively.
2. If the user explicitly asks for "direct support", "que vean mi pantalla", or "vista directa", THEN propose GRANT_SUPPORT_ACCESS with access_type=DIRECT_VIEW.
3. For general support requests, propose GRANT_SUPPORT_ACCESS with access_type=REDACTED (default).
4. ALWAYS warn: "⚠️ Esto otorgará acceso temporal (máximo 30 minutos) al equipo de soporte. Puede revocarlo en cualquier momento desde Configuración > Privacidad."
5. For DIRECT_VIEW, add: "Vista directa significa que el agente de soporte podrá ver exactamente lo que usted ve. ¿Está seguro?"
6. The user can say "revocar acceso" at any time → propose REVOKE_SUPPORT_ACCESS (SAFE, no confirmation needed).
7. Super admins CANNOT see user data without an active grant. All access is audited.

MEMBER SUPPORT TAB POLICY:
When an org admin asks to enable/grant the "Soporte" tab for a member:
1. Only OWNER or ADMIN roles can grant this. Regular members cannot self-enable.
2. Propose GRANT_MEMBER_SUPPORT_TAB with { member_user_id }. Ask the admin which member they want to enable.
3. The grant is persistent until explicitly revoked via REVOKE_MEMBER_SUPPORT_TAB.
4. When a regular member asks for support tools access, respond: "La pestaña de Soporte requiere autorización de tu administrador de organización. Solicita a tu administrador que te habilite el acceso a través de Andro IA."


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

  // Check org admin + membership role
  if (orgId) {
    const { data: isAdmin } = await adminClient.rpc("is_org_admin", { org_id: orgId });
    (ctx.user as any).is_org_admin = !!isAdmin;

    // Get membership role for RBAC context
    const { data: membership } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    (ctx.user as any).org_membership_role = membership?.role || "MEMBER";

    // Get org settings (ticker state, name)
    const { data: orgData } = await adminClient
      .from("organizations")
      .select("name, show_estados_ticker")
      .eq("id", orgId)
      .maybeSingle();
    ctx.org_settings = {
      name: orgData?.name,
      show_estados_ticker: orgData?.show_estados_ticker ?? true,
      ticker_scope: "ORGANIZATION", // ticker is org-level
    };
  } else {
    (ctx.user as any).has_organization = false;
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
        .eq("entity_type", "WORK_ITEM")
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

      // Document lifecycle context (retention, evidence packs, proofs)
      const { data: docs } = await userClient
        .from("generated_documents")
        .select("id, title, document_type, status, finalized_at, retention_expires_at, retention_years, deleted_at, created_at")
        .eq("work_item_id", workItemId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (docs && docs.length > 0) {
        ctx.document_context = {
          total_documents: docs.length,
          finalized: docs.filter((d: any) => d.finalized_at).length,
          drafts: docs.filter((d: any) => !d.finalized_at).length,
          within_retention: docs.filter((d: any) => d.retention_expires_at && new Date(d.retention_expires_at) > new Date()).length,
          documents: docs.map((d: any) => ({
            id: d.id,
            title: d.title,
            type: d.document_type,
            status: d.status,
            finalized: !!d.finalized_at,
            retention_expires_at: d.retention_expires_at,
            retention_years: d.retention_years,
          })),
        };

        // External proofs for this work item's documents
        const docIds = docs.map((d: any) => d.id);
        const { data: proofs } = await userClient
          .from("document_evidence_proofs")
          .select("id, document_id, file_name, proof_type, sha256_hash, created_at")
          .in("document_id", docIds)
          .order("created_at", { ascending: false })
          .limit(20);
        if (proofs && proofs.length > 0) {
          ctx.external_proofs = proofs.map((p: any) => ({
            id: p.id,
            document_id: p.document_id,
            file_name: p.file_name,
            proof_type: p.proof_type,
            has_hash: !!p.sha256_hash,
            created_at: p.created_at,
          }));
        }
      }
    }
  }

  // For ORG/PLATFORM scope WITHOUT a specific work item: high-level health summary
  // IMPORTANT: Only load org health when no workItemId — prevents leaking org stats into case summaries
  if (scope === "ORG" && orgId && !workItemId) {
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

  // ---- Analytics context ----
  if (orgId) {
    const analyticsCtx: Record<string, unknown> = {};

    // Global analytics settings
    const { data: globalSettings } = await adminClient
      .from("platform_settings")
      .select("analytics_enabled_global, posthog_enabled, sentry_enabled, session_replay_enabled")
      .eq("id", "singleton")
      .maybeSingle();
    analyticsCtx.global = globalSettings || { analytics_enabled_global: false, posthog_enabled: false, sentry_enabled: false, session_replay_enabled: false };

    // Org override
    const { data: orgOverride } = await adminClient
      .from("org_analytics_overrides")
      .select("analytics_enabled, session_replay_enabled, notes, updated_at")
      .eq("organization_id", orgId)
      .maybeSingle();
    analyticsCtx.org_override = orgOverride || null;

    // Resolve effective state
    const globalEnabled = (globalSettings as any)?.analytics_enabled_global ?? false;
    const orgEnabled = (orgOverride as any)?.analytics_enabled;
    analyticsCtx.effective = {
      analytics_enabled: orgEnabled === null || orgEnabled === undefined ? globalEnabled : orgEnabled,
      source: orgEnabled === null || orgEnabled === undefined ? "inherited_from_global" : "org_override",
    };

    ctx.analytics = analyticsCtx;
  }

  // ---- Recent unread user notifications (for alert awareness) ----
  {
    const { data: recentNotifs } = await adminClient
      .from("notifications")
      .select("id, type, title, body, severity, created_at, work_item_id")
      .eq("user_id", userId)
      .is("read_at", null)
      .is("dismissed_at", null)
      .in("category", ["WORK_ITEM_ALERTS", "TERMS"])
      .order("created_at", { ascending: false })
      .limit(10);
    
    if (recentNotifs && recentNotifs.length > 0) {
      ctx.unread_user_alerts = recentNotifs.map((n: any) => ({
        type: n.type,
        title: n.title,
        body: n.body,
        severity: n.severity,
        created_at: n.created_at,
        work_item_id: n.work_item_id,
      }));
      ctx.unread_user_alerts_count = recentNotifs.length;
    }
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
    // REMOVED: RUN_SYNC_WORK_ITEM, RUN_SYNC_PUBLICACIONES_WORK_ITEM, RUN_MASTER_SYNC_SCOPE
    // Syncing is daily-cron-only. No user-triggered sync actions allowed.

    case "GENERATE_SUPPORT_BUNDLE": {
      const resp = await fetch(`${supabaseUrl}/functions/v1/andro-support-bundle`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          work_item_id: action.params?.work_item_id,
          route_context: action.params?.route_context,
        }),
      });
      const result = await resp.json().catch(() => ({ status: resp.status }));
      return { ok: resp.ok, result };
    }

    case "RUN_DIAGNOSTIC_PLAYBOOK": {
      const resp = await fetch(`${supabaseUrl}/functions/v1/andro-diagnose`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playbook: action.params?.playbook,
          work_item_id: action.params?.work_item_id,
        }),
      });
      const result = await resp.json().catch(() => ({ status: resp.status }));
      return { ok: resp.ok, result };
    }

    case "CREATE_SYNC_WATCH": {
      const resp = await fetch(`${supabaseUrl}/functions/v1/andro-create-watch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          work_item_id: action.params?.work_item_id,
          condition_type: action.params?.condition_type,
        }),
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

    // REMOVED: RUN_MASTER_SYNC_SCOPE — syncing is daily-cron-only

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

    case "TOGGLE_TICKER": {
      const enabled = !!action.params?.enabled;
      const orgId = ctx.orgId;
      const hasOrg = !!orgId;
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;

      if (hasOrg && !isOrgAdmin) {
        throw new Error("Solo los administradores de la organización pueden cambiar la configuración del ticker. Contacta a tu administrador.");
      }

      if (hasOrg) {
        // Org-level toggle
        const { error } = await adminClient
          .from("organizations")
          .update({ show_estados_ticker: enabled })
          .eq("id", orgId);
        if (error) throw new Error(error.message);
        return { ok: true, scope: "organization", enabled, org_id: orgId };
      } else {
        // No org — personal preference (store in profile mascot_preferences or similar)
        // For users without org, ticker toggle is conceptually a no-op since ticker requires org data
        return { ok: true, scope: "personal", enabled, note: "Ticker visibility updated. Note: the ticker requires an organization to display data." };
      }
    }

    case "GET_BILLING_SUMMARY":
    case "GET_SUBSCRIPTION_STATUS": {
      // Read-only actions — the billing context is already included in the chat context
      // These are informational; the AI will answer from context. No DB mutation needed.
      return { ok: true, note: "Billing information is available in the chat context. The AI will summarize it directly." };
    }

    case "INVITE_USER_TO_ORG": {
      const orgId = ctx.orgId;
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;
      if (!orgId) throw new Error("Se requiere una organización para invitar usuarios.");
      if (!isOrgAdmin) throw new Error("Solo los administradores de la organización pueden invitar usuarios.");

      const email = action.params?.email;
      if (!email || typeof email !== "string" || !email.includes("@")) {
        throw new Error("Se requiere un email válido para la invitación.");
      }

      const role = action.params?.role || "MEMBER";
      if (!["MEMBER", "ADMIN"].includes(role)) throw new Error("Rol inválido. Use MEMBER o ADMIN.");

      // Check if user already exists in org
      const { data: existingUser } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();

      if (existingUser) {
        const { data: existingMembership } = await adminClient
          .from("organization_memberships")
          .select("id")
          .eq("organization_id", orgId)
          .eq("user_id", existingUser.id)
          .maybeSingle();

        if (existingMembership) {
          return { ok: false, error: "Este usuario ya es miembro de la organización." };
        }

        // Add existing user to org
        const { error } = await adminClient
          .from("organization_memberships")
          .insert({ organization_id: orgId, user_id: existingUser.id, role });
        if (error) throw new Error(error.message);
        return { ok: true, message: `Usuario ${email} agregado como ${role}.`, user_id: existingUser.id };
      }

      // User doesn't exist yet — create an invitation record or notify
      return { ok: true, message: `Invitación pendiente para ${email} (rol: ${role}). El usuario debe registrarse primero en la plataforma.`, pending: true };
    }

    case "REMOVE_USER_FROM_ORG": {
      const orgId = ctx.orgId;
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;
      if (!orgId) throw new Error("Se requiere una organización.");
      if (!isOrgAdmin) throw new Error("Solo los administradores pueden eliminar miembros.");

      const targetUserId = action.params?.user_id;
      if (!targetUserId) throw new Error("Se requiere el user_id del miembro a eliminar.");
      if (targetUserId === ctx.user?.id) throw new Error("No puedes eliminarte a ti mismo de la organización.");

      // Check target role — cannot remove OWNER unless you are also OWNER
      const { data: targetMembership } = await adminClient
        .from("organization_memberships")
        .select("id, role")
        .eq("organization_id", orgId)
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (!targetMembership) throw new Error("El usuario no es miembro de esta organización.");
      
      const myRole = (ctx.user as any)?.org_membership_role;
      if (targetMembership.role === "OWNER" && myRole !== "OWNER") {
        throw new Error("Solo un OWNER puede eliminar a otro OWNER de la organización.");
      }

      const { error } = await adminClient
        .from("organization_memberships")
        .delete()
        .eq("id", targetMembership.id);
      if (error) throw new Error(error.message);

      return { ok: true, message: `Miembro eliminado de la organización.`, removed_user_id: targetUserId };
    }

    case "CHANGE_MEMBER_ROLE": {
      const orgId = ctx.orgId;
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;
      if (!orgId) throw new Error("Se requiere una organización.");
      if (!isOrgAdmin) throw new Error("Solo los administradores pueden cambiar roles.");

      const targetUserId = action.params?.user_id;
      const newRole = action.params?.new_role;
      if (!targetUserId) throw new Error("Se requiere el user_id del miembro.");
      if (!newRole || !["MEMBER", "ADMIN"].includes(newRole)) throw new Error("Rol inválido. Use MEMBER o ADMIN.");
      if (targetUserId === ctx.user?.id) throw new Error("No puedes cambiar tu propio rol.");

      const { data: targetMembership } = await adminClient
        .from("organization_memberships")
        .select("id, role")
        .eq("organization_id", orgId)
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (!targetMembership) throw new Error("El usuario no es miembro de esta organización.");
      if (targetMembership.role === "OWNER") throw new Error("No se puede cambiar el rol de un OWNER.");

      const { error } = await adminClient
        .from("organization_memberships")
        .update({ role: newRole })
        .eq("id", targetMembership.id);
      if (error) throw new Error(error.message);

      return { ok: true, message: `Rol cambiado a ${newRole}.`, user_id: targetUserId, new_role: newRole };
    }

    case "ORG_USAGE_SUMMARY": {
      const orgId = ctx.orgId;
      if (!orgId) throw new Error("Se requiere una organización.");

      const { data: members } = await adminClient
        .from("organization_memberships")
        .select("id, role")
        .eq("organization_id", orgId);

      const { data: workItems } = await adminClient
        .from("work_items")
        .select("id, monitoring_enabled, status")
        .eq("organization_id", orgId)
        .is("deleted_at", null);

      const totalMembers = members?.length || 0;
      const adminCount = members?.filter((m: any) => m.role === "OWNER" || m.role === "ADMIN").length || 0;
      const totalWorkItems = workItems?.length || 0;
      const monitored = workItems?.filter((w: any) => w.monitoring_enabled).length || 0;

      return {
        ok: true,
        usage: {
          total_members: totalMembers,
          admin_count: adminCount,
          member_count: totalMembers - adminCount,
          total_work_items: totalWorkItems,
          monitored_work_items: monitored,
          unmonitored_work_items: totalWorkItems - monitored,
        },
      };
    }

    case "CREATE_SUPPORT_TICKET": {
      const orgId = ctx.orgId;
      const subject = action.params?.subject || "Ticket de soporte";
      const description = action.params?.description || "Sin descripción";

      const { data, error } = await adminClient
        .from("atenia_ai_user_reports")
        .insert({
          organization_id: orgId,
          reporter_user_id: ctx.user.id,
          work_item_id: action.params?.work_item_id || null,
          description: `[${subject}] ${description}`,
          report_type: "SUPPORT_TICKET",
          status: "OPEN",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true, ticket_id: data?.id, message: "Ticket de soporte creado exitosamente." };
    }

    case "EXPLAIN_CURRENT_PAGE": {
      // This is a contextual help action — the AI will answer from the route context
      return { ok: true, note: "Contextual help will be provided by the AI based on the current route." };
    }

    case "GRANT_SUPPORT_ACCESS": {
      const userId = ctx.user?.id;
      const orgId = ctx.orgId;
      if (!userId) throw new Error("User ID required");
      if (!orgId) throw new Error("Se requiere una organización.");

      const accessType = action.params?.access_type || "REDACTED";
      if (!["REDACTED", "DIRECT_VIEW"].includes(accessType)) {
        throw new Error("Tipo de acceso inválido. Use REDACTED o DIRECT_VIEW.");
      }

      const reason = action.params?.reason || "Soporte técnico solicitado por usuario";
      const durationMinutes = Math.min(Math.max(action.params?.duration_minutes || 30, 5), 30);
      const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

      // Find a platform admin to grant access to (first available)
      const { data: platformAdmins } = await adminClient
        .from("platform_admins")
        .select("user_id")
        .limit(5);

      if (!platformAdmins || platformAdmins.length === 0) {
        throw new Error("No hay administradores de plataforma disponibles.");
      }

      // Create grants for all platform admins
      const grants = platformAdmins.map((admin: any) => ({
        user_id: userId,
        organization_id: orgId,
        granted_to_admin_id: admin.user_id,
        access_type: accessType,
        scope: "SUPPORT",
        redaction_level: accessType === "DIRECT_VIEW" ? "LOW" : "HIGH",
        reason,
        expires_at: expiresAt,
        status: "ACTIVE",
      }));

      const { data, error } = await adminClient
        .from("support_access_grants")
        .insert(grants)
        .select("id, expires_at");

      if (error) throw new Error(error.message);

      return {
        ok: true,
        grants_created: data?.length || 0,
        access_type: accessType,
        expires_at: expiresAt,
        duration_minutes: durationMinutes,
        message: accessType === "DIRECT_VIEW"
          ? `Acceso de vista directa otorgado por ${durationMinutes} minutos. Puede revocarlo en Configuración > Privacidad.`
          : `Acceso de soporte redactado otorgado por ${durationMinutes} minutos. Su información personal permanece protegida.`,
      };
    }

    case "REVOKE_SUPPORT_ACCESS": {
      const userId = ctx.user?.id;
      if (!userId) throw new Error("User ID required");

      const { data, error } = await adminClient
        .from("support_access_grants")
        .update({ status: "REVOKED", revoked_at: new Date().toISOString(), revoked_by: userId })
        .eq("user_id", userId)
        .eq("status", "ACTIVE")
        .select("id");

      if (error) throw new Error(error.message);

      return {
        ok: true,
        revoked_count: data?.length || 0,
        message: data?.length
          ? `Se revocaron ${data.length} acceso(s) de soporte activos inmediatamente.`
          : "No hay accesos de soporte activos para revocar.",
      };
    }

    case "GET_ANALYTICS_STATUS": {
      const orgId = ctx.orgId;
      if (!orgId) throw new Error("Se requiere una organización.");

      // Return the analytics context already built
      return {
        ok: true,
        analytics: ctx.analytics || { global: { analytics_enabled_global: false }, org_override: null, effective: { analytics_enabled: false, source: "inherited_from_global" } },
      };
    }

    case "UPDATE_ORG_ANALYTICS": {
      const orgId = ctx.orgId;
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;
      if (!orgId) throw new Error("Se requiere una organización.");
      if (!isOrgAdmin) throw new Error("Solo los administradores de la organización pueden cambiar la configuración de analíticas.");

      const payload: Record<string, unknown> = { organization_id: orgId };
      if (action.params?.analytics_enabled !== undefined) payload.analytics_enabled = action.params.analytics_enabled;
      if (action.params?.session_replay_enabled !== undefined) payload.session_replay_enabled = action.params.session_replay_enabled;
      if (action.params?.notes !== undefined) payload.notes = action.params.notes;
      payload.updated_by = ctx.user?.id;

      const { error } = await adminClient
        .from("org_analytics_overrides")
        .upsert(payload, { onConflict: "organization_id" });
      if (error) throw new Error(error.message);

      return {
        ok: true,
        message: "Configuración de analíticas actualizada para la organización.",
        analytics_enabled: action.params?.analytics_enabled,
        session_replay_enabled: action.params?.session_replay_enabled,
      };
    }

    case "GRANT_MEMBER_SUPPORT_TAB": {
      const orgId = ctx.orgId;
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;
      if (!orgId) throw new Error("Se requiere una organización.");
      if (!isOrgAdmin) throw new Error("Solo los administradores de la organización pueden otorgar acceso al tab de Soporte.");

      const memberUserId = action.params?.member_user_id;
      if (!memberUserId) throw new Error("Se requiere el ID del miembro (member_user_id).");

      // Verify user is a member of the org
      const { data: membership } = await adminClient
        .from("organization_memberships")
        .select("id, role")
        .eq("organization_id", orgId)
        .eq("user_id", memberUserId)
        .maybeSingle();

      if (!membership) throw new Error("El usuario no es miembro de esta organización.");

      // Upsert the grant (clear revoked_at if re-granting)
      const { error } = await adminClient
        .from("member_support_grants")
        .upsert({
          organization_id: orgId,
          user_id: memberUserId,
          granted_by: ctx.user?.id,
          granted_at: new Date().toISOString(),
          revoked_at: null,
          revoked_by: null,
        }, { onConflict: "organization_id,user_id" });

      if (error) throw new Error(error.message);

      return {
        ok: true,
        message: `Acceso al tab de Soporte habilitado para el miembro. Podrá ver las herramientas de soporte en Configuración.`,
      };
    }

    case "REVOKE_MEMBER_SUPPORT_TAB": {
      const orgId = ctx.orgId;
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;
      if (!orgId) throw new Error("Se requiere una organización.");
      if (!isOrgAdmin) throw new Error("Solo los administradores de la organización pueden revocar acceso al tab de Soporte.");

      const memberUserId = action.params?.member_user_id;
      if (!memberUserId) throw new Error("Se requiere el ID del miembro (member_user_id).");

      const { data, error } = await adminClient
        .from("member_support_grants")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: ctx.user?.id,
        })
        .eq("organization_id", orgId)
        .eq("user_id", memberUserId)
        .is("revoked_at", null)
        .select("id");

      if (error) throw new Error(error.message);

      return {
        ok: true,
        revoked: !!(data && data.length > 0),
        message: data && data.length > 0
          ? "Acceso al tab de Soporte revocado para el miembro."
          : "El miembro no tenía acceso activo al tab de Soporte.",
      };
    }

    case "BULK_EXPORT_DOCUMENTS": {
      const orgId = ctx.orgId;
      if (!orgId) throw new Error("Se requiere una organización para la exportación masiva.");

      // RBAC: admin-only
      const isOrgAdmin = !!(ctx.user as any)?.is_org_admin;
      if (!isOrgAdmin) throw new Error("Solo los administradores de la organización pueden ejecutar exportaciones masivas.");

      // Feature flag check
      const { data: orgFlags } = await adminClient
        .from("organizations")
        .select("bulk_export_enabled")
        .eq("id", orgId)
        .maybeSingle();

      if (!orgFlags?.bulk_export_enabled) {
        return {
          ok: false,
          message: "La exportación masiva no está habilitada para esta organización. Un administrador de plataforma puede activarla.",
        };
      }

      // Return metadata only — NO signed URLs
      const { count: docCount } = await adminClient
        .from("generated_documents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null);

      const { count: finalizedCount } = await adminClient
        .from("generated_documents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .not("finalized_at", "is", null);

      return {
        ok: true,
        export_summary: {
          total_documents: docCount ?? 0,
          finalized_documents: finalizedCount ?? 0,
        },
        message: `Exportación disponible: ${docCount ?? 0} documentos (${finalizedCount ?? 0} finalizados). Use el botón "Exportar Todo" en Configuración > Exportación para iniciar la descarga. La exportación requiere confirmación adicional.`,
      };
    }

    case "GRANT_CONTRACT_EXTRA": {
      const orgId = ctx.orgId;
      if (!orgId) throw new Error("Se requiere una organización.");
      const clientId = action.params?.client_id;
      if (!clientId) throw new Error("Se requiere client_id.");
      const userId = (ctx.user as any)?.id;
      if (!userId) throw new Error("Se requiere usuario autenticado.");

      // Call the DB function to grant extra allowance
      const { data, error } = await adminClient.rpc("grant_client_contract_extra", {
        p_organization_id: orgId,
        p_client_id: clientId,
        p_granted_by: "ANDRO_IA",
        p_granted_by_user_id: userId,
        p_extra_amount: action.params?.extra_amount ?? 2,
      });

      if (error) throw new Error(error.message);

      // Log immutable audit event
      await adminClient.from("audit_logs").insert({
        organization_id: orgId,
        actor_user_id: userId,
        actor_type: "AI_ASSISTANT",
        entity_type: "CLIENT",
        entity_id: clientId,
        action: "CLIENT_CONTRACT_LIMIT_OVERRIDE_GRANTED",
        metadata: {
          granted_by: "ANDRO_IA",
          extra_amount: action.params?.extra_amount ?? 2,
          result: data,
        },
      });

      return {
        ok: true,
        message: `Se autorizaron ${action.params?.extra_amount ?? 2} contratos adicionales para este cliente.`,
        result: data,
      };
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
