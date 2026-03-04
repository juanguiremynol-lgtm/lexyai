/**
 * process-estado-attachments-queue — Worker for downloading judicial PDFs.
 *
 * Reads pending items from estado_attachment_queue, downloads PDFs,
 * stores them in private storage, and updates the queue record.
 *
 * Retry semantics: exponential backoff, max 5 attempts.
 * Runs on a cron schedule or can be invoked manually.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG_TAG = '[process-estado-attachments]';
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const BUCKET_NAME = 'estado-attachments';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const runId = crypto.randomUUID().slice(0, 12);
  console.log(`${LOG_TAG} Starting run ${runId}`);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Ensure bucket exists (idempotent)
    await ensureBucket(supabase);

    // Fetch pending items due for processing
    const { data: pendingItems, error: fetchErr } = await supabase
      .from('estado_attachment_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempt_count', MAX_ATTEMPTS)
      .lte('next_retry_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) {
      console.error(`${LOG_TAG} Failed to fetch queue:`, fetchErr.message);
      return jsonResponse({ ok: false, error: fetchErr.message, run_id: runId }, 500);
    }

    if (!pendingItems || pendingItems.length === 0) {
      console.log(`${LOG_TAG} No pending attachments. Done.`);
      return jsonResponse({ ok: true, processed: 0, run_id: runId });
    }

    console.log(`${LOG_TAG} Processing ${pendingItems.length} attachments`);

    let successCount = 0;
    let failCount = 0;

    for (const item of pendingItems) {
      const result = await processOneAttachment(supabase, item);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    console.log(`${LOG_TAG} Run ${runId} complete: ${successCount} success, ${failCount} failed`);

    return jsonResponse({
      ok: true,
      run_id: runId,
      processed: pendingItems.length,
      success: successCount,
      failed: failCount,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_TAG} Fatal error:`, msg);
    return jsonResponse({ ok: false, error: msg, run_id: runId }, 500);
  }
});

// ═══════════════════════════════════════════
// PROCESS SINGLE ATTACHMENT
// ═══════════════════════════════════════════

interface ProcessResult {
  success: boolean;
  error?: string;
}

async function processOneAttachment(
  supabase: ReturnType<typeof createClient>,
  item: Record<string, unknown>,
): Promise<ProcessResult> {
  const itemId = item.id as string;
  const remoteUrl = item.remote_url as string;
  const filename = item.filename as string;
  const workItemPubId = item.work_item_publicacion_id as string;
  const currentAttempt = (item.attempt_count as number) + 1;

  console.log(`${LOG_TAG} Processing ${itemId}: ${filename} (attempt ${currentAttempt})`);

  try {
    // Download the PDF
    const pdfBytes = await downloadPdf(remoteUrl);
    if (!pdfBytes || pdfBytes.byteLength === 0) {
      throw new Error('Empty PDF response');
    }

    // Store in private bucket
    const storagePath = buildStoragePath(workItemPubId, filename);
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Upload failed: ${uploadErr.message}`);
    }

    // Mark as downloaded
    const { error: updateErr } = await supabase
      .from('estado_attachment_queue')
      .update({
        status: 'downloaded',
        stored_path: storagePath,
        attempt_count: currentAttempt,
        downloaded_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', itemId);

    if (updateErr) {
      console.error(`${LOG_TAG} Queue update failed for ${itemId}:`, updateErr.message);
    }

    // Update the publicacion record with the stored path
    if (workItemPubId) {
      await supabase
        .from('work_item_publicaciones')
        .update({ pdf_url: storagePath })
        .eq('id', workItemPubId);
    }

    console.log(`${LOG_TAG} ✓ Downloaded ${filename} → ${storagePath}`);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_TAG} ✗ Failed ${itemId}: ${msg}`);

    // Update with error + schedule retry with exponential backoff
    const backoffMinutes = Math.pow(2, currentAttempt) * 5; // 10, 20, 40, 80, 160 min
    const nextRetry = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
    const newStatus = currentAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending';

    await supabase
      .from('estado_attachment_queue')
      .update({
        status: newStatus,
        attempt_count: currentAttempt,
        last_error: msg.slice(0, 500),
        next_retry_at: nextRetry,
      })
      .eq('id', itemId);

    return { success: false, error: msg };
  }
}

// ═══════════════════════════════════════════
// PDF DOWNLOAD
// ═══════════════════════════════════════════

async function downloadPdf(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/pdf, */*',
        'User-Agent': 'Andromeda-AttachmentWorker/1.0',
      },
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    return await resp.arrayBuffer();
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ═══════════════════════════════════════════
// STORAGE HELPERS
// ═══════════════════════════════════════════

function buildStoragePath(pubId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `attachments/${pubId}/${safe}`;
}

async function ensureBucket(supabase: ReturnType<typeof createClient>): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b: { name: string }) => b.name === BUCKET_NAME);
    if (!exists) {
      console.log(`${LOG_TAG} Creating bucket "${BUCKET_NAME}"`);
      await supabase.storage.createBucket(BUCKET_NAME, {
        public: false,
        fileSizeLimit: 50 * 1024 * 1024, // 50MB
      });
    }
  } catch (err: unknown) {
    // Bucket may already exist, log and continue
    console.log(`${LOG_TAG} Bucket check/create note:`, err instanceof Error ? err.message : String(err));
  }
}

// ═══════════════════════════════════════════
// RESPONSE HELPERS
// ═══════════════════════════════════════════

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
