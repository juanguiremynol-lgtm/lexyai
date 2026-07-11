/**
 * get-estado-attachment-url — Returns a short-lived signed URL for a
 * publicacion's downloaded PDF in the private `estado-attachments` bucket.
 *
 * The bucket has no RLS SELECT policy for `authenticated`, so client-side
 * `createSignedUrl` returns "Object not found" (Supabase masks RLS denials).
 * This function bypasses that by using the service role AFTER validating the
 * caller belongs to the organization that owns the publicacion.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "estado-attachments";

/**
 * Return the X-API-Key to send for a given absolute URL when the host
 * matches one of our own Cloud Run PDF proxies. Kept in sync with
 * process-estado-attachments-queue/resolveGcpAuth.
 */
function resolveGcpAuth(
  rawUrl: string,
): { apiKey: string; source: "publicaciones" | "samai_estados" } | null {
  let host = "";
  try { host = new URL(rawUrl).host.toLowerCase(); } catch { return null; }
  if (/^publicaciones-procesales-api-[a-z0-9.-]+\.run\.app$/i.test(host)) {
    const key = Deno.env.get("PUBLICACIONES_X_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY");
    return key ? { apiKey: key, source: "publicaciones" } : null;
  }
  if (/^samai-estados-api-[a-z0-9.-]+\.run\.app$/i.test(host)) {
    const key = Deno.env.get("SAMAI_ESTADOS_API_KEY");
    return key ? { apiKey: key, source: "samai_estados" } : null;
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const publicacionId = typeof body?.publicacion_id === "string" ? body.publicacion_id : null;
    const storagePathOverride = typeof body?.storage_path === "string" ? body.storage_path : null;
    if (!publicacionId) return json({ error: "publicacion_id required" }, 400);

    const admin = createClient(url, service);

    // Load publicacion + its work_item.organization_id in one hop.
    const { data: pub, error: pubErr } = await admin
      .from("work_item_publicaciones")
      .select("id, organization_id, pdf_url, raw_data")
      .eq("id", publicacionId)
      .single();
    if (pubErr || !pub) return json({ error: "publicacion_not_found" }, 404);

    // Membership check: user must belong to the pub's organization.
    const { data: membership } = await admin
      .from("organization_memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("organization_id", pub.organization_id)
      .maybeSingle();
    if (!membership) return json({ error: "forbidden" }, 403);

    // Locate the storage path. Prefer the queue row (source of truth for
    // downloaded attachments), fall back to pdf_url on the publicacion when
    // it points to a bucket path (some legacy rows store it there).
    let storagePath: string | null = storagePathOverride;
    if (!storagePath) {
      const { data: queueRow } = await admin
        .from("estado_attachment_queue")
        .select("storage_path")
        .eq("publicacion_id", publicacionId)
        .eq("status", "downloaded")
        .not("storage_path", "is", null)
        .order("downloaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      storagePath = queueRow?.storage_path ?? null;
    }
    if (!storagePath && pub.pdf_url && !/^https?:\/\//i.test(pub.pdf_url)) {
      storagePath = pub.pdf_url;
    }

    if (storagePath) {
      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 60 * 10);
      if (!signErr && signed?.signedUrl) {
        return json({ ok: true, url: signed.signedUrl, source: "storage" });
      }
      console.warn("[get-estado-attachment-url] sign failed", signErr?.message, storagePath);
    }

    // Fallback: fetch upstream ourselves. The queue row's remote_url is the
    // source of truth (already carries the base64 asset_id the GCP proxy
    // expects); pub.raw_data / pub.pdf_url are back-ups.
    const raw = (pub.raw_data ?? {}) as Record<string, unknown>;
    let proxyUrl: string | null = null;
    const { data: anyQueue } = await admin
      .from("estado_attachment_queue")
      .select("remote_url, storage_path, status, last_error")
      .eq("publicacion_id", publicacionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anyQueue?.remote_url && /^https?:\/\//i.test(anyQueue.remote_url)) {
      proxyUrl = anyQueue.remote_url;
    }
    proxyUrl = proxyUrl
      || (typeof raw.pdf_url === "string" && /^https?:\/\//i.test(raw.pdf_url) ? raw.pdf_url : null)
      || (typeof raw.pdf_individual_url === "string" ? raw.pdf_individual_url : null)
      || (pub.pdf_url && /^https?:\/\//i.test(pub.pdf_url) ? pub.pdf_url : null);

    if (!proxyUrl) return json({ error: "no_pdf_available" }, 404);

    const auth = resolveGcpAuth(proxyUrl);
    if (!auth) {
      // External (ramajudicial.gov.co, etc.) — safe to open directly.
      return json({ ok: true, url: proxyUrl, source: "external" });
    }

    // Authenticated server-side proxy: fetch bytes with X-API-Key, upload to
    // our private bucket, sign and return. Also back-fills storage so the
    // next open hits the fast path.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25_000);
    let bytes: ArrayBuffer;
    try {
      const upstream = await fetch(proxyUrl, {
        signal: ctl.signal,
        headers: { "Accept": "application/pdf, */*", "X-API-Key": auth.apiKey },
      });
      if (!upstream.ok) {
        const body = await upstream.text().catch(() => "");
        console.warn("[get-estado-attachment-url] upstream", upstream.status, body.slice(0, 200));
        return json({
          error: "upstream_failed",
          status: upstream.status,
          detail: body.slice(0, 200),
        }, 502);
      }
      bytes = await upstream.arrayBuffer();
    } finally {
      clearTimeout(t);
    }
    if (!bytes || bytes.byteLength === 0) return json({ error: "upstream_empty" }, 502);

    const path = anyQueue?.storage_path && typeof anyQueue.storage_path === "string"
      ? anyQueue.storage_path
      : `${publicacionId}/proxy_${Date.now()}.pdf`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.warn("[get-estado-attachment-url] upload failed", upErr.message);
      // Still return the bytes as a data URL fallback would be too large; bail.
      return json({ error: "upload_failed", detail: upErr.message }, 500);
    }
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
    if (signed?.signedUrl) {
      return json({ ok: true, url: signed.signedUrl, source: "proxied_and_stored" });
    }
    return json({ error: "sign_failed" }, 500);

  } catch (err) {
    console.error("[get-estado-attachment-url] fatal", err);
    return json({ error: err instanceof Error ? err.message : "internal_error" }, 500);
  }
});
