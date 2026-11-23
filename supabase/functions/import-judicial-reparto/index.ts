import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, ensureAccessToken, GRAPH_BASE } from "../_shared/outlookGraph.ts";
import { extractRepartoSuggestions, hasPdfEnvelope, PDF_LIMIT, type RepartoSuggestions } from "./suggestions.ts";

const BUCKET = "judicial-reparto";
const IMPORTS = "judicial_reparto_imports";
const FIELDS = "id,work_item_id,source,message_subject,message_sender,message_received_at,message_url,pdf_name,pdf_path,pdf_sha256,suggestions,created_at";
const MAIL_FIELDS = "id,subject,from,receivedDateTime,webLink,hasAttachments";
const GRAPH_ID = /^[\w+=/-]{10,680}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GraphMail {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  receivedDateTime?: string;
  webLink?: string;
  hasAttachments?: boolean;
  body?: { contentType?: string; content?: string };
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType?: string;
  size: number;
  isInline?: boolean;
  "@odata.type"?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

class IntakeError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function safeOutlookUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    if (url.protocol === "https:" && !url.username && !url.password &&
      ["outlook.office365.com", "outlook.office.com", "outlook.live.com"].includes(url.hostname)) return url.href;
  } catch { /* Some Graph messages omit a browser URL. */ }
  return null;
}

function mailMetadata(mail: GraphMail) {
  return {
    id: mail.id,
    subject: mail.subject?.slice(0, 300) ?? null,
    sender: mail.from?.emailAddress?.address?.slice(0, 254) ?? null,
    received_at: mail.receivedDateTime && Number.isFinite(Date.parse(mail.receivedDateTime)) ? mail.receivedDateTime : null,
    web_link: safeOutlookUrl(mail.webLink),
    has_attachments: Boolean(mail.hasAttachments),
  };
}

