/**
 * digest-document — token-gated download link carried by the daily digest.
 *
 * HH3(b) — mechanism, expiry, authentication:
 *   • The email carries `?t=<48 hex chars>` (192 bits of entropy). The token is
 *     minted per document, per recipient, and stored in `digest_document_tokens`
 *     with an explicit expiry (30 days). Nothing about the document is in the URL.
 *   • The recipient does NOT need to be signed in — a mail client cannot carry a
 *     Supabase session, and a link that demands a login is a link he cannot open.
 *     The token is the credential; it is single-document scoped and revocable by
 *     deleting the row.
 *   • The signed storage URL it redirects to lives 10 minutes and is minted at
 *     click time, so the short-lived artefact never ages inside the mailbox.
 *
 * BINDING PRINCIPLE: the token is re-validated against `v_monitored_work_items`
 * on every click. If the matter was deleted, paused or archived after the mail
 * was sent, the link stops working — a deleted matter appears in nothing,
 * including in links already delivered.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "estado-attachments";

function page(title: string, message: string, status: number) {
  return new Response(
    `<!doctype html><html lang="es"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:48px;">
      <h1 style="font-size:20px;">${title}</h1><p style="color:#94a3b8;">${message}</p>
      <p style="color:#94a3b8;">Puede abrir el documento desde Andromeda: <a style="color:#38bdf8" href="https://andromeda.legal">andromeda.legal</a></p>
    </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function resolveGcpAuth(rawUrl: string): string | null {
  let host = "";
  try { host = new URL(rawUrl).host.toLowerCase(); } catch { return null; }
  if (/^publicaciones-procesales-api-[a-z0-9.-]+\.run\.app$/i.test(host)) {
    return Deno.env.get("PUBLICACIONES_X_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY") || null;
  }
  if (/^samai-estados-api-[a-z0-9.-]+\.run\.app$/i.test(host)) {
    return Deno.env.get("SAMAI_ESTADOS_API_KEY") || null;
  }
  return null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token || !/^[a-f0-9]{16,96}$/.test(token)) {
    return page("Enlace inválido", "El enlace no es válido.", 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: row } = await admin
    .from("digest_document_tokens")
    .select("id, work_item_id, kind, publicacion_id, act_id, doc_url, doc_label, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!row) return page("Enlace inválido", "Este enlace no existe o fue revocado.", 404);
  if (new Date(row.expires_at) < new Date()) {
    return page("Enlace expirado", "Este enlace de descarga expiró. El documento sigue disponible en Andromeda.", 410);
  }

  // Re-validate against the canonical monitored view on every click.
  const { data: stillMonitored } = await admin
    .from("v_monitored_work_items")
    .select("id")
    .eq("id", row.work_item_id)
    .maybeSingle();
  if (!stillMonitored) {
    return page("No disponible", "Este documento ya no está disponible.", 404);
  }

  try {
    await admin.rpc("bump_digest_token_usage", { p_token_id: row.id });
  } catch (_e) { /* usage telemetry must never block a download */ }


  // ── ACTUACIÓN documents: provider-authoritative URL captured at send time. ──
  if (row.kind === "ACTUACION") {
    if (!row.doc_url) return page("Sin documento", "Esta actuación no tiene documento adjunto.", 404);
    const apiKey = resolveGcpAuth(row.doc_url);
    if (!apiKey) return Response.redirect(row.doc_url, 302);
    const upstream = await fetch(row.doc_url, { headers: { "X-API-Key": apiKey, Accept: "application/pdf, */*" } });
    if (!upstream.ok) return page("No disponible", "El proveedor no entregó el documento en este momento.", 502);
    return new Response(await upstream.arrayBuffer(), {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/pdf",
        "Content-Disposition": `inline; filename="${(row.doc_label ?? "documento").replace(/[^\w.\-]/g, "_")}.pdf"`,
      },
    });
  }

  // ── ESTADO documents: private bucket, signed at click time (10 minutes). ──
  const { data: pub } = await admin
    .from("work_item_publicaciones")
    .select("id, pdf_url, pdf_storage_path, raw_data")
    .eq("id", row.publicacion_id!)
    .maybeSingle();
  if (!pub) return page("Sin documento", "La publicación ya no está disponible.", 404);

  let storagePath: string | null =
    typeof pub.pdf_storage_path === "string" && pub.pdf_storage_path.trim() ? pub.pdf_storage_path : null;
  if (!storagePath) {
    const { data: q } = await admin
      .from("estado_attachment_queue")
      .select("storage_path")
      .eq("publicacion_id", pub.id)
      .eq("status", "downloaded")
      .not("storage_path", "is", null)
      .order("downloaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    storagePath = q?.storage_path ?? null;
  }

  if (storagePath) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 600);
    if (signed?.signedUrl) return Response.redirect(signed.signedUrl, 302);
  }

  // Fallback: fetch through the credentialed provider proxy.
  const raw = (pub.raw_data ?? {}) as Record<string, unknown>;
  const remote = [pub.pdf_url, raw.pdf_url, raw.pdf_individual_url]
    .find((v) => typeof v === "string" && /^https?:\/\//i.test(v)) as string | undefined;
  if (!remote) return page("Sin documento adjunto", "Esta publicación no tiene documento adjunto.", 404);

  const apiKey = resolveGcpAuth(remote);
  if (!apiKey) return Response.redirect(remote, 302);
  const upstream = await fetch(remote, { headers: { "X-API-Key": apiKey, Accept: "application/pdf, */*" } });
  if (!upstream.ok) return page("No disponible", "El proveedor no entregó el documento en este momento.", 502);
  return new Response(await upstream.arrayBuffer(), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="estado.pdf"' },
  });
});
