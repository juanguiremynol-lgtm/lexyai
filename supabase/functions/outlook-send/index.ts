/**
 * outlook-send — Sends a message from the signed-in user's OWN Outlook mailbox
 * through Microsoft Graph (`POST /me/sendMail`, scope Mail.Send).
 *
 * Invariants:
 *   - Only the caller's mailbox is ever used; no shared/platform sender here.
 *   - The body is transmitted to Graph but NEVER persisted by Andromeda.
 *     When `work_item_id` is supplied we store metadata + evidence only.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  ensureAccessToken,
  graphPost,
  OUTLOOK_SEND_ENABLED,
} from "../_shared/outlookGraph.ts";
import { resolveCaller } from "../_shared/callerIdentity.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Graph's simple sendMail tops out well below this; keep a safe ceiling. */
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Attachment {
  name: string;
  contentType?: string;
  contentBytes: string; // base64, no data: prefix
}

function recipients(list: unknown): { emailAddress: { address: string } }[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a): a is string => typeof a === "string" && EMAIL_RE.test(a.trim()))
    .slice(0, 30)
    .map((a) => ({ emailAddress: { address: a.trim() } }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Kill switch: sending from the user's mailbox is not authorized. The
  // implementation below is retained but unreachable until explicitly enabled.
  if (!OUTLOOK_SEND_ENABLED) {
    return json({ error: "Funcionalidad deshabilitada pendiente de revisión" }, 403);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let connectionId: string | null = null;
  try {
    const caller = await resolveCaller(req);
    if (caller.kind !== "user") return json({ error: "No autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const to = recipients(body.to);
    const cc = recipients(body.cc);
    const bcc = recipients(body.bcc);
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const content = typeof body.body === "string" ? body.body : "";
    const isHtml = body.content_type === "HTML";
    const workItemId = typeof body.work_item_id === "string" ? body.work_item_id : null;
    const asMemorial = body.as_memorial === true;

    if (to.length === 0) return json({ error: "Agrega al menos un destinatario válido." }, 400);
    if (!subject) return json({ error: "El asunto es obligatorio." }, 400);
    if (!content.trim()) return json({ error: "El mensaje está vacío." }, 400);

    const rawAttachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments : [];
    let attachmentBytes = 0;
    for (const a of rawAttachments) {
      if (!a?.name || typeof a.contentBytes !== "string") {
        return json({ error: "Adjunto inválido." }, 400);
      }
      attachmentBytes += Math.floor((a.contentBytes.length * 3) / 4);
    }
    if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
      return json(
        { error: "Los adjuntos superan 3 MB. Comparte un enlace en lugar del archivo." },
        400,
      );
    }

    const { data: conn } = await admin
      .from("user_email_connections")
      .select(
        "id, user_id, organization_id, ms_account_email, can_send, status, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, token_expires_at",
      )
      .eq("provider", "outlook")
      .eq("user_id", caller.userId)
      .maybeSingle();

    if (!conn || conn.status !== "CONNECTED") {
      return json({ error: "No tienes un buzón de Outlook conectado." }, 400);
    }
    connectionId = conn.id as string;
    if (!conn.can_send) {
      return json(
        {
          error:
            "Tu conexión de Outlook fue autorizada solo para lectura. Vuelve a conectar Outlook para habilitar el envío.",
          reconnect_required: true,
        },
        403,
      );
    }

    // The work item must belong to the caller's scope before we attach evidence.
    let workItem: { id: string; organization_id: string | null } | null = null;
    if (workItemId) {
      let q = admin.from("work_items").select("id, organization_id, owner_id").eq("id", workItemId);
      const { data: wi } = await q.maybeSingle();
      const owns = wi &&
        ((wi.owner_id as string) === caller.userId ||
          (wi.organization_id && caller.orgIds.includes(wi.organization_id as string)));
      if (!owns) return json({ error: "El expediente no pertenece a tu cuenta." }, 403);
      workItem = { id: wi!.id as string, organization_id: (wi!.organization_id as string) ?? null };
    }

    const accessToken = await ensureAccessToken(admin, conn as never);

    await graphPost("/me/sendMail", accessToken, {
      message: {
        subject,
        body: { contentType: isHtml ? "HTML" : "Text", content },
        toRecipients: to,
        ...(cc.length ? { ccRecipients: cc } : {}),
        ...(bcc.length ? { bccRecipients: bcc } : {}),
        ...(rawAttachments.length
          ? {
            attachments: rawAttachments.map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.name,
              contentType: a.contentType ?? "application/octet-stream",
              contentBytes: a.contentBytes,
            })),
          }
          : {}),
      },
      saveToSentItems: true,
    });

    let linkId: string | null = null;
    if (workItem) {
      const { data: link, error: linkError } = await admin
        .from("work_item_email_links")
        .insert({
          user_id: caller.userId,
          organization_id: workItem.organization_id ?? conn.organization_id,
          work_item_id: workItem.id,
          connection_id: conn.id,
          // Placeholder id: outlook-sync upgrades it once the message lands in
          // Sent Items, so the link is never duplicated.
          message_id: `manual:${crypto.randomUUID()}`,
          direction: "sent",
          subject,
          sender: conn.ms_account_email ?? null,
          recipients: to.map((r) => r.emailAddress.address),
          received_at: new Date().toISOString(),
          has_attachments: rawAttachments.length > 0,
          attachment_names: rawAttachments.map((a) => a.name).slice(0, 10),
          matched_by: "MANUAL",
          matched_value: conn.ms_account_email ?? "envío desde Andromeda",
          confidence: 1,
          evidence_type: asMemorial ? "MEMORIAL_ENVIADO" : "OTRO",
          link_status: "CONFIRMED",
        })
        .select("id")
        .maybeSingle();
      if (linkError) console.error("[outlook-send] link insert", linkError.message);
      linkId = (link?.id as string) ?? null;
    }

    return json({ ok: true, sent_from: conn.ms_account_email, link_id: linkId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error inesperado";
    console.error("[outlook-send]", message);
    const status = /Graph \[401\]/.test(message) ? 401 : 500;
    if (status === 401 && connectionId) {
      await admin
        .from("user_email_connections")
        .update({ status: "ERROR", last_error: message.slice(0, 500) })
        .eq("id", connectionId);
    }
    return json({ error: message }, status);
  }
});
