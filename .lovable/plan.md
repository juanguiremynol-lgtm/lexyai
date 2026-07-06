
## 0. Confirming your architecture summary

Yes — your description matches the codebase:
- Andrómeda Legal is the web app (React + Supabase).
- Users are lawyers; the domain entity is `work_items`.
- Judicial data (actuaciones, estados, publicaciones) is scraped/normalized by external services on Google Cloud Run.
- Supabase Edge Functions are thin coordinators (`sync-by-work-item`, `sync-publicaciones-by-work-item`, `atenia-cron-watchdog`, `atenia-ai-supervisor`, `atenia-daily-report`, etc.).
- Category eligibility is centralized in `_shared/onlineSyncEligibility.ts` (CGP, CPACA, LABORAL, PENAL_906, TUTELA are online-sync eligible; GOV_PROCEDURE and PETICION are internal-only).

The WhatsApp agent will plug into this model without moving scraping into Supabase and without creating a second orchestration layer.

## 1. Provider choice

**Meta WhatsApp Business Cloud API** (default, as you specified). All provider I/O goes through a single adapter `supabase/functions/_shared/whatsappProvider.ts` (send text, send interactive buttons, verify signature, check 24h window). A future Twilio swap only replaces this file.

## 2. Migrations (one migration file)

New tables (all with GRANTs + RLS + `service_role` full access; admin-of-org read/write policies via `has_role` + org membership):

- `whatsapp_identities` — phone→user/org binding, verification lifecycle.
- `whatsapp_conversations` — per-phone conversation state (`bot_active | needs_human | human_active | closed`), `current_flow`, `selected_work_item_id`, `opted_out`.
- `whatsapp_messages` — inbound/outbound log, `wa_message_id UNIQUE` (dedupe), `correlation_id`, delivery status.
- `whatsapp_leads` — new-prospect capture with status.
- `whatsapp_bot_settings` — single-row config (bot enabled, business hours, admin email, admin WA numbers, rate limits, cooldown minutes, service knowledge base text).
- `whatsapp_audit_log` — every data-tool call (phone, user, org, tool, work_item_id, correlation_id, ts).
- `whatsapp_verification_attempts` — email-code fallback attempts for the 3-strike / 1h lockout.

Extends: adds a `whatsapp_link_codes` table (hashed, 15-min TTL) for the in-app linking flow (§3.2).

After apply: regenerate `src/integrations/supabase/types.ts`.

## 3. Edge Functions (new)

Placed under `supabase/functions/`:

- `whatsapp-webhook/` — GET verify handshake (`WHATSAPP_VERIFY_TOKEN`), POST HMAC-SHA256 signature validation (`WHATSAPP_APP_SECRET`), dedupe by `wa_message_id`, upsert conversation, insert inbound message, then `EdgeRuntime.waitUntil(dispatchAsync(...))` to `whatsapp-agent`. Returns 200 in <1s.
- `whatsapp-agent/` — the AI agent. Loads conversation state + last 20 messages, runs the tool-calling loop (max 5 iterations), calls tools scoped to the verified identity's org, sends replies via the provider adapter, writes audit + outbound message rows, updates conversation state. Bounded timeout.
- `whatsapp-admin-send/` — invoked by the admin inbox UI to send a human reply (pauses bot, respects 24h window).
- `_shared/whatsappProvider.ts` — send text / interactive / template; verify signature; last-inbound-timestamp helper for 24h window.
- `_shared/whatsappTools.ts` — the read-only + write tools (find_work_items, get_work_item_overview, get_latest_actuacion, get_recent_actuaciones, get_latest_estado (CPACA-gated), get_latest_publicacion (publicaciones-gated), get_upcoming_deadlines, request_refresh, create_lead, escalate_to_human). Every tool takes `{ orgId, userId }` — never trusts model-supplied scope. Category checks import `_shared/onlineSyncEligibility.ts`; mismatches return `{ status: "not_applicable", reason }`, never errors.
- `_shared/whatsappIdentity.ts` — verify code / consume code / email-code fallback with 3-attempt + 1h lockout.

