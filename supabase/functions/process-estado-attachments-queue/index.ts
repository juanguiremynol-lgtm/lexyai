/** Durable, bounded recovery of separately associated estado documents. */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.89.0";
import { recoverEstadoAttachment, type EstadoQueueRow } from "../_shared/estadoAttachmentRecovery.ts";
import { readEstadoPdf } from "../_shared/estadoPdfReading.ts";
import { isCronCaller } from "../_shared/cronAuth.ts";
import { estadoDocumentAccess, downloadEstadoDocument } from "../_shared/estadoDocumentAccess.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const TIME_BUDGET_MS = 45_000;
const BUCKET_NAME = "estado-attachments";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const internalBearer = !!serviceKey && req.headers.get("Authorization") === `Bearer ${serviceKey}`;
  if (!isCronCaller(req) && !internalBearer) return json({ error: 'unauthorized' }, 401);
  let workItemIds: string[] | null;
  try {
    const body = await req.text();
    workItemIds = parseEstadoWorkItemScope(body ? JSON.parse(body) : {});
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid_request' }, 400);
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const start = Date.now();
  let success = 0, failed = 0;
  try {
    // PDF parsing consumes the hosted Edge CPU budget. Process one document
    // per invocation; the scheduler supplies a bounded batch of invocations.
    // Claims retain their attempt/association guards across separate requests.
    while (success + failed < 1 && Date.now() - start < TIME_BUDGET_MS) {
      const { data, error } = workItemIds
        ? await supabase.rpc("claim_estado_attachment_downloads_scoped", { p_limit: 1, p_work_item_ids: workItemIds })
        : await supabase.rpc("claim_estado_attachment_downloads", { p_limit: 1 });
      if (error) throw new Error(`claim_failed:${error.message}`);
      const row = data?.[0] as EstadoQueueRow | undefined;
      if (!row) break;
      const result = await processOne(supabase, row);
      if (result.success) success++; else failed++;
    }
    return json({ ok: true, processed: success + failed, success, failed, work_item_ids: workItemIds });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error), success, failed }, 500);
  }
});

/** An explicit but invalid scope must never become a global queue run. The
 * ordinary cron omits this field; a controlled run names one or two matters. */
export function parseEstadoWorkItemScope(body: unknown): string[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_request');
  if (!Object.prototype.hasOwnProperty.call(body, 'work_item_ids')) return null;
  const ids = (body as Record<string, unknown>).work_item_ids;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2 || ids.some((id) => typeof id !== 'string' || !uuid.test(id))) {
    throw new Error('work_item_ids_must_contain_one_or_two_uuids');
  }
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

async function processOne(supabase: SupabaseClient<any>, row: EstadoQueueRow) {
  const bucket = supabase.storage.from(BUCKET_NAME);
  let primaryChange: { available: boolean; path: string | null } | null = null;
  let primaryInvalidated = false;
  return recoverEstadoAttachment(row, {
    publication: async () => {
      const { data, error } = await supabase.from("work_item_publicaciones").select("pdf_url,raw_data,source,source_radicado").eq("id", row.publicacion_id).single();
      if (error || !data) throw new Error(`publication_read_failed:${error?.message || 'missing'}`);
      return data;
    },
    readStored: async (path) => {
      const { data, error } = await bucket.download(path);
      if (error) {
        const status = Number((error as any).statusCode ?? (error as any).status);
        if (status === 404) return null;
        throw new Error(`stored_read_failed_${status || 'unknown'}:${error.message}`);
      }
      if (!data) throw new Error('stored_read_empty_response');
      return new Uint8Array(await data.arrayBuffer());
    },
    fetchOrigin: downloadPdf,
    inspect: readEstadoPdf,
    upload: async (path, bytes) => {
      const { error } = await bucket.upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (error) throw new Error(`upload_failed:${error.message}`);
    },
    saveQueue: async (patch) => {
      // An expired worker may not finish a newer worker's attempt.
      const safePrimary = patch.status === 'downloaded' ? primaryChange : (primaryInvalidated ? { available: false, path: null } : null);
      const { data, error } = await supabase.rpc('finish_estado_attachment_download', { p_id: row.id, p_attempt: row.attempt_count, p_patch: patch, p_primary: safePrimary });
      if (error || !data) throw new Error(`queue_write_unconfirmed:${error?.message || 'lease_changed'}`);
    },
    setPrimaryAvailability: async (available, path) => {
      // An annex completing later must not replace the primary document.
      primaryChange = { available, path };
      if (!available) primaryInvalidated = true;
    },
  });
}

async function downloadPdf(url: string): Promise<Uint8Array> {
  return downloadEstadoDocument(url, (key) => Deno.env.get(key));
}

export function resolveGcpAuth(rawUrl: string): { apiKey: string; source: "publicaciones" | "samai_estados" } | null {
  return estadoDocumentAccess(rawUrl, (key) => Deno.env.get(key));
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
