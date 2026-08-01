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
  isJudicialCounterpart,
  isJudicialAddress,
  bodyToText,
  extractBodyRadicadoCandidates,
  extractNij,
  type OwnerIdentity,
  type GraphMessage,
  type PortfolioItem,
} from "../_shared/emailMatcher.ts";
import {
  aiClassifyEmail,
  newAiGatewayState,
  AI_CONFIDENCE_CAP,
  type AiClassification,
  type AiGatewayState,
} from "../_shared/aiClassifyEmail.ts";

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

/**
 * Lectura universal del cuerpo (iteración 5). Se pide a Graph solo el campo
 * `body`, se convierte a texto acotado a 20KB y se descarta apenas se extraen
 * los identificadores: nunca se persiste.
 */
async function fetchBodyText(accessToken: string, messageId: string): Promise<string> {
  const full = await graphGet(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=body`,
    accessToken,
  );
  return bodyToText(((full as { body?: { content?: string } }).body?.content ?? "") as string);
}

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
/**
 * SEMÁNTICA DE TOPES (decisión iteración 5.2, deliberada):
 *
 * - Lectura de cuerpos: tope POR TRAMO (`BODY_READS_PER_CHUNK`). Una cadena de
 *   varios tramos puede acumular múltiplos de este tope (p. ej. 720 en 3
 *   tramos) y eso es aceptable: el coste es únicamente de llamadas a Graph, el
 *   cuerpo vive en memoria y nunca se persiste. El tope solo existe para que
 *   un tramo no agote su presupuesto de ~105 s leyendo cuerpos.
 * - Llamadas a IA: tope POR CADENA (`AI_CALLS_PER_CHAIN`, aplicado a través de
 *   `aiState.calls`, que se rehidrata desde el checkpoint en cada reanudación).
 *   Ese coste sí es monetario y acumulativo, así que el barrido completo nunca
 *   supera el tope aunque use 40 tramos.
 */
const BODY_READS_PER_CHUNK = 300;

/**
 * El gateway HTTP corta a ~150 s. Un barrido de 12 meses no cabe en una sola
 * invocación: se ejecuta por tramos de ~105 s que se auto-reinvocan.
 */
const CHUNK_BUDGET_MS = 105_000;
/** Tope de tramos encadenados por barrido (freno de bucle infinito). */
const CHAIN_CAP = 40;
/** Una corrida RUNNING sin latido durante este tiempo se considera muerta. */
const STALE_RUN_MS = 15 * 60_000;

export interface SweepCheckpoint {
  folder_index: number;
  next_link: string | null;
  since_iso: string;
  chunk_index: number;
  started_at: string;
  messages_scanned: number;
  folders: Record<string, number>;
  earliest_message_at: string | null;
  /** Acumulado de la CADENA (informativo). */
  bodies_read: number;
  /** Leídos en el ÚLTIMO tramo: el tope de cuerpos es por tramo. */
  body_reads_chunk: number;
  /** Acumulado de la CADENA: el tope de IA es por cadena. */
  ai_calls: number;
  detected_new: number;
  detected_updated: number;
  detected_skipped: number;
  links_created: number;
  suggestions_created: number;
  errors: number;
  last_error: string | null;
}

export function newCheckpoint(sinceIso: string, startedAt: string): SweepCheckpoint {
  return {
    folder_index: 0,
    next_link: null,
    since_iso: sinceIso,
    chunk_index: 0,
    started_at: startedAt,
    messages_scanned: 0,
    folders: {},
    earliest_message_at: null,
    bodies_read: 0,
    body_reads_chunk: 0,
    ai_calls: 0,
    detected_new: 0,
    detected_updated: 0,
    detected_skipped: 0,
    links_created: 0,
    suggestions_created: 0,
    errors: 0,
    last_error: null,
  };
}

interface SweepCtx {
  runId: string;
  checkpoint: SweepCheckpoint;
  /** Instante de entrada a ESTA invocación: el presupuesto se mide desde aquí. */
  invokedAt: number;
}

type SweepSummary = {
  messages_scanned: number;
  folders: Record<string, number>;
  earliest_message_at: string | null;
  bodies_read: number;
  body_reads_chunk: number;
  ai_calls: number;
  detected_new: number;
  detected_updated: number;
  detected_skipped: number;
  links_created: number;
  suggestions_created: number;
  reconciled: number;
  errors: number;
  last_error: string | null;
};

/** Vuelca los contadores acumulados de la cadena al checkpoint. */
function syncCheckpointCounters(cp: SweepCheckpoint, s: SweepSummary) {
  cp.messages_scanned = s.messages_scanned;
  cp.folders = { ...s.folders };
  cp.earliest_message_at = s.earliest_message_at;
  cp.bodies_read = s.bodies_read;
  cp.body_reads_chunk = s.body_reads_chunk;
  cp.ai_calls = s.ai_calls;
  cp.detected_new = s.detected_new;
  cp.detected_updated = s.detected_updated;
  cp.detected_skipped = s.detected_skipped;
  cp.links_created = s.links_created;
  cp.suggestions_created = s.suggestions_created;
  cp.errors = s.errors;
  cp.last_error = s.last_error;
}

/**
 * Latido del barrido: cada tramo escribe contadores ACUMULADOS y el punto de
 * reanudación, para que la UI muestre progreso real y la cadena pueda seguir.
 */
async function persistSweepProgress(
  admin: Admin,
  sweep: SweepCtx,
  summary: SweepSummary,
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED",
  errorReason?: string,
) {
  syncCheckpointCounters(sweep.checkpoint, summary);
  const patch: Record<string, unknown> = {
    status,
    checkpoint: sweep.checkpoint as unknown as Record<string, unknown>,
    chunk_index: sweep.checkpoint.chunk_index,
    messages_scanned: summary.messages_scanned,
    folders: summary.folders,
    earliest_message_at: summary.earliest_message_at,
    bodies_read: summary.bodies_read,
    body_reads_chunk: summary.body_reads_chunk,
    ai_calls: summary.ai_calls,
    detected_new: summary.detected_new,
    detected_updated: summary.detected_updated,
    detected_skipped: summary.detected_skipped,
    reconciled: summary.reconciled,
    links_created: summary.links_created,
    suggestions_created: summary.suggestions_created,
    errors: summary.errors,
    last_error: errorReason ?? summary.last_error,
    updated_at: new Date().toISOString(),
  };
  if (status !== "RUNNING") patch.finished_at = new Date().toISOString();
  const { error } = await admin.from("sync_full_sweep_runs").update(patch).eq("id", sweep.runId);
  if (error) console.error("[outlook-sync] sweep progress", error.message);
}

/**
 * Auto-reinvocación: se dispara la siguiente invocación con la clave de
 * servicio y se responde 200 de inmediato (fire-and-forget acotado).
 */
async function chainNextChunk(
  admin: Admin,
  sweep: SweepCtx,
  summary: SweepSummary,
): Promise<void> {
  if (sweep.checkpoint.chunk_index + 1 >= CHAIN_CAP) {
    await persistSweepProgress(admin, sweep, summary, "FAILED", "chain_cap");
    return;
  }
  sweep.checkpoint.chunk_index += 1;
  await persistSweepProgress(admin, sweep, summary, "RUNNING");

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/outlook-sync`;
  const call = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ full_sweep: true, resume_run_id: sweep.runId }),
  }).catch((e) => console.error("[outlook-sync] chain", (e as Error).message));

  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  // Se espera solo a que la petición salga: el hijo no bloquea al padre.
  const dispatched = Promise.race([call, new Promise((r) => setTimeout(r, 3_000))]);
  if (rt?.waitUntil) rt.waitUntil(dispatched);
  else await dispatched;
}

