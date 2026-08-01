/**
 * email-reevaluate-suggested — Iteración 7.2.
 *
 * Reevalúa el backlog de vínculos SUGGESTED creados ANTES de la iteración 6
 * bajo las reglas ACTUALES del matcher (extracción completa de radicados,
 * lista negra del titular, puntuación multi-señal y regla dura de conflicto).
 *
 * Reanudable: se procesa por MENSAJE (internet_message_id) y cada mensaje
 * atendido queda sellado con evidence_meta.reevaluated_at, así una corrida que
 * muere a mitad nunca repite trabajo. Los cuerpos se leen SOLO en memoria.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, graphGet, ensureAccessToken } from "../_shared/outlookGraph.ts";
import { resolveCaller } from "../_shared/callerIdentity.ts";
import {
  matchMessage,
  isAutoConfirmable,
  classifyEvidence,
  classifyEvidenceSubtype,
  classifyMemorialSubtype,
  buildOwnerIdentity,
  decomposeStoredRadicado,
  messageRadicadoBases,
  bodyToText,
  isLowContentMessage,
  type GraphMessage,
  type OwnerIdentity,
  type PortfolioItem,
} from "../_shared/emailMatcher.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Admin = ReturnType<typeof createClient>;

const CONNECTION_COLUMNS =
  "id, user_id, organization_id, ms_account_email, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, token_expires_at";

const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

/** Motivos canónicos de descarte (quedan en evidence_meta.dismiss_reason). */
const REASON_RADICADO_WINS = "REEVALUADO_RADICADO_GANA";
const REASON_FOREIGN = "RADICADO_AJENO";
const REASON_WEAK = "SENAL_INSUFICIENTE_PRE_ITER6";

interface LinkRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  connection_id: string | null;
  work_item_id: string;
  message_id: string;
  internet_message_id: string | null;
  conversation_id: string | null;
  direction: "sent" | "received";
  subject: string | null;
  sender: string | null;
  recipients: string[] | null;
  received_at: string | null;
  has_attachments: boolean | null;
  web_link: string | null;
  evidence_meta: Record<string, unknown> | null;
}

interface Connection {
  id: string;
  user_id: string;
  organization_id: string | null;
  ms_account_email: string | null;
}

async function loadOwnerIdentity(admin: Admin, conn: Connection): Promise<OwnerIdentity> {
  const names: string[] = [];
  const emails: string[] = [conn.ms_account_email ?? ""].filter(Boolean);
  const { data } = await admin
    .from("profiles")
    .select("full_name, firm_name, custom_firm_name, email")
    .eq("id", conn.user_id)
    .maybeSingle();
  if (data) {
    const p = data as Record<string, string | null>;
    for (const key of ["full_name", "firm_name", "custom_firm_name"]) {
      if (p[key]) names.push(p[key] as string);
    }
    if (p.email) emails.push(p.email);
  }
  return buildOwnerIdentity({ names, emails });
}

async function loadPortfolio(admin: Admin, conn: Connection): Promise<PortfolioItem[]> {
  let query = admin
    .from("work_items")
    .select(
      "id, organization_id, radicado, authority_name, authority_email, demandantes, demandados, title, workflow_type, clients(name)",
    )
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
    workflow_type: (w.workflow_type as string) ?? null,
    client_name: (w.clients as { name?: string } | null)?.name ?? null,
  }));
}

/** Reconstruye el mensaje Graph a partir de los metadatos ya persistidos. */
function toGraphMessage(link: LinkRow): GraphMessage {
  return {
    id: link.message_id,
    subject: link.subject,
    bodyPreview: "",
    from: link.sender ? { emailAddress: { address: link.sender } } : undefined,
    sender: link.sender ? { emailAddress: { address: link.sender } } : undefined,
    toRecipients: (link.recipients ?? []).map((address) => ({ emailAddress: { address } })),
    receivedDateTime: link.direction === "received" ? link.received_at ?? undefined : undefined,
    sentDateTime: link.direction === "sent" ? link.received_at ?? undefined : undefined,
    hasAttachments: Boolean(link.has_attachments),
    webLink: link.web_link ?? undefined,
    conversationId: link.conversation_id ?? undefined,
    internetMessageId: link.internet_message_id ?? undefined,
  } as GraphMessage;
}

async function dismissLinks(
  admin: Admin,
  links: LinkRow[],
  reason: string,
  bases: string[],
) {
  const now = new Date().toISOString();
  for (const l of links) {
    await admin
      .from("work_item_email_links")
      .update({
        link_status: "DISMISSED",
        evidence_meta: {
          ...(l.evidence_meta ?? {}),
          dismiss_reason: reason,
          reevaluated_at: now,
          body_radicados: bases.length > 0 ? bases : (l.evidence_meta ?? {}).body_radicados,
        },
      })
      .eq("id", l.id);
  }
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

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch { /* sin cuerpo */ }

    const rawBatch = Number(body.batch_size);
    const batchSize = Number.isFinite(rawBatch) && rawBatch >= 1 && rawBatch <= MAX_BATCH
      ? Math.floor(rawBatch)
      : DEFAULT_BATCH;

    let userFilter: string | null = null;
    if (!isCron) {
      const caller = await resolveCaller(req);
      if (caller.kind === "service") {
        // corrida administrativa global
      } else if (caller.kind === "user") {
        userFilter = caller.userId;
      } else {
        return json({ error: "No autenticado" }, 401);
      }
    }

    // Tamaño de la cola ANTES (mensajes distintos con al menos un SUGGESTED).
    const beforeQuery = admin
      .from("work_item_email_links")
      .select("internet_message_id, message_id")
      .eq("link_status", "SUGGESTED");
    if (userFilter) beforeQuery.eq("user_id", userFilter);
    const { data: beforeRows } = await beforeQuery;
    const queueBefore = new Set(
      (beforeRows ?? []).map((r: Record<string, unknown>) =>
        (r.internet_message_id as string) ?? (r.message_id as string)
      ),
    ).size;

    // Backlog pendiente: SUGGESTED aún sin sello de reevaluación.
    let q = admin
      .from("work_item_email_links")
      .select(
        "id, user_id, organization_id, connection_id, work_item_id, message_id, internet_message_id, conversation_id, direction, subject, sender, recipients, received_at, has_attachments, web_link, evidence_meta",
      )
      .eq("link_status", "SUGGESTED")
      .is("evidence_meta->>reevaluated_at", null)
      .order("received_at", { ascending: false })
      .limit(batchSize * 4);
    if (userFilter) q = q.eq("user_id", userFilter);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as LinkRow[];
    // Agrupación por MENSAJE: una decisión por correo, no N hermanas.
    const groups = new Map<string, LinkRow[]>();
    for (const r of rows) {
      const key = r.internet_message_id ?? r.message_id;
      const bucket = groups.get(key);
      if (bucket) bucket.push(r);
      else groups.set(key, [r]);
    }
    const batch = [...groups.values()].slice(0, batchSize);

    const summary = {
      queue_before: queueBefore,
      messages_examined: 0,
      confirmations: [] as { work_item_id: string; radicado: string | null; subject: string | null }[],
      dismissed_by_reason: {} as Record<string, number>,
      kept: 0,
      detected_enqueued: 0,
      bodies_read: 0,
      errors: 0,
      remaining: 0,
      queue_after: 0,
    };
    const bump = (reason: string, n: number) => {
      summary.dismissed_by_reason[reason] = (summary.dismissed_by_reason[reason] ?? 0) + n;
    };

    const connCache = new Map<string, { conn: Connection; token: string | null }>();
    const portfolioCache = new Map<string, PortfolioItem[]>();
    const ownerCache = new Map<string, OwnerIdentity>();

    for (const group of batch) {
      const head = group[0];
      summary.messages_examined++;
      try {
        // Conexión, cartera e identidad del titular (por usuario, cacheadas).
        let ctx = connCache.get(head.user_id);
        if (!ctx) {
          const { data: conn } = await admin
            .from("user_email_connections")
            .select(CONNECTION_COLUMNS)
            .eq("user_id", head.user_id)
            .eq("provider", "outlook")
            .eq("status", "CONNECTED")
            .maybeSingle();
          if (!conn) {
            ctx = { conn: {
              id: head.connection_id ?? "",
              user_id: head.user_id,
              organization_id: head.organization_id,
              ms_account_email: null,
            }, token: null };
          } else {
            let token: string | null = null;
            try {
              token = await ensureAccessToken(admin, conn as never);
            } catch (e) {
              console.error("[reevaluate] token", (e as Error).message);
            }
            ctx = { conn: conn as unknown as Connection, token };
          }
          connCache.set(head.user_id, ctx);
        }
        const conn = ctx.conn;
        if (!portfolioCache.has(head.user_id)) {
          portfolioCache.set(head.user_id, await loadPortfolio(admin, conn));
          ownerCache.set(head.user_id, await loadOwnerIdentity(admin, conn));
        }
        const portfolio = portfolioCache.get(head.user_id)!;
        const owner = ownerCache.get(head.user_id)!;

        // Cuerpo en memoria (nunca se persiste). Si el mensaje ya no existe en
        // el buzón se reevalúa solo con el asunto almacenado.
        let bodyText = "";
        if (ctx.token && !head.message_id.startsWith("manual:")) {
          try {
            const full = await graphGet(
              `https://graph.microsoft.com/v1.0/me/messages/${head.message_id}?$select=body`,
              ctx.token,
            );
            bodyText = bodyToText(
              ((full as { body?: { content?: string } }).body?.content ?? "") as string,
            );
            summary.bodies_read++;
          } catch (e) {
            console.error("[reevaluate] body", head.id, (e as Error).message);
          }
        }

        const msg = toGraphMessage(head);
        const bases = messageRadicadoBases(head.subject, bodyText);
        const matches = matchMessage({ ...msg, bodyPreview: bodyText }, portfolio, {
          selfAddress: conn.ms_account_email ?? null,
          owner,
        });
        const radicadoMatch = matches
          .filter((m) => isAutoConfirmable(m))
          .sort((a, b) => b.confidence - a.confidence)[0] ?? null;

        // (a) El radicado resuelve a un expediente activo → CONFIRMED allí.
        if (radicadoMatch) {
          const wi = portfolio.find((p) => p.id === radicadoMatch.work_item_id) ?? null;
          const existing = group.find((l) => l.work_item_id === radicadoMatch.work_item_id);
          const now = new Date().toISOString();
          const meta = {
            ...(existing?.evidence_meta ?? head.evidence_meta ?? {}),
            match_signals: radicadoMatch.match_signals ?? ["RADICADO"],
            body_radicados: bases,
            reevaluated_at: now,
            reevaluated_outcome: "CONFIRMED_BY_RADICADO",
          };
          const row = {
            user_id: head.user_id,
            organization_id: radicadoMatch.organization_id ?? head.organization_id,
            work_item_id: radicadoMatch.work_item_id,
            connection_id: head.connection_id,
            message_id: head.message_id,
            internet_message_id: head.internet_message_id,
            conversation_id: head.conversation_id,
            direction: head.direction,
            subject: head.subject,
            sender: head.sender,
            recipients: head.recipients ?? [],
            received_at: head.received_at,
            has_attachments: Boolean(head.has_attachments),
            web_link: head.web_link,
            matched_by: radicadoMatch.matched_by,
            matched_value: radicadoMatch.matched_value,
            confidence: radicadoMatch.confidence,
            evidence_type: classifyEvidence(msg, head.direction, radicadoMatch.matched_by),
            evidence_subtype: head.direction === "received"
              ? classifyEvidenceSubtype(head.subject, head.sender)
              : null,
            memorial_subtype: head.direction === "sent"
              ? classifyMemorialSubtype(head.subject)
              : null,
            evidence_meta: meta,
            low_content: isLowContentMessage(msg),
            link_status: "CONFIRMED",
          };
          const { error: upErr } = await admin
            .from("work_item_email_links")
            .upsert(row, { onConflict: "message_id,work_item_id" });
          if (upErr) throw new Error(upErr.message);

          // Hermanos apuntando a otro expediente: fuera de la cola.
          const siblings = group.filter((l) => l.work_item_id !== radicadoMatch.work_item_id);
          if (siblings.length > 0) {
            await dismissLinks(admin, siblings, REASON_RADICADO_WINS, bases);
            bump(REASON_RADICADO_WINS, siblings.length);
          }

          // Efectos: el vínculo confirmado fluye por el pipeline normal.
          const { data: linkRow } = await admin
            .from("work_item_email_links")
            .select("id")
            .eq("message_id", head.message_id)
            .eq("work_item_id", radicadoMatch.work_item_id)
            .maybeSingle();
          if (linkRow) {
            const { error: fxErr } = await admin.rpc("apply_email_evidence_effects", {
              p_link_id: (linkRow as { id: string }).id,
            });
            if (fxErr) console.error("[reevaluate] effects", fxErr.message);
          }
          summary.confirmations.push({
            work_item_id: radicadoMatch.work_item_id,
            radicado: wi?.radicado ?? null,
            subject: head.subject,
          });
          continue;
        }

        // (b) Hay radicados, pero ninguno es de la cartera → radicado ajeno.
        if (bases.length > 0) {
          await dismissLinks(admin, group, REASON_FOREIGN, bases);
          bump(REASON_FOREIGN, group.length);
          for (const base of bases) {
            const canonical = decomposeStoredRadicado(`${base}00`)?.canonical ?? null;
            if (!canonical) continue;
            const { data: prior } = await admin
              .from("detected_processes")
              .select("id")
              .eq("user_id", head.user_id)
              .like("radicado", `${base}%`)
              .maybeSingle();
            if (prior) continue;
            const seenAt = head.received_at ?? new Date().toISOString();
            const { error: detErr } = await admin.from("detected_processes").insert({
              user_id: head.user_id,
              organization_id: head.organization_id,
              radicado: canonical,
              message_id: head.message_id,
              internet_message_id: head.internet_message_id,
              subject: head.subject,
              sender: head.sender,
              web_link: head.web_link,
              first_seen_at: seenAt,
              last_seen_at: seenAt,
              status: "PENDING",
              meta: { source: "REEVALUACION_ITER72" },
            });
            if (!detErr) summary.detected_enqueued++;
          }
          continue;
        }

        // (c)/(d) Sin radicado: mandan las señales actuales.
        const keep = matches.filter(
          (m) => (m.match_signals ?? []).length >= 2 &&
            group.some((l) => l.work_item_id === m.work_item_id),
        );
        if (keep.length === 0) {
          await dismissLinks(admin, group, REASON_WEAK, bases);
          bump(REASON_WEAK, group.length);
          continue;
        }
        const now = new Date().toISOString();
        for (const l of group) {
          const m = keep.find((k) => k.work_item_id === l.work_item_id);
          if (!m) {
            await dismissLinks(admin, [l], REASON_WEAK, bases);
            bump(REASON_WEAK, 1);
            continue;
          }
          await admin
            .from("work_item_email_links")
            .update({
              matched_by: m.matched_by,
              matched_value: m.matched_value,
              confidence: m.confidence,
              evidence_meta: {
                ...(l.evidence_meta ?? {}),
                match_signals: m.match_signals ?? [],
                body_radicados: bases,
                reevaluated_at: now,
                reevaluated_outcome: "KEPT_MULTI_SIGNAL",
              },
            })
            .eq("id", l.id);
          summary.kept++;
        }
      } catch (e) {
        console.error("[reevaluate]", head.id, (e as Error).message);
        summary.errors++;
        // Sello defensivo: un mensaje problemático nunca bloquea el avance.
        await admin
          .from("work_item_email_links")
          .update({
            evidence_meta: {
              ...(head.evidence_meta ?? {}),
              reevaluated_at: new Date().toISOString(),
              reevaluate_error: (e as Error).message.slice(0, 200),
            },
          })
          .in("id", group.map((l) => l.id));
      }
    }

    let remainingQuery = admin
      .from("work_item_email_links")
      .select("id", { count: "exact", head: true })
      .eq("link_status", "SUGGESTED")
      .is("evidence_meta->>reevaluated_at", null);
    if (userFilter) remainingQuery = remainingQuery.eq("user_id", userFilter);
    const { count } = await remainingQuery;
    summary.remaining = count ?? 0;

    const afterQuery = admin
      .from("work_item_email_links")
      .select("internet_message_id, message_id")
      .eq("link_status", "SUGGESTED");
    if (userFilter) afterQuery.eq("user_id", userFilter);
    const { data: afterRows } = await afterQuery;
    summary.queue_after = new Set(
      (afterRows ?? []).map((r: Record<string, unknown>) =>
        (r.internet_message_id as string) ?? (r.message_id as string)
      ),
    ).size;

    return json({ ok: true, summary });
  } catch (e) {
    console.error("[email-reevaluate-suggested]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