Reused: `sync-publicaciones-by-work-item` for the bounded refresh tool (respects cooldown; surfaces `skipped_recent_sync` / `not_applicable`).

## 4. AI model

Use the Lovable AI Gateway via AI SDK (`@ai-sdk/openai-compatible`) — no user API key needed. Default model: `google/gemini-3-flash-preview` (fast, tool-calling, cheap). Uses `stopWhen: stepCountIs(5)` per §5. System prompt in Spanish, warm-professional tone, hard rules (no legal advice, no fabrication, org-scoped only, `not_applicable` phrasing for category mismatches).

## 5. Frontend (admin UI)

New route `/platform/whatsapp` (Super Admin) + `/admin/whatsapp` (org admin) — mirrors existing platform page patterns:

- `WhatsAppInboxPage` — conversation list + thread view + "Tomar conversación" / "Devolver al bot" buttons.
- `WhatsAppLeadsPage` — leads table with status.
- `WhatsAppIdentitiesPage` — verified numbers, unlink/block.
- `WhatsAppSettingsPage` — edits `whatsapp_bot_settings` (incl. global on/off).
- User settings: `LinkWhatsAppSection` in the existing profile page — generates a 6-digit code, shows expiry, lists linked numbers with unlink.

Uses shadcn components, Spanish UI copy, semantic tokens (no hardcoded colors).

## 6. Secrets to add (via `add_secret`, after your confirmation)

- `WHATSAPP_ACCESS_TOKEN` (permanent Meta token)
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN` (owner-chosen string for the GET handshake)
- `WHATSAPP_APP_SECRET` (Meta app secret, for POST signature validation)

`LOVABLE_API_KEY` is already provisioned for the AI call.

## 7. Observability

- Structured logs everywhere with `correlation_id` linking webhook → agent → tool → send.
- `job_runs` telemetry for the async agent dispatch (`dispatched|started|finished|failed|timed_out`).
- `atenia-daily-report` gains a WhatsApp section: conversations started, msgs in/out, leads created, verifications ok/fail, escalations, AI failures, tool errors, rate-limit hits, outside-24h attempts.

## 8. Out of scope (extension points marked in code)

- Proactive outbound notifications ("hay una nueva actuación") — requires Meta-approved message templates. Left as a stub in `whatsappProvider.ts` with a clear comment.
- Media (audio/image/document) inbound → polite text reply + human handoff.
- Admin-WhatsApp notification channel is config-flagged; reliable channels are in-app + email.

## 9. Conflicts / assumptions to flag

- **Admin email for notifications**: I'll wire this to an existing outbound email path if one exists in the codebase (`email_outbox` / `email-outbox-processor`), otherwise store on settings and mark it as delivered via in-app notification only until confirmed. I'll verify during implementation.
- **`user_roles` / org admin check**: I'll reuse the existing `has_role` + `organization_memberships` pattern already used across the codebase.
- **Business hours**: default `Mon–Fri 08:00–18:00 America/Bogota`, editable in settings.
- **Rate limits**: default 20 msgs / 5 min per phone; configurable in settings.
- **AI provider**: I'm using Lovable AI Gateway (no extra key). If you want a specific model (e.g. `openai/gpt-5-mini`), say so.
- **No hard delete of WA data**: aligns with the project's soft-delete rule.

## 10. Implementation order (after you approve)

1. Migration + regenerate types.
2. `_shared/whatsappProvider.ts`, `_shared/whatsappIdentity.ts`, `_shared/whatsappTools.ts`.
3. `whatsapp-webhook` + `whatsapp-agent` + `whatsapp-admin-send` edge functions.
4. Admin UI pages + user-settings linking section.
5. `atenia-daily-report` WhatsApp section.
6. Request the 4 WhatsApp secrets via `add_secret`.
7. Deliver setup guide (Meta app creation, webhook URL, verify token, secrets list) + test checklist.

---

Approve this plan (or tell me what to adjust — model choice, business hours default, whether to skip the org-admin UI and keep it Super-Admin-only, etc.) and I'll implement in the order above.