/**
 * Abre un barrido completo. Guarda de concurrencia: si ya hay uno RUNNING con
 * latido fresco se devuelve su id; los RUNNING muertos (>15 min) se marcan
 * SUPERSEDED y no bloquean.
 */
async function startSweepRun(
  admin: Admin,
  conn: Connection,
  lookbackMonths: number,
): Promise<{ sweep: SweepCtx } | { busy: string }> {
  const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString();

  const { data: running } = await admin
    .from("sync_full_sweep_runs")
    .select("id, updated_at")
    .eq("connection_id", conn.id)
    .eq("status", "RUNNING")
    .order("updated_at", { ascending: false });

  for (const r of (running ?? []) as { id: string; updated_at: string }[]) {
    if (r.updated_at > staleBefore) return { busy: r.id };
  }
  if ((running ?? []).length > 0) {
    await admin
      .from("sync_full_sweep_runs")
      .update({ status: "SUPERSEDED", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("connection_id", conn.id)
      .eq("status", "RUNNING");
  }

  const startedAt = new Date().toISOString();
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - lookbackMonths);
  const sinceIso = since.toISOString().replace(/\.\d{3}Z$/, "Z");

  const { data: run, error } = await admin
    .from("sync_full_sweep_runs")
    .insert({
      user_id: conn.user_id,
      organization_id: conn.organization_id,
      connection_id: conn.id,
      full_sweep: true,
      lookback_months: lookbackMonths,
      status: "RUNNING",
      started_at: startedAt,
      checkpoint: newCheckpoint(sinceIso, startedAt) as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo abrir el barrido: ${error.message}`);

  return {
    sweep: {
      runId: run.id as string,
      checkpoint: newCheckpoint(sinceIso, startedAt),
      invokedAt: Date.now(),
    },
  };
}

/**
 * Único punto donde se arma `evidence_meta`. Solo persiste identificadores,
 * subtipo, resumen (<=200) y marcas de tiempo: JAMÁS el cuerpo del correo.
 */
export function buildEvidenceMeta(
  base: Record<string, unknown> | null,
  extra: {
    instanceObserved?: string | null;
    matchedInBody?: boolean;
    nij?: string | null;
    ai?: AiClassification | null;
  },
): Record<string, unknown> | null {
  const meta: Record<string, unknown> = { ...(base ?? {}) };
  if (extra.instanceObserved) meta.instance_observed = extra.instanceObserved;
  if (extra.matchedInBody) meta.matched_in = "body";
  if (extra.nij) meta.nij = extra.nij;
  if (extra.ai) {
    meta.ai_classified = true;
    meta.ai_confidence = AI_CONFIDENCE_CAP;
    if (extra.ai.resumen) meta.ai_summary = extra.ai.resumen.slice(0, 200);
    if (extra.ai.audiencia_fecha) meta.audiencia_fecha = extra.ai.audiencia_fecha;
    if (extra.ai.termino_dias) meta.termino_dias = extra.ai.termino_dias;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

async function syncConnection(
  admin: Admin,
  conn: Connection,
  options: SyncOptions,
  aiState: AiGatewayState,
  sweep?: SweepCtx,
) {
  const startedAt = new Date().toISOString();
  const summary = {
    connection_id: conn.id,
    full_sweep: options.fullSweep,
    lookback_months: options.fullSweep ? options.lookbackMonths : null,
    messages_scanned: 0,
    links_created: 0,
    suggestions_created: 0,
    memorial_evidence: 0,
    detected_processes: 0,
    detected_new: 0,
    detected_updated: 0,
    detected_skipped: 0,
    reconciled: 0,
    bodies_read: 0,
    // Se reinicia en cada tramo: el tope de cuerpos es POR TRAMO.
    body_reads_chunk: 0,
    ai_calls: 0,
    ai_classified: 0,
    errors: 0,
    last_error: null as string | null,
    folders: {} as Record<string, number>,
    earliest_message_at: null as string | null,
    started_at: startedAt,
    finished_at: null as string | null,
  };

  // Reanudación: los contadores de la CADENA son acumulativos. El tope de IA
  // se aplica al total de la cadena (se rehidrata `aiState.calls`); el tope de
  // lectura de cuerpos se reinicia en cada tramo por diseño (ver comentario
  // en BODY_READS_PER_CHUNK).
  if (sweep) {
    const cp = sweep.checkpoint;
    summary.started_at = cp.started_at;
    summary.messages_scanned = cp.messages_scanned;
    summary.folders = { ...cp.folders };
    summary.earliest_message_at = cp.earliest_message_at;
    summary.bodies_read = cp.bodies_read;
    summary.ai_calls = cp.ai_calls;
    summary.detected_new = cp.detected_new;
    summary.detected_updated = cp.detected_updated;
    summary.detected_skipped = cp.detected_skipped;
    summary.links_created = cp.links_created;
    summary.suggestions_created = cp.suggestions_created;
    summary.errors = cp.errors;
    summary.last_error = cp.last_error;
    aiState.calls = cp.ai_calls;
  }

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

  /**
   * Procesamiento de UN mensaje. Extraído del bucle de carpetas para que el
   * barrido encadenado pueda invocarlo página a página sin duplicar lógica.
   */
  const processMessage = async (msg: GraphMessage, direction: "received" | "sent") => {
    {
      const msgAt = msg.receivedDateTime ?? msg.sentDateTime ?? null;
      if (msgAt && (!summary.earliest_message_at || msgAt < summary.earliest_message_at)) {
        summary.earliest_message_at = msgAt;
      }
      // Exclusiones duras: monitoreo propio y auto-informes multi-radicado.
      if (isExcludedMessage(msg, conn.ms_account_email ?? null)) return;

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
          repartoRadicados = extractRepartoRadicados(await fetchBodyText(accessToken, msg.id));
          summary.bodies_read++;
          summary.body_reads_chunk++;
        } catch (e) {
          console.error("[outlook-sync] reparto body", (e as Error).message);
        }
      }

      // ---- PARTE A (iter 5): lectura universal del cuerpo judicial ----
      // Todo mensaje con contraparte judicial cuyo ASUNTO no produjo match se
      // relee en memoria: el radicado suele vivir solo en la línea "REF.:".
      const judicial = isJudicialCounterpart(msg);
      let bodyText = "";
      let bodyMatched = false;
      let nij: string | null = null;
      const bodyCandidates: { canonical: string; instance: string | null }[] = [];

      // Se relee el cuerpo cuando el ASUNTO no produjo un match POR RADICADO:
      // un match por nombre de parte no acredita identidad procesal, y el
      // radicado real suele vivir en la línea "REF.:" del cuerpo.
      const radicadoMatched = matches.some((m) => m.matched_by.startsWith("RADICADO"));
      if (judicial && !radicadoMatched && summary.body_reads_chunk < BODY_READS_PER_CHUNK) {
        try {
          bodyText = await fetchBodyText(accessToken, msg.id);
          summary.bodies_read++;
          summary.body_reads_chunk++;
        } catch (e) {
          console.error("[outlook-sync] body read", (e as Error).message);
        }
      }

      if (bodyText) {
        nij = extractNij(`${msg.subject ?? ""}\n${bodyText}`);
        for (const c of extractBodyRadicadoCandidates(bodyText)) {
          bodyCandidates.push({ canonical: c.canonical, instance: c.instance });
        }
        // Los radicados del cuerpo entran al pipeline normal: se rematchea el
        // mensaje sustituyendo el preview por el texto leído en memoria.
        const bodyMatches = matchMessage(
          { ...msg, bodyPreview: bodyText },
          portfolio,
          { selfAddress: conn.ms_account_email ?? null, owner },
        );
        for (const bm of bodyMatches) {
          if (!matches.some((m) => m.work_item_id === bm.work_item_id)) {
            matches.push(bm);
            bodyMatched = true;
          }
        }
      }

      // ---- PARTE B (iter 5): capa semántica IA sobre lo opaco ----
      let ai: AiClassification | null = null;
      const regexSubtype = direction === "received"
        ? classifyEvidenceSubtype(
          msg.subject,
          msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null,
        )
        : null;
      const senderJudicial = isJudicialAddress(
        msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null,
      );
      if (
        direction === "received" && senderJudicial && matches.length > 0 &&
        (regexSubtype === null || regexSubtype === "OTRO_JUDICIAL" ||
          // La citación necesita la FECHA de la audiencia, que el regex no da.
          regexSubtype === "CITACION_AUDIENCIA")
      ) {
        if (!bodyText) {
          try {
            bodyText = await fetchBodyText(accessToken, msg.id);
            summary.bodies_read++;
          summary.body_reads_chunk++;
            nij = nij ?? extractNij(`${msg.subject ?? ""}\n${bodyText}`);
          } catch (e) {
            console.error("[outlook-sync] ai body read", (e as Error).message);
          }
        }
        if (bodyText) {
          const before = aiState.calls;
          ai = await aiClassifyEmail({ subject: msg.subject, bodyText }, aiState, LOVABLE_API_KEY);
          summary.ai_calls += aiState.calls - before;
          if (ai) summary.ai_classified++;
        }
      }
      // El cuerpo muere aquí: solo sobreviven identificadores y metadatos.
      bodyText = "";

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
      for (const c of bodyCandidates) {
        const d = decomposeStoredRadicado(c.canonical);
        if (d && !detectedCandidates.has(d.base)) {
          detectedCandidates.set(d.base, { canonical: c.canonical, instance: c.instance });
        }
      }
      for (const rad of ai?.radicados ?? []) {
        const d = decomposeStoredRadicado(rad);
        if (d && !detectedCandidates.has(d.base)) {
          detectedCandidates.set(d.base, { canonical: d.canonical, instance: d.instance });
        }
      }
      for (const rad of repartoRadicados) {
        const c = decomposeStoredRadicado(rad);
        if (c && !detectedCandidates.has(c.base)) {
          detectedCandidates.set(c.base, { canonical: c.canonical, instance: c.instance });
        }
      }
      for (const [base, cand] of detectedCandidates) {
        if (knownBases.has(base) || knownRadicados.has(cand.canonical)) {
          summary.detected_skipped++;
          continue;
        }
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
          summary.detected_updated++;
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
        if (detErr) {
          console.error("[outlook-sync] detected_processes", detErr.message);
          summary.errors++;
          summary.last_error = detErr.message.slice(0, 500);
        }
        else {
          summary.detected_processes++;
          summary.detected_new++;
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
        if (direction === "sent" && await reconcileManualLink(admin, match.work_item_id, msg)) {
          continue;
        }
        const confirmed = match.confidence >= 0.7;
        let evidence = confirmed
          ? classifyEvidence(msg, direction, match.matched_by)
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
          direction: direction,
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
          // El AI solo desempata lo opaco: nunca pisa una certeza del regex.
          evidence_subtype: direction === "received" ? (ai?.subtype ?? regexSubtype) : null,
          memorial_subtype:
            direction === "sent" ? classifyMemorialSubtype(msg.subject) : null,
          evidence_meta: buildEvidenceMeta(evidenceMeta, {
            instanceObserved: match.instance_observed ?? ai?.instancia ?? null,
            matchedInBody: bodyMatched,
            nij,
            ai,
          }),
          ai_classified: Boolean(ai),
          ai_classified_at: ai ? new Date().toISOString() : null,
          low_content: isLowContentMessage(msg),
          link_status: linkStatus,
        };

        const { error } = await admin
          .from("work_item_email_links")
          .upsert(row, { onConflict: "message_id,work_item_id", ignoreDuplicates: true });
        if (error) {
          console.error("[outlook-sync] link upsert", error.message);
          summary.errors++;
          summary.last_error = error.message.slice(0, 500);
          continue;
        }
        if (linkStatus === "CONFIRMED") summary.links_created++;
        else summary.suggestions_created++;
        if (evidence === "MEMORIAL_ENVIADO") summary.memorial_evidence++;
      }
    }
  };

  let chained = false;
  if (sweep) {
    // ---- Barrido encadenado: se avanza por páginas de Graph hasta agotar el
    // presupuesto de tiempo; entonces se persiste el cursor y se reinvoca.
    const cp = sweep.checkpoint;
    for (let fi = cp.folder_index; fi < folders.length && !chained; fi++) {
      const f = folders[fi];
      cp.folder_index = fi;
      let url = cp.next_link ??
        `https://graph.microsoft.com/v1.0/me/mailFolders/${f.folder}/messages` +
          `?$select=${SELECT}&$top=50&$orderby=receivedDateTime desc` +
          `&$filter=receivedDateTime ge ${cp.since_iso}`;
      for (;;) {
        const res = await graphGet(url, accessToken);
        const page = ((res.value as GraphMessage[]) ?? []).filter((m) => m?.id);
        summary.messages_scanned += page.length;
        summary.folders[f.folder] = (summary.folders[f.folder] ?? 0) + page.length;
        for (const msg of page) await processMessage(msg, f.direction);

        const next = (res["@odata.nextLink"] as string | undefined) ?? null;
        cp.next_link = next;
        if (!next) {
          cp.folder_index = fi + 1;
          cp.next_link = null;
        }
        await persistSweepProgress(admin, sweep, summary, "RUNNING");
        if (!next) break;
        if (Date.now() - sweep.invokedAt > CHUNK_BUDGET_MS) {
          await chainNextChunk(admin, sweep, summary);
          chained = true;
          break;
        }
        url = next;
      }
    }
  } else {
    for (const f of folders) {
      const { messages, deltaLink } = await readFolder(accessToken, f.folder, f.token);
      summary.messages_scanned += messages.length;
      summary.folders[f.folder] = (summary.folders[f.folder] ?? 0) + messages.length;
      for (const msg of messages) await processMessage(msg, f.direction);
      if (deltaLink) {
        await admin.from("user_email_connections").update({ [f.column]: deltaLink }).eq("id", conn.id);
      }
    }
  }

  // Tramo intermedio: la cadena sigue viva, no se cierra nada todavía.
  if (chained) return summary;

  await admin
    .from("user_email_connections")
    .update({ last_sync_at: new Date().toISOString(), status: "CONNECTED", last_error: null })
    .eq("id", conn.id);

  // Reconciliación: detecciones cuya BASE ya está en la cartera salen de la
  // cola pendiente (estado terminal MATCHED_EXISTING), nunca se borran.
  try {
    const { data: reconciled, error: recErr } = await admin.rpc(
      "reconcile_detected_processes",
      { p_user_id: conn.user_id },
    );
    if (recErr) throw new Error(recErr.message);
    summary.reconciled = Number(reconciled ?? 0);
  } catch (e) {
    console.error("[outlook-sync] reconcile", (e as Error).message);
    summary.errors++;
  }

  summary.finished_at = new Date().toISOString();

  // El gateway HTTP corta a ~150 s: el resumen vive en la fila del barrido,
  // que la cadena ha ido actualizando tramo a tramo.
  if (sweep) {
    await persistSweepProgress(
      admin,
      sweep,
      summary,
      summary.errors > 0 ? "PARTIAL" : "SUCCESS",
    );
  }

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
    const resumeRunId = typeof body.resume_run_id === "string" ? body.resume_run_id : null;
    const rawLookback = Number(body.lookback_months);
    const lookbackMonths =
      Number.isFinite(rawLookback) && rawLookback >= 1 && rawLookback <= 36
        ? Math.floor(rawLookback)
        : DEFAULT_LOOKBACK_MONTHS;

    let connections: Connection[] = [];
    const columns =
      "id, user_id, organization_id, ms_account_email, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, token_expires_at, delta_token_inbox, delta_token_sent";

    // ---- Reanudación de un tramo: solo la propia función (service role) puede
    // encadenar. No hay usuario detrás de esta invocación.
    const authHeader = req.headers.get("Authorization") ?? "";
    const isSelfCall =
      authHeader === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
    if (resumeRunId) {
      if (!isSelfCall && !isCron) return json({ error: "No autorizado" }, 403);
      const { data: run } = await admin
        .from("sync_full_sweep_runs")
        .select("id, connection_id, status, checkpoint, lookback_months")
        .eq("id", resumeRunId)
        .maybeSingle();
      if (!run) return json({ error: "Barrido no encontrado" }, 404);
      if (run.status !== "RUNNING") return json({ ok: true, skipped: run.status });
      const { data: conn } = await admin
        .from("user_email_connections")
        .select(columns)
        .eq("id", run.connection_id)
        .maybeSingle();
      if (!conn) return json({ error: "Conexión no encontrada" }, 404);
      const sweep: SweepCtx = {
        runId: run.id as string,
        checkpoint: run.checkpoint as SweepCheckpoint,
        invokedAt: Date.now(),
      };
      const aiStateResume = newAiGatewayState();
      try {
        const result = await syncConnection(
          admin,
          conn as unknown as Connection,
          { fullSweep: true, lookbackMonths: Number(run.lookback_months ?? lookbackMonths) },
          aiStateResume,
          sweep,
        );
        return json({ ok: true, run_id: sweep.runId, chunk: sweep.checkpoint.chunk_index, result });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error inesperado";
        console.error("[outlook-sync] resume failed", resumeRunId, message);
        await admin
          .from("sync_full_sweep_runs")
          .update({
            status: "FAILED",
            last_error: message.slice(0, 500),
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", resumeRunId);
        return json({ error: message }, 500);
      }
    }

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
    // Tope de 50 llamadas de IA por corrida, compartido entre conexiones.
    const aiState = newAiGatewayState();
    for (const conn of connections) {
      let sweep: SweepCtx | undefined;
      try {
        if (fullSweep) {
          const started = await startSweepRun(admin, conn, lookbackMonths);
          if ("busy" in started) {
            results.push({ connection_id: conn.id, running_run_id: started.busy });
            continue;
          }
          sweep = started.sweep;
        }
        results.push({
          run_id: sweep?.runId ?? null,
          ...(await syncConnection(admin, conn, { fullSweep, lookbackMonths }, aiState, sweep)),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error inesperado";
        console.error("[outlook-sync] connection failed", conn.id, message);
        if (sweep) {
          await admin
            .from("sync_full_sweep_runs")
            .update({
              status: "FAILED",
              last_error: message.slice(0, 500),
              finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", sweep.runId);
        }
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