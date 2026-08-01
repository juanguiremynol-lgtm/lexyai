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
  graphGet,
  ensureAccessToken,
} from "../_shared/outlookGraph.ts";
import { resolveCaller } from "../_shared/callerIdentity.ts";
import {
  matchMessage,
  classifyEvidence,
  isExcludedMessage,
  isLowContentMessage,
  classifyEvidenceSubtype,
  classifyMemorialSubtype,
  isSgdeMessage,
  parseSgdeEvidence,
  extractExpedienteAccessUrl,
  extractRadicados,
  extractRadicadoCandidates,
  decomposeStoredRadicado,
  isRepartoMessage,
  extractRepartoRadicados,
  buildOwnerIdentity,
  type OwnerIdentity,
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
const FULL_SWEEP_PAGE_LIMIT = 40; // páginas por carpeta en barrido completo
const DEFAULT_LOOKBACK_MONTHS = 12;

type Admin = ReturnType<typeof createClient>;

interface Connection {
  id: string;
  user_id: string;
  organization_id: string | null;
  ms_account_email: string | null;
  access_token_cipher: string | null;
  access_token_nonce: string | null;
  refresh_token_cipher: string | null;
  refresh_token_nonce: string | null;
  token_expires_at: string | null;
  delta_token_inbox: string | null;
  delta_token_sent: string | null;
}

/**
 * A message sent from Andromeda already produced a link row keyed by a
 * synthetic `manual:` id. When the same message reappears in Sent Items we
 * upgrade that row instead of inserting a duplicate.
 */
async function reconcileManualLink(
  admin: Admin,
  workItemId: string,
  msg: GraphMessage,
): Promise<boolean> {
  const sentAt = msg.sentDateTime ?? msg.receivedDateTime;
  if (!sentAt) return false;
  const t = Date.parse(sentAt);
  const { data } = await admin
    .from("work_item_email_links")
    .select("id, message_id, internet_message_id, subject")
    .eq("work_item_id", workItemId)
    .eq("direction", "sent")
    .like("message_id", "manual:%")
    .gte("received_at", new Date(t - 15 * 60_000).toISOString())
    .lte("received_at", new Date(t + 15 * 60_000).toISOString());

  const candidate = (data ?? []).find((row: Record<string, unknown>) =>
    (msg.internetMessageId && row.internet_message_id === msg.internetMessageId) ||
    ((row.subject ?? "") === (msg.subject ?? ""))
  );
  if (!candidate) return false;

  await admin
    .from("work_item_email_links")
    .update({
      message_id: msg.id,
      internet_message_id: msg.internetMessageId ?? null,
      conversation_id: msg.conversationId ?? null,
      web_link: msg.webLink ?? null,
      has_attachments: Boolean(msg.hasAttachments),
    })
    .eq("id", (candidate as { id: string }).id);
  return true;
}

/**
 * Identidad del titular del buzón: su nombre y el de su firma nunca deben
 * generar un match CLIENTE/PARTE (firma todos los correos salientes).
 */
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
    .select("id, organization_id, radicado, authority_name, authority_email, demandantes, demandados, title, workflow_type, clients(name)")
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

/**
 * Barrido completo: ignora el delta token y relee la carpeta hasta N meses
 * atrás. Necesario porque el delta solo entrega novedades desde la conexión,
 * dejando fuera el correo histórico (tutelas y repartos previos).
 */
async function readFolderFullSweep(
  accessToken: string,
  folder: "inbox" | "sentitems",
  sinceIso: string,
): Promise<{ messages: GraphMessage[]; deltaLink: null }> {
  let url =
    `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages` +
    `?$select=${SELECT}&$top=50&$orderby=receivedDateTime desc` +
    `&$filter=receivedDateTime ge ${sinceIso}`;
  const messages: GraphMessage[] = [];

  for (let page = 0; page < FULL_SWEEP_PAGE_LIMIT; page++) {
    const res = await graphGet(url, accessToken);
    for (const m of (res.value as GraphMessage[]) ?? []) {
      if (m?.id) messages.push(m);
    }
    const next = res["@odata.nextLink"] as string | undefined;
    if (!next) break;
    url = next;
  }
  return { messages, deltaLink: null };
}

interface SyncOptions {
  fullSweep: boolean;
  lookbackMonths: number;
}

async function syncConnection(admin: Admin, conn: Connection, options: SyncOptions) {
  const summary = {
    connection_id: conn.id,
    full_sweep: options.fullSweep,
    lookback_months: options.fullSweep ? options.lookbackMonths : null,
    messages_scanned: 0,
    links_created: 0,
    suggestions_created: 0,
    memorial_evidence: 0,
    detected_processes: 0,
    folders: {} as Record<string, number>,
    earliest_message_at: null as string | null,
  };

  const accessToken = await ensureAccessToken(admin, conn);
  const portfolio = await loadPortfolio(admin, conn);
  const owner = await loadOwnerIdentity(admin, conn);
  const knownRadicados = new Set(
    portfolio
      .map((p) => (p.radicado ?? "").replace(/\D/g, ""))
      .filter((r) => r.length === 23),
  );
  // Identidad del proceso = BASE de 21 dígitos (la instancia es metadato).
  const knownBases = new Set(
    portfolio
      .map((p) => decomposeStoredRadicado(p.radicado)?.base)
      .filter((b): b is string => Boolean(b)),
  );
  // Detecciones previas del usuario, indexadas por BASE (evita una segunda
  // fila para el mismo proceso en otra instancia).
  const { data: priorDetections } = await admin
    .from("detected_processes")
    .select("id, radicado, occurrences, meta, first_seen_at, last_seen_at")
    .eq("user_id", conn.user_id);
  const detectionsByBase = new Map<string, {
    id: string;
    occurrences: number;
    meta: Record<string, unknown> | null;
    first_seen_at: string | null;
    last_seen_at: string | null;
  }>();
  for (const d of (priorDetections ?? []) as {
    id: string; radicado: string; occurrences?: number; meta?: Record<string, unknown> | null;
    first_seen_at?: string | null; last_seen_at?: string | null;
  }[]) {
    const base = decomposeStoredRadicado(d.radicado)?.base;
    if (base) {
      detectionsByBase.set(base, {
        id: d.id,
        occurrences: d.occurrences ?? 1,
        meta: d.meta ?? null,
        first_seen_at: d.first_seen_at ?? null,
        last_seen_at: d.last_seen_at ?? null,
      });
    }
  }

  const folders: { folder: "inbox" | "sentitems"; direction: "received" | "sent"; token: string | null; column: string }[] = [
    { folder: "inbox", direction: "received", token: conn.delta_token_inbox, column: "delta_token_inbox" },
    { folder: "sentitems", direction: "sent", token: conn.delta_token_sent, column: "delta_token_sent" },
  ];

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - options.lookbackMonths);
  const sinceIso = since.toISOString().replace(/\.\d{3}Z$/, "Z");

  for (const f of folders) {
    const { messages, deltaLink } = options.fullSweep
      ? await readFolderFullSweep(accessToken, f.folder, sinceIso)
      : await readFolder(accessToken, f.folder, f.token);
    summary.messages_scanned += messages.length;
    summary.folders[f.folder] = (summary.folders[f.folder] ?? 0) + messages.length;

    for (const msg of messages) {
      const msgAt = msg.receivedDateTime ?? msg.sentDateTime ?? null;
      if (msgAt && (!summary.earliest_message_at || msgAt < summary.earliest_message_at)) {
        summary.earliest_message_at = msgAt;
      }
      // Exclusiones duras: monitoreo propio y auto-informes multi-radicado.
      if (isExcludedMessage(msg, conn.ms_account_email ?? null)) continue;

      // SGDE: único caso donde se lee el cuerpo (en memoria, nunca se guarda)
      // para extraer el enlace de acceso al expediente electrónico.
      let sgde: ReturnType<typeof parseSgdeEvidence> | null = null;
      if (isSgdeMessage(msg)) {
        try {
          const full = await graphGet(
            `https://graph.microsoft.com/v1.0/me/messages/${msg.id}?$select=body`,
            accessToken,
          );
          const bodyContent =
            ((full as { body?: { content?: string } }).body?.content ?? "") as string;
          sgde = parseSgdeEvidence(msg, bodyContent);
        } catch (e) {
          console.error("[outlook-sync] sgde body", (e as Error).message);
          sgde = parseSgdeEvidence(msg, msg.bodyPreview ?? "");
        }
      }

      const matches = matchMessage(msg, portfolio, {
        selfAddress: conn.ms_account_email ?? null,
        owner,
      });

      // Repartos: el radicado del día cero vive en el cuerpo estructurado.
      // Se lee en memoria y jamás se persiste.
      let repartoRadicados: string[] = [];
      if (isRepartoMessage(msg)) {
        try {
          const full = await graphGet(
            `https://graph.microsoft.com/v1.0/me/messages/${msg.id}?$select=body`,
            accessToken,
          );
          const bodyContent =
            ((full as { body?: { content?: string } }).body?.content ?? "") as string;
          repartoRadicados = extractRepartoRadicados(bodyContent);
        } catch (e) {
          console.error("[outlook-sync] reparto body", (e as Error).message);
        }
      }

      // FASE C — radicados válidos que NO están en la cartera del usuario.
      // Nunca se crea el expediente en silencio: solo se encola para triage.
      const detectedCandidates = new Map<string, { canonical: string; instance: string | null }>();
      for (
        const c of extractRadicadoCandidates(`${msg.subject ?? ""} ${msg.bodyPreview ?? ""}`)
      ) {
        if (!detectedCandidates.has(c.base)) {
          detectedCandidates.set(c.base, { canonical: c.canonical, instance: c.instance });
        }
      }
      for (const rad of repartoRadicados) {
        const c = decomposeStoredRadicado(rad);
        if (c && !detectedCandidates.has(c.base)) {
          detectedCandidates.set(c.base, { canonical: c.canonical, instance: c.instance });
        }
      }
      for (const [base, cand] of detectedCandidates) {
        if (knownBases.has(base) || knownRadicados.has(cand.canonical)) continue;
        const seenAt = msg.receivedDateTime ?? msg.sentDateTime ?? new Date().toISOString();
        const existing = detectionsByBase.get(base);
        if (existing) {
          const seen = new Set<string>([
            ...((existing.meta?.instances_seen as string[] | undefined) ?? []),
            ...(cand.instance ? [cand.instance] : []),
          ]);
          // El barrido procesa de más nuevo a más viejo: los timestamps son
          // monótonos (first = LEAST, last = GREATEST), nunca sobrescritura ciega.
          const nextFirst = existing.first_seen_at && existing.first_seen_at < seenAt
            ? existing.first_seen_at
            : seenAt;
          const nextLast = existing.last_seen_at && existing.last_seen_at > seenAt
            ? existing.last_seen_at
            : seenAt;
          await admin
            .from("detected_processes")
            .update({
              first_seen_at: nextFirst,
              last_seen_at: nextLast,
              occurrences: existing.occurrences + 1,
              meta: {
                ...(existing.meta ?? {}),
                instances_seen: [...seen].sort(),
              },
            })
            .eq("id", existing.id);
          existing.occurrences += 1;
          existing.first_seen_at = nextFirst;
          existing.last_seen_at = nextLast;
          existing.meta = { ...(existing.meta ?? {}), instances_seen: [...seen].sort() };
          continue;
        }
        const { data: inserted, error: detErr } = await admin.from("detected_processes").insert({
          user_id: conn.user_id,
          organization_id: conn.organization_id,
          radicado: cand.canonical,
          message_id: msg.id,
          internet_message_id: msg.internetMessageId ?? null,
          subject: msg.subject ?? null,
          sender:
            msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null,
          web_link: msg.webLink ?? null,
          first_seen_at: seenAt,
          last_seen_at: seenAt,
          status: "PENDING",
          meta: cand.instance ? { instances_seen: [cand.instance] } : {},
        }).select("id").maybeSingle();
        if (detErr) console.error("[outlook-sync] detected_processes", detErr.message);
        else {
          summary.detected_processes++;
          if (inserted) {
            detectionsByBase.set(base, {
              id: (inserted as { id: string }).id,
              occurrences: 1,
              meta: cand.instance ? { instances_seen: [cand.instance] } : {},
              first_seen_at: seenAt,
              last_seen_at: seenAt,
            });
          }
        }
      }

      for (const match of matches) {
        if (match.confidence < 0.5) continue;
        if (f.direction === "sent" && await reconcileManualLink(admin, match.work_item_id, msg)) {
          continue;
        }
        const confirmed = match.confidence >= 0.7;
        let evidence = confirmed
          ? classifyEvidence(msg, f.direction, match.matched_by)
          : null;
        let linkStatus = confirmed ? "CONFIRMED" : "SUGGESTED";
        let evidenceMeta: Record<string, unknown> | null = null;

        if (sgde) {
          evidence = "SGDE_ACCESO_EXPEDIENTE";
          evidenceMeta = {
            access_url: sgde.access_url,
            allowed_until: sgde.allowed_until,
            expired: sgde.expired,
            // Vencido = evidencia histórica: no se ofrece para poblar el WI.
            offer_access_link: Boolean(sgde.access_url) && !sgde.expired,
          };
          // Nunca autopoblar: si sirve, va a la cola de sugeridos para que el
          // usuario confirme; si venció, queda como evidencia histórica.
          linkStatus = sgde.expired ? "CONFIRMED" : "SUGGESTED";
        }
        else {
          // Alfresco / TYBA / SGDE citados por el juzgado: mismo flujo de
          // confirmación, sin leer el cuerpo (basta asunto + preview).
          const expedienteUrl = extractExpedienteAccessUrl(
            msg,
            msg.bodyPreview ?? "",
          );
          if (expedienteUrl) {
            evidenceMeta = { access_url: expedienteUrl, offer_access_link: true };
            linkStatus = "SUGGESTED";
          }
        }

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
          evidence_subtype:
            f.direction === "received"
              ? classifyEvidenceSubtype(
                  msg.subject,
                  msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null,
                )
              : null,
          memorial_subtype:
            f.direction === "sent" ? classifyMemorialSubtype(msg.subject) : null,
          evidence_meta: match.instance_observed
            ? { ...(evidenceMeta ?? {}), instance_observed: match.instance_observed }
            : evidenceMeta,
          low_content: isLowContentMessage(msg),
          link_status: linkStatus,
        };

        const { error } = await admin
          .from("work_item_email_links")
          .upsert(row, { onConflict: "message_id,work_item_id", ignoreDuplicates: true });
        if (error) {
          console.error("[outlook-sync] link upsert", error.message);
          continue;
        }
        if (linkStatus === "CONFIRMED") summary.links_created++;
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

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch { /* body vacío */ }
    const fullSweep = body.full_sweep === true;
    const rawLookback = Number(body.lookback_months);
    const lookbackMonths =
      Number.isFinite(rawLookback) && rawLookback >= 1 && rawLookback <= 36
        ? Math.floor(rawLookback)
        : DEFAULT_LOOKBACK_MONTHS;

    let connections: Connection[] = [];
    const columns =
      "id, user_id, organization_id, ms_account_email, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, token_expires_at, delta_token_inbox, delta_token_sent";

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
        results.push(await syncConnection(admin, conn, { fullSweep, lookbackMonths }));
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