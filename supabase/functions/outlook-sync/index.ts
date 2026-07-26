/**
 * outlook-sync — Delta-reads Inbox and Sent Items for every active connection
 * and runs the inference matcher.
 *
 * Two callers:
 *   - user JWT   → syncs only that user's connection (manual button)
 *   - CRON_SERVICE_KEY → syncs every CONNECTED connection (every 30 min)
 *
 * Only metadata is persisted. Bodies are never requested ($select excludes
 * `body`); bodyPreview is used in-memory for party matching and discarded.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  decryptToken,
  encryptToken,
  refreshTokens,
  graphGet,
} from "../_shared/outlookGraph.ts";
import { resolveCaller } from "../_shared/callerIdentity.ts";
import {
  matchMessage,
  classifyEvidence,
  type GraphMessage,
  type PortfolioItem,
} from "../_shared/emailMatcher.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SELECT =
  "id,subject,bodyPreview,from,sender,toRecipients,receivedDateTime,sentDateTime,hasAttachments,webLink,conversationId,internetMessageId";
const PAGE_LIMIT = 10; // delta pages per folder per run

type Admin = ReturnType<typeof createClient>;

interface Connection {
  id: string;
  user_id: string;
  organization_id: string | null;
  access_token_cipher: string | null;
  access_token_nonce: string | null;
  refresh_token_cipher: string | null;
  refresh_token_nonce: string | null;
  token_expires_at: string | null;
  delta_token_inbox: string | null;
  delta_token_sent: string | null;
}

async function accessTokenFor(admin: Admin, conn: Connection): Promise<string> {
  const expiresAt = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  if (expiresAt > Date.now() + 60_000) {
    const token = await decryptToken(conn.access_token_cipher, conn.access_token_nonce);
    if (token) return token;
  }
  const refresh = await decryptToken(conn.refresh_token_cipher, conn.refresh_token_nonce);
  if (!refresh) throw new Error("La conexión no tiene refresh token. Vuelve a conectar Outlook.");

  const tokens = await refreshTokens(refresh);
  const access = await encryptToken(tokens.access_token);
  const patch: Record<string, unknown> = {
    access_token_cipher: access.cipherHex,
    access_token_nonce: access.nonceHex,
    token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
    status: "CONNECTED",
    last_error: null,
  };
  if (tokens.refresh_token) {
    const nr = await encryptToken(tokens.refresh_token);
    patch.refresh_token_cipher = nr.cipherHex;
    patch.refresh_token_nonce = nr.nonceHex;
  }
  await admin.from("user_email_connections").update(patch).eq("id", conn.id);
  return tokens.access_token;
}

async function loadPortfolio(admin: Admin, conn: Connection): Promise<PortfolioItem[]> {
  let query = admin
    .from("work_items")
    .select("id, organization_id, radicado, authority_name, authority_email, demandantes, demandados, title, clients(name)")
    .limit(5000);
  query = conn.organization_id
    ? query.eq("organization_id", conn.organization_id)
    : query.eq("owner_id", conn.user_id);

  const { data, error } = await query;
  if (error) throw new Error(`Portafolio: ${error.message}`);
  return (data ?? []).map((w: Record<string, unknown>) => ({
    id: w.id as string,
    organization_id: (w.organization_id as string) ?? null,
    radicado: (w.radicado as string) ?? null,
    authority_name: (w.authority_name as string) ?? null,
    authority_email: (w.authority_email as string) ?? null,
    demandantes: (w.demandantes as string) ?? null,
    demandados: (w.demandados as string) ?? null,
    title: (w.title as string) ?? null,
    client_name: (w.clients as { name?: string } | null)?.name ?? null,
  }));
}

async function readFolder(
  accessToken: string,
  folder: "inbox" | "sentitems",
  deltaToken: string | null,
): Promise<{ messages: GraphMessage[]; deltaLink: string | null }> {
  let url = deltaToken ??
    `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?$select=${SELECT}&$top=50`;
  const messages: GraphMessage[] = [];
  let deltaLink: string | null = null;

  for (let page = 0; page < PAGE_LIMIT; page++) {
    const res = await graphGet(url, accessToken);
    for (const m of (res.value as GraphMessage[]) ?? []) {
      if (m?.id) messages.push(m);
    }
    const next = res["@odata.nextLink"] as string | undefined;
    const delta = res["@odata.deltaLink"] as string | undefined;
    if (delta) { deltaLink = delta; break; }
    if (!next) break;
    url = next;
  }
  return { messages, deltaLink };
}

async function syncConnection(admin: Admin, conn: Connection) {
  const summary = {
    connection_id: conn.id,
    messages_scanned: 0,
    links_created: 0,
    suggestions_created: 0,
    memorial_evidence: 0,
  };

  const accessToken = await accessTokenFor(admin, conn);
  const portfolio = await loadPortfolio(admin, conn);

  const folders: { folder: "inbox" | "sentitems"; direction: "received" | "sent"; token: string | null; column: string }[] = [
    { folder: "inbox", direction: "received", token: conn.delta_token_inbox, column: "delta_token_inbox" },
    { folder: "sentitems", direction: "sent", token: conn.delta_token_sent, column: "delta_token_sent" },
  ];

  for (const f of folders) {
    const { messages, deltaLink } = await readFolder(accessToken, f.folder, f.token);
    summary.messages_scanned += messages.length;

    for (const msg of messages) {
      const matches = matchMessage(msg, portfolio);
      for (const match of matches) {
        if (match.confidence < 0.5) continue;
        const confirmed = match.confidence >= 0.7;
        const evidence = confirmed
          ? classifyEvidence(msg, f.direction, match.matched_by)
          : null;

        const row = {
          user_id: conn.user_id,
          organization_id: match.organization_id ?? conn.organization_id,
          work_item_id: match.work_item_id,
          connection_id: conn.id,
          message_id: msg.id,
          internet_message_id: msg.internetMessageId ?? null,
          conversation_id: msg.conversationId ?? null,
          direction: f.direction,
          subject: msg.subject ?? null,
          sender: msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null,
          recipients: (msg.toRecipients ?? [])
            .map((r) => r.emailAddress?.address)
            .filter((a): a is string => Boolean(a))
            .slice(0, 10),
          received_at: msg.receivedDateTime ?? msg.sentDateTime ?? null,
          has_attachments: Boolean(msg.hasAttachments),
          web_link: msg.webLink ?? null,
          matched_by: match.matched_by,
          matched_value: match.matched_value,
          confidence: match.confidence,
          evidence_type: evidence,
          link_status: confirmed ? "CONFIRMED" : "SUGGESTED",
        };

        const { error } = await admin
          .from("work_item_email_links")
          .upsert(row, { onConflict: "message_id,work_item_id", ignoreDuplicates: true });
        if (error) {
          console.error("[outlook-sync] link upsert", error.message);
          continue;
        }
        if (confirmed) summary.links_created++;
        else summary.suggestions_created++;
        if (evidence === "MEMORIAL_ENVIADO") summary.memorial_evidence++;
      }
    }

    if (deltaLink) {
      await admin.from("user_email_connections").update({ [f.column]: deltaLink }).eq("id", conn.id);
    }
  }

  await admin
    .from("user_email_connections")
    .update({ last_sync_at: new Date().toISOString(), status: "CONNECTED", last_error: null })
    .eq("id", conn.id);

  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const cronKey = req.headers.get("x-cron-key");
    const isCron = Boolean(cronKey) && cronKey === Deno.env.get("CRON_SERVICE_KEY");

    let connections: Connection[] = [];
    const columns =
      "id, user_id, organization_id, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, token_expires_at, delta_token_inbox, delta_token_sent";

    if (isCron) {
      const { data } = await admin
        .from("user_email_connections")
        .select(columns)
        .eq("provider", "outlook")
        .eq("status", "CONNECTED");
      connections = (data ?? []) as unknown as Connection[];
    } else {
      const caller = await resolveCaller(req);
      if (caller.kind !== "user") return json({ error: "No autenticado" }, 401);
      const { data } = await admin
        .from("user_email_connections")
        .select(columns)
        .eq("provider", "outlook")
        .eq("user_id", caller.userId)
        .eq("status", "CONNECTED");
      connections = (data ?? []) as unknown as Connection[];
      if (connections.length === 0) {
        return json({ error: "No tienes un buzón de Outlook conectado." }, 400);
      }
    }

    const results: unknown[] = [];
    for (const conn of connections) {
      try {
        results.push(await syncConnection(admin, conn));
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error inesperado";
        console.error("[outlook-sync] connection failed", conn.id, message);
        await admin
          .from("user_email_connections")
          .update({ status: "ERROR", last_error: message.slice(0, 500) })
          .eq("id", conn.id);
        results.push({ connection_id: conn.id, error: message });
      }
    }

    return json({ ok: true, connections: connections.length, results });
  } catch (e) {
    console.error("[outlook-sync]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});