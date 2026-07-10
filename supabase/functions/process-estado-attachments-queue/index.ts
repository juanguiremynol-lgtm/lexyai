/**
 * process-estado-attachments-queue — Worker for downloading judicial PDFs.
 *
 * Reads pending rows from estado_attachment_queue, downloads the PDF,
 * stores it in the private `estado-attachments` bucket, sets status='done'
 * (or 'failed' when attempts are exhausted), and writes the storage path
 * onto work_item_publicaciones.pdf_url.
 *
 * Schema-consistent columns:
 *   id, work_item_id, publicacion_id, organization_id, remote_url, filename,
 *   status (pending|done|failed), attempt_count, max_attempts, last_error,
 *   storage_path, downloaded_at, next_retry_at.
 *
 * Cadence: dedicated pg_cron every 10 minutes (asterisk-slash-10 asterisks).
 * Time budget: 45s per run, batch <= 10.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG_TAG = "[process-estado-attachments]";
const BATCH_SIZE = 10;
const DOWNLOAD_TIMEOUT_MS = 25_000;
const TIME_BUDGET_MS = 45_000;
const BUCKET_NAME = "estado-attachments";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const runId = crypto.randomUUID().slice(0, 12);
  const start = Date.now();
  console.log(`${LOG_TAG} run ${runId} start`);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const nowIso = new Date().toISOString();
    const { data: pending, error } = await supabase
      .from("estado_attachment_queue")
      .select(
        "id, publicacion_id, remote_url, filename, attempt_count, max_attempts, storage_path, last_error",
      )
      .eq("status", "pending")
      .lte("next_retry_at", nowIso)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) return json({ ok: false, error: error.message, run_id: runId }, 500);
    if (!pending?.length) return json({ ok: true, processed: 0, run_id: runId });

    let ok = 0, ko = 0;
    for (const row of pending) {
      if (Date.now() - start > TIME_BUDGET_MS) {
        console.warn(`${LOG_TAG} time budget reached, stopping`);
        break;
      }
      const res = await processOne(supabase, row as never);
      if (res.success) ok++; else ko++;
    }

    console.log(`${LOG_TAG} ${runId} done: ok=${ok} ko=${ko}`);
    return json({ ok: true, run_id: runId, processed: ok + ko, success: ok, failed: ko });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_TAG} fatal`, msg);
    return json({ ok: false, error: msg, run_id: runId }, 500);
  }
});

interface QueueRow {
  id: string;
  publicacion_id: string;
  remote_url: string;
  filename: string | null;
  attempt_count: number;
  max_attempts: number;
  storage_path: string | null;
  last_error: string | null;
}

async function processOne(
  supabase: ReturnType<typeof createClient>,
  row: QueueRow,
): Promise<{ success: boolean; error?: string }> {
  const nextAttempt = row.attempt_count + 1;
  const filename = safeName(row.filename || `providencia_${row.id.slice(0, 8)}.pdf`);
  console.log(`${LOG_TAG} ${row.id} attempt ${nextAttempt}/${row.max_attempts}`);

  // Idempotent close-out: if a prior run (or the publicaciones mapper) already
  // wrote storage_path with no error, the file is in the bucket — just flip
  // the status to 'downloaded' instead of re-downloading. Prevents the
  // "pending forever with storage_path populated" bookkeeping bug.
  if (row.storage_path && !row.last_error) {
    console.log(`${LOG_TAG} ${row.id} already has storage_path, closing as downloaded`);
    await supabase
      .from("estado_attachment_queue")
      .update({
        status: "downloaded",
        downloaded_at: new Date().toISOString(),
        last_error: null,
      } as never)
      .eq("id", row.id);
    if (row.publicacion_id) {
      await supabase
        .from("work_item_publicaciones")
        .update({ pdf_url: row.storage_path } as never)
        .eq("id", row.publicacion_id);
    }
    return { success: true };
  }

  try {
    const bytes = await downloadPdf(row.remote_url);
    if (!bytes || bytes.byteLength === 0) throw new Error("empty_body");

    const path = `${row.publicacion_id}/${filename}`;
    const { error: upErr } = await (supabase.storage
      .from(BUCKET_NAME) as unknown as {
        upload: (
          p: string,
          d: ArrayBuffer,
          o: { contentType: string; upsert: boolean },
        ) => Promise<{ error: { message: string } | null }>;
      })
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`upload_failed:${upErr.message}`);

    await supabase
      .from("estado_attachment_queue")
      .update({
        // Table check constraint enforces status IN ('pending','downloading',
        // 'downloaded','failed','skipped'). 'done' is silently rejected and
        // left the queue in a pending loop while the worker kept succeeding.
        status: "downloaded",
        storage_path: path,
        attempt_count: nextAttempt,
        downloaded_at: new Date().toISOString(),
        last_error: null,
      } as never)
      .eq("id", row.id);

    if (row.publicacion_id) {
      await supabase
        .from("work_item_publicaciones")
        .update({ pdf_url: path } as never)
        .eq("id", row.publicacion_id);
    }
    return { success: true };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const exhausted = nextAttempt >= row.max_attempts;
    const backoffMin = Math.min(240, Math.pow(2, nextAttempt) * 5);
    await supabase
      .from("estado_attachment_queue")
      .update({
        status: exhausted ? "failed" : "pending",
        attempt_count: nextAttempt,
        last_error: msg,
        next_retry_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
      } as never)
      .eq("id", row.id);
    return { success: false, error: msg };
  }
}

async function downloadPdf(url: string): Promise<ArrayBuffer> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    // Route selection based on host:
    //   - Our Cloud Run PDF proxies (publicaciones-procesales-api-*.run.app,
    //     samai-estados-api-*.run.app) require X-API-Key. Browser-spoofing
    //     headers are NOT sent — those endpoints authenticate on API key only.
    //   - Any other host uses the legacy browser-shaped headers.
    const auth = resolveGcpAuth(url);
    const headers: Record<string, string> = auth
      ? {
          "Accept": "application/pdf, */*",
          "X-API-Key": auth.apiKey,
        }
      : {
          "Accept": "application/pdf, */*",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Andromeda-AttachmentWorker",
          "Referer": "https://samaicore.consejodeestado.gov.co/",
          "Origin": "https://samaicore.consejodeestado.gov.co",
        };
    if (auth) {
      console.log(`${LOG_TAG} using ${auth.source} X-API-Key for ${new URL(url).host}`);
    }
    const resp = await fetch(url, { signal: ctl.signal, headers });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`http_${resp.status}:${body.slice(0, 200)}`);
    }
    return await resp.arrayBuffer();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Return the X-API-Key to send for a given absolute URL when the host
 * matches one of our own Cloud Run PDF proxies. Returns null for any other
 * host so the caller falls back to browser-shaped headers.
 *
 * Uses the same secret names as the sync-* edge functions:
 *   - publicaciones-procesales-api-*.run.app → PUBLICACIONES_X_API_KEY || EXTERNAL_X_API_KEY
 *   - samai-estados-api-*.run.app            → SAMAI_ESTADOS_API_KEY
 */
export function resolveGcpAuth(
  rawUrl: string,
): { apiKey: string; source: "publicaciones" | "samai_estados" } | null {
  let host = "";
  try { host = new URL(rawUrl).host.toLowerCase(); } catch { return null; }

  // Cloud Run hostnames include the region segment, e.g.
  //   publicaciones-procesales-api-11974381924.us-central1.run.app
  // The regex must allow the interior `.us-central1.` (or any region),
  // not just alphanumerics/dashes, otherwise resolveGcpAuth falls through
  // and the worker sends no X-API-Key → 401 API key inválida.
  if (/^publicaciones-procesales-api-[a-z0-9.-]+\.run\.app$/i.test(host)) {
    const key = Deno.env.get("PUBLICACIONES_X_API_KEY")
      || Deno.env.get("EXTERNAL_X_API_KEY");
    return key ? { apiKey: key, source: "publicaciones" } : null;
  }
  if (/^samai-estados-api-[a-z0-9.-]+\.run\.app$/i.test(host)) {
    const key = Deno.env.get("SAMAI_ESTADOS_API_KEY");
    return key ? { apiKey: key, source: "samai_estados" } : null;
  }
  return null;
}

function safeName(name: string): string {
  const trimmed = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