async function readGraph(path: string, token: string): Promise<Response> {
  const response = await fetch(GRAPH_BASE + path, {
    headers: {
      Authorization: "Bearer " + token,
      Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) throw new IntakeError("No se encontró ese mensaje o adjunto en tu Outlook.", 404);
  if (!response.ok) throw new IntakeError("Outlook no pudo devolver este mensaje. Intenta de nuevo.", 502);
  return response;
}

async function listPdfs(path: string, token: string) {
  const body = await (await readGraph(path + "/attachments?$top=30&$select=id,name,contentType,size,isInline", token)).json();
  const attachments: GraphAttachment[] = body.value ?? [];
  return attachments.filter((file) => !file.isInline && file["@odata.type"] === "#microsoft.graph.fileAttachment" &&
    (file.contentType?.toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name)))
    .map((file) => ({ id: file.id, name: file.name.slice(0, 220), size: file.size }));
}

async function boundedBody(request: Request | Response, limit: number, sizeError: string): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length")) > limit) throw new IntakeError(sizeError, 413);
  if (!request.body) throw new IntakeError("La solicitud no contiene datos.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new IntakeError(sizeError, 413);
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

// The existing PDF reader keeps original bytes and disables evaluation. Only the
// first five pages are inspected here. Valid scans can be reviewed manually.
async function extractPdfText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  try {
    const { readEstadoPdf } = await import("../_shared/estadoPdfReading.ts");
    const read = await readEstadoPdf(bytes, [1, 2, 3, 4, 5]);
    return (read.pageTexts ?? []).join("\n").slice(0, 42_000);
  } catch {
    throw new IntakeError("No se pudo abrir el PDF. Comprueba que esté completo y se pueda leer sin contraseña.", 400);
  }
}

type IntakeFile = { name: string; bytes: Uint8Array<ArrayBuffer> };
type IntakeInput = { ownerId: string } & (
  | { source: "PDF"; file: IntakeFile; mail?: never; mailboxId?: never; detectedId?: never }
  | { source: "OUTLOOK"; file?: IntakeFile; mail: GraphMail; mailboxId: string; detectedId?: string }
);

async function prepareImport(admin: SupabaseClient, input: IntakeInput) {
  const { ownerId, source, mail, file, mailboxId, detectedId } = input;
  if (file && !hasPdfEnvelope(file.bytes)) throw new IntakeError("Selecciona un PDF válido de hasta 10 MB.", 400);
  const digest = file ? await sha256(file.bytes) : null;
  const sourceKey = source === "OUTLOOK" && !digest
    ? "mail:" + await sha256(new TextEncoder().encode(mailboxId + ":" + mail.id))
    : "pdf:" + digest;
  const pdfPath = digest ? ownerId + "/" + digest + ".pdf" : null;
  const selectedMail = mail ? mailMetadata(mail) : null;
  const mailColumns = {
    message_id: selectedMail?.id ?? null,
    message_subject: selectedMail?.subject ?? null,
    message_sender: selectedMail?.sender ?? null,
    message_received_at: selectedMail?.received_at ?? null,
    message_url: selectedMail?.web_link ?? null,
    detected_process_id: detectedId ?? null,
  };
  const lookup = () => admin.from(IMPORTS).select(FIELDS).eq("owner_id", ownerId).eq("source_key", sourceKey).maybeSingle();
  const { data: prior, error: lookupError } = await lookup();
  if (lookupError) throw new IntakeError("No se pudo comprobar si el comprobante ya está guardado.", 503);
  if (prior) {
    if (selectedMail && prior.source === "PDF" && !prior.message_sender) {
      const { error } = await admin.from(IMPORTS).update(mailColumns).eq("id", prior.id)
        .eq("owner_id", ownerId).is("message_id", null);
      if (error) throw new IntakeError("No se pudo conservar el correo de origen.", 503);
      const refreshed = await lookup();
      if (refreshed.error || !refreshed.data) throw new IntakeError("No se pudo leer el comprobante guardado.", 503);
      return refreshed.data;
    }
    return prior;
  }

  const pdfText = file ? await extractPdfText(file.bytes) : "";
  const mailText = mail?.body?.contentType?.toLowerCase() === "text" ? mail.body.content?.slice(0, 42_000) ?? "" : "";
  const suggestions: RepartoSuggestions = extractRepartoSuggestions(pdfText, mailText, selectedMail?.subject ?? "");
  if (file && pdfPath) {
    const { error } = await admin.storage.from(BUCKET).upload(pdfPath, file.bytes, { contentType: "application/pdf", upsert: false });
    if (error && !/already exists|duplicate/i.test(error.message)) {
      throw new IntakeError("No se pudo guardar el PDF original. Puedes volver a intentarlo.", 503);
    }
  }
  const { data, error } = await admin.from(IMPORTS).insert({
    owner_id: ownerId,
    source,
    source_key: sourceKey,
    ...mailColumns,
    pdf_name: file?.name.slice(0, 220) ?? null,
    pdf_path: pdfPath,
    pdf_sha256: digest,
    suggestions,
  }).select(FIELDS).single();
  if (!error && data) return data;
  if (error?.code === "23505") {
    const concurrent = await lookup();
    if (!concurrent.error && concurrent.data) return concurrent.data;
  }
  throw new IntakeError("No se pudo guardar la importación. Puedes volver a intentarlo.", 503);
}

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Inicia sesión en Andrómeda." }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const [{ data: who, error: authError }, { data: access }] = await Promise.all([
    userClient.auth.getUser(), userClient.rpc("mcp_access_level"),
  ]);
  if (authError || !who.user || access !== "first_party") return json({ error: "Inicia sesión en Andrómeda." }, 401);
  const ownerId = who.user.id;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const contentType = req.headers.get("content-type");
    if (contentType?.startsWith("multipart/form-data")) {
      const bytes = await boundedBody(req, PDF_LIMIT + 65_536, "El PDF debe pesar hasta 10 MB.");
      const parts = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
      const upload = parts.get("pdf");
      if (!(upload instanceof File) || upload.size > PDF_LIMIT) throw new IntakeError("Selecciona un PDF de hasta 10 MB.", 400);
      const file = { name: upload.name, bytes: new Uint8Array(await upload.arrayBuffer()) };
      return json({ draft: await prepareImport(admin, { ownerId, source: "PDF", file }) });
    }
    const bytes = await boundedBody(req, 16_384, "La solicitud de importación es demasiado larga.");
    const input = await new Response(bytes).json().catch(() => null);
    if (!input || !["search", "inspect", "prepare"].includes(input.action)) {
      throw new IntakeError("Selecciona un mensaje de Outlook o un comprobante PDF.", 400);
    }
    const { data: connection, error } = await admin.from("user_email_connections")
      .select("id,ms_account_email,access_token_cipher,access_token_nonce,refresh_token_cipher,refresh_token_nonce,token_expires_at,scopes")
      .eq("user_id", ownerId).eq("provider", "outlook").eq("status", "CONNECTED").maybeSingle();
    if (error) throw new IntakeError("No se pudo comprobar tu conexión con Outlook.", 503);
    if (!connection) throw new IntakeError("Conecta tu cuenta de Outlook para elegir un correo.", 409);
    const token = await ensureAccessToken(admin, connection);

    if (input.action === "search") {
      const query = typeof input.query === "string" ? input.query.replace(/["\\]/g, " ").trim() : "";
      if (query.length < 2 || query.length > 120) throw new IntakeError("Escribe entre 2 y 120 caracteres para buscar.", 400);
      const path = "/me/mailFolders/inbox/messages?$search=" + encodeURIComponent('"' + query + '"') + "&$top=20&$select=" + MAIL_FIELDS;
      const result = await (await readGraph(path, token)).json();
      return json({ emails: ((result.value ?? []) as GraphMail[]).map(mailMetadata) });
    }

    let detectionId: string | undefined;
    let messageId = typeof input.message_id === "string" ? input.message_id : "";
    if (typeof input.detection_id === "string" && UUID.test(input.detection_id)) {
      const { data: found, error: detectionError } = await admin.from("detected_processes").select("id,message_id")
        .eq("user_id", ownerId).eq("id", input.detection_id).maybeSingle();
      if (detectionError) throw new IntakeError("No se pudo leer la detección.", 503);
      if (!found?.message_id) throw new IntakeError("Busca el correo en Outlook o carga el PDF original.", 404);
      detectionId = found.id;
      messageId = found.message_id;
    }
    if (!GRAPH_ID.test(messageId)) throw new IntakeError("Selecciona un mensaje válido en tu buzón.", 400);
    const path = "/me/messages/" + encodeURIComponent(messageId);
    const select = MAIL_FIELDS + (input.action === "prepare" ? ",body" : "");
    const mail: GraphMail = await (await readGraph(path + "?$select=" + select, token)).json();
    if (!GRAPH_ID.test(mail.id ?? "")) throw new IntakeError("No se pudo identificar el mensaje de Outlook.", 502);
    if (input.action === "inspect") {
      return json({ mail: mailMetadata(mail), pdfs: mail.hasAttachments ? await listPdfs(path, token) : [] });
    }

    let file: IntakeFile | undefined;
    if (input.attachment_id != null) {
      const selectedId = typeof input.attachment_id === "string" ? input.attachment_id : "";
      if (!GRAPH_ID.test(selectedId)) throw new IntakeError("Selecciona un PDF válido del mensaje.", 400);
      const attachment = (await listPdfs(path, token)).find(({ id }) => id === selectedId);
      if (!attachment) throw new IntakeError("Ese PDF no aparece entre los adjuntos del mensaje.", 404);
      if (attachment.size > PDF_LIMIT) throw new IntakeError("El PDF debe pesar hasta 10 MB.", 413);
      const response = await readGraph(path + "/attachments/" + encodeURIComponent(selectedId) + "/$value", token);
      file = { name: attachment.name, bytes: await boundedBody(response, PDF_LIMIT, "El PDF debe pesar hasta 10 MB.") };
    }
    return json({ draft: await prepareImport(admin, {
      ownerId, source: "OUTLOOK", mail, mailboxId: connection.ms_account_email?.trim().toLowerCase() || connection.id,
      detectedId: detectionId, file,
    }) });
  } catch (err) {
    if (err instanceof IntakeError) return json({ error: err.message }, err.status);
    // Graph exceptions and token refresh failures can contain mailbox or session data.
    return json({ error: "No se pudo preparar el comprobante. Puedes volver a intentarlo o elegir otro archivo." }, 502);
  }
});
