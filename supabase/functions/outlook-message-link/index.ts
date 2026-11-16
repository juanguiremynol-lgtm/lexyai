/**
 * outlook-message-link — user-scoped search and explicit linking of Outlook
 * messages to administrative matters (PETICION / GOV_PROCEDURE).
 *
 * Covers mail sent or received BEFORE the matter existed: the delta reader in
 * outlook-sync has already moved past those messages. This is a selective,
 * user-initiated backfill — no mailbox sweep, no new polling, no resend.
 *
 *   { action: "search", work_item_id, folder: "sentitems"|"inbox", query? }
 *       -> metadata only (≤25 results); nothing persisted.
 *   { action: "link", work_item_id, message_id }
 *       -> reads THAT message from the caller's own mailbox by Graph id and
 *          stores a CONFIRMED MANUAL link with provenance + audit + event.
 *
 * Access to the matter is proven through the caller's own RLS session before
 * any service-role write. Bodies are never requested.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, ensureAccessToken, graphGet, GRAPH_BASE } from "../_shared/outlookGraph.ts";
import { resolveCaller } from "../_shared/callerIdentity.ts";
import type { GraphMessage } from "../_shared/emailMatcher.ts";
import { ADMIN_WORKFLOWS, classifyAdministrativeEmail } from "../_shared/peticionEmailLinking.ts";
import { buildAdminLinkRow, recordAdminEmailEvent } from "../_shared/peticionEmailEvents.ts";

const SELECT =
  "id,subject,bodyPreview,from,sender,toRecipients,receivedDateTime,sentDateTime,hasAttachments,webLink,conversationId,internetMessageId";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH_ID_RE = /^[A-Za-z0-9_\-=+\/]{10,400}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export function validateBody(b: Record<string, unknown>):
  | { ok: true; action: "search"; workItemId: string; folder: "sentitems" | "inbox"; query: string | null }
  | { ok: true; action: "link"; workItemId: string; messageId: string }
  | { ok: false; error: string } {
  const workItemId = typeof b.work_item_id === "string" ? b.work_item_id : "";
  if (!UUID_RE.test(workItemId)) return { ok: false, error: "work_item_id inválido" };
  if (b.action === "search") {
    const folder = b.folder === "inbox" ? "inbox" : b.folder === "sentitems" ? "sentitems" : null;
    if (!folder) return { ok: false, error: "folder debe ser sentitems o inbox" };
    const raw = typeof b.query === "string" ? b.query.replace(/["\\]/g, " ").trim() : "";
    if (raw.length > 120) return { ok: false, error: "Búsqueda demasiado larga" };
    return { ok: true, action: "search", workItemId, folder, query: raw || null };
  }
  if (b.action === "link") {
    const messageId = typeof b.message_id === "string" ? b.message_id : "";
    if (!GRAPH_ID_RE.test(messageId)) return { ok: false, error: "message_id inválido" };
    return { ok: true, action: "link", workItemId, messageId };
  }
  return { ok: false, error: "action debe ser search o link" };
}

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const caller = await resolveCaller(req);
  if (caller.kind !== "user") return json({ error: "No autenticado" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const v = validateBody(body);
  if (!v.ok) return json({ error: v.error }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization")! } },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Access proof through the caller's own RLS.
  const { data: wi, error: wiErr } = await userClient.from("work_items")
    .select("id, organization_id, owner_id, workflow_type, authority_email, deleted_at")
    .eq("id", v.workItemId).maybeSingle();
  if (wiErr) return json({ error: wiErr.message }, 500);
  if (!wi || wi.deleted_at) return json({ error: "Asunto no encontrado o sin permisos" }, 404);
  if (!ADMIN_WORKFLOWS.has(String(wi.workflow_type))) {
    return json({ error: "Solo aplica a peticiones y trámites administrativos" }, 400);
  }

  const { data: conn } = await admin.from("user_email_connections")
    .select("id, user_id, organization_id, ms_account_email, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, token_expires_at, scopes")
    .eq("provider", "outlook").eq("user_id", caller.userId).eq("status", "CONNECTED").maybeSingle();
  if (!conn) return json({ error: "No tienes un buzón de Outlook conectado." }, 400);

  try {
    const token = await ensureAccessToken(admin, conn);

    if (v.action === "search") {
      const term = v.query ?? (wi.authority_email ? `participants:${wi.authority_email}` : null);
      if (!term) return json({ error: "Escribe un texto para buscar." }, 400);
      const res = await graphGet(
        `${GRAPH_BASE}/me/mailFolders/${v.folder}/messages?$search=${encodeURIComponent(`"${term}"`)}&$top=25&$select=${SELECT}`,
        token,
      );
      const messages = ((res.value as GraphMessage[]) ?? []);
      const ids = messages.map((m) => m.id);
      const { data: existing } = ids.length
        ? await admin.from("work_item_email_links").select("message_id, link_status")
          .eq("work_item_id", wi.id).in("message_id", ids)
        : { data: [] };
      const status = new Map((existing ?? []).map((e: { message_id: string; link_status: string }) => [e.message_id, e.link_status]));
      return json({
        ok: true,
        messages: messages.map((m) => ({
          id: m.id,
          subject: m.subject ?? null,
          from: m.from?.emailAddress?.address ?? null,
          to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean),
          at: m.sentDateTime ?? m.receivedDateTime ?? null,
          web_link: m.webLink ?? null,
          has_attachments: Boolean(m.hasAttachments),
          link_status: status.get(m.id) ?? null,
        })),
      });
    }

    // link
    const msg = await graphGet(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(v.messageId)}?$select=${SELECT}`,
      token,
    ) as unknown as GraphMessage;
    if (!msg?.id) return json({ error: "Mensaje no encontrado en tu buzón" }, 404);
    const from = (msg.from?.emailAddress?.address ?? "").toLowerCase();
    const direction: "sent" | "received" =
      from && from === (conn.ms_account_email ?? "").toLowerCase() ? "sent" : "received";

    const row = buildAdminLinkRow({
      userId: caller.userId,
      connectionId: conn.id,
      msg,
      direction,
      decision: {
        work_item_id: wi.id, organization_id: wi.organization_id, link_status: "CONFIRMED",
        matched_by: "MANUAL", matched_value: "vínculo manual", confidence: 1,
      },
      provenance: { source: "MANUAL_OUTLOOK_SEARCH", by_user: caller.userId, at: new Date().toISOString() },
    });

    const { data: prior } = await admin.from("work_item_email_links").select("id, link_status")
      .eq("message_id", msg.id).eq("work_item_id", wi.id).maybeSingle();
    let linkId: string;
    if (prior) {
      linkId = prior.id;
      if (prior.link_status !== "CONFIRMED") {
        const { error } = await admin.from("work_item_email_links").update({
          link_status: "CONFIRMED", matched_by: "MANUAL", confidence: 1,
          evidence_type: "OTRO", evidence_subtype: null, evidence_meta: row.evidence_meta,
          ai_classified_at: row.ai_classified_at,
        }).eq("id", prior.id);
        if (error) throw new Error(error.message);
      }
    } else {
      const { data: ins, error } = await admin.from("work_item_email_links").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      linkId = ins.id;
    }
    const event = await recordAdminEmailEvent(admin, row, linkId, caller.userId);
    if (!prior || prior.link_status !== "CONFIRMED") {
      await admin.from("audit_logs").insert({
        organization_id: wi.organization_id,
        actor_user_id: caller.userId,
        actor_type: "USER",
        action: "EMAIL_LINK_MANUAL_OUTLOOK",
        entity_type: "work_item",
        entity_id: wi.id,
        metadata: { link_id: linkId, direction, admin_class: classifyAdministrativeEmail(msg, direction),
          internet_message_id: msg.internetMessageId ?? null, previous_status: prior?.link_status ?? null },
      });
    }
    return json({ ok: true, link_id: linkId, direction, already_confirmed: prior?.link_status === "CONFIRMED", event });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error inesperado";
    console.error("[outlook-message-link]", message);
    return json({ error: message }, 502);
  }
});
