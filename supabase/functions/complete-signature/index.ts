/**
 * complete-signature — Finalizes the digital signature process.
 * Public endpoint. Captures DRAWN signature only (typed rejected).
 * Stores signature PNG + raw stroke data for forensic evidence.
 *
 * Phase 5 (Execution ≠ Artifact):
 *   - This function handles EXECUTION: validating invariants and marking
 *     the document as executed (signed_finalized).
 *   - It does NOT generate the final PDF or audit certificate.
 *   - It enqueues a PDF job; process-pdf-job handles artifact generation
 *     and email distribution.
 *   - final_pdf_sha256 is set ONLY by process-pdf-job from actual PDF bytes.
 *
 * Hash-chained audit events, consumed_at token marking,
 * device fingerprint, identity verification.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function formatCOT(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric" })
      + " " + d.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      + " COT";
  } catch { return dateStr; }
}

function getSignerIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) { const first = xff.split(",")[0].trim(); if (first) return first; }
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown";
}

function computeDeviceFingerprint(ip: string, ua: string): string {
  const raw = `${ip}|${ua}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); hash = ((hash << 5) - hash) + c; hash = hash & hash; }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function resolveBranding(supabaseUrl: string, org: any | null, profile: any | null): { logo_url: string | null; firm_name: string } {
  if (org?.custom_branding_enabled && org?.custom_logo_path) {
    return { logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${org.custom_logo_path}`, firm_name: org.custom_firm_name || org.name || "Andromeda Legal" };
  }
  if (profile?.custom_branding_enabled && profile?.custom_logo_path) {
    return { logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${profile.custom_logo_path}`, firm_name: profile.custom_firm_name || profile.full_name || "Andromeda Legal" };
  }
  return { logo_url: null, firm_name: "Andromeda Legal" };
}

function buildEmailHeader(branding: { logo_url: string | null; firm_name: string }): string {
  if (branding.logo_url) {
    return `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
      <img src="${branding.logo_url}" alt="${branding.firm_name}" style="max-height:50px;max-width:200px;" />
      <p style="color:#666;margin:8px 0 0;font-size:13px;">${branding.firm_name}</p>
    </div>`;
  }
  return `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
    <h1 style="color:#1a1a2e;font-size:24px;margin:0;">${branding.firm_name.toUpperCase()}</h1>
    <p style="color:#666;margin:4px 0 0;">Plataforma de Gestión Legal</p>
  </div>`;
}

/** Hash chaining helpers */
async function getLastEventHash(adminClient: any, documentId: string): Promise<string | null> {
  const { data } = await adminClient
    .from("document_signature_events").select("event_hash")
    .eq("document_id", documentId).not("event_hash", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.event_hash || null;
}

function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalStringify).join(",") + "]";
  if (typeof obj === "object") {
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    return "{" + sorted.map(k => JSON.stringify(k) + ":" + canonicalStringify((obj as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

async function computeEventHash(previousHash: string | null, eventData: Record<string, unknown>): Promise<string> {
  const canonical = canonicalStringify(eventData);
  return sha256Hex((previousHash || "GENESIS") + canonical);
}

async function insertChainedEvent(adminClient: any, event: Record<string, unknown>, documentId: string): Promise<void> {
  const previousHash = await getLastEventHash(adminClient, documentId);
  const eventHash = await computeEventHash(previousHash, {
    event_type: event.event_type, event_data: event.event_data,
    actor_type: event.actor_type, actor_id: event.actor_id,
    timestamp: new Date().toISOString(),
  });
  await adminClient.from("document_signature_events").insert({
    ...event, previous_event_hash: previousHash, event_hash: eventHash,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { signing_token, signature_method, signature_data, signature_stroke_data, consent_given, geolocation } = body;

    if (!signing_token || !signature_method || !signature_data || !consent_given) {
      return json({ error: "Datos incompletos. Se requiere firma y consentimiento." }, 400);
    }
    if (signature_method !== "drawn") {
      return json({ error: "Solo se acepta firma manuscrita digital (drawn). La firma tipográfica no está permitida." }, 400);
    }
    if (!signature_data.startsWith("data:image/png;base64,")) {
      return json({ error: "Formato de firma inválido. Se requiere imagen PNG." }, 400);
    }
    const base64Part = signature_data.split(",")[1] || "";
    if (base64Part.length > 700000) {
      return json({ error: "La imagen de la firma es demasiado grande." }, 400);
    }
    if (!signature_stroke_data || !Array.isArray(signature_stroke_data) || signature_stroke_data.length === 0) {
      return json({ error: "Se requieren datos de trazos de la firma manuscrita." }, 400);
    }
    let payloadTotalPoints = 0;
    for (const stroke of signature_stroke_data) {
      if (!stroke.points || !Array.isArray(stroke.points)) return json({ error: "Estructura de datos de trazos inválida." }, 400);
      payloadTotalPoints += stroke.points.length;
    }
    if (payloadTotalPoints < 15) {
      return json({ error: "La firma debe ser más elaborada (mínimo 15 puntos). Por favor dibújela nuevamente." }, 422);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    const signerIp = getSignerIp(req);
    const signerUA = req.headers.get("user-agent") || "unknown";
    const deviceFingerprintHash = computeDeviceFingerprint(signerIp, signerUA);

    // Rate limiting
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await adminClient
      .from("rate_limits").select("*", { count: "exact", head: true })
      .eq("key", signing_token).eq("endpoint", "complete-signature").gte("window_start", oneHourAgo);
    if ((count || 0) >= 3) return json({ error: "Demasiadas solicitudes. Intente nuevamente en unos minutos." }, 429);
    await adminClient.from("rate_limits").insert({ key: signing_token, endpoint: "complete-signature", window_start: new Date().toISOString() });

    // Fetch signature
    const { data: sig, error: sigErr } = await adminClient
      .from("document_signatures").select("*").eq("signing_token", signing_token).single();
    if (sigErr || !sig) return json({ error: "Solicitud de firma no encontrada." }, 404);
    if (sig.status === "signed") return json({ error: "Este documento ya fue firmado." }, 409);
    if (sig.consumed_at) return json({ error: "Este enlace ya fue utilizado." }, 409);
    if (sig.status === "revoked") return json({ error: "Esta solicitud fue cancelada. Comuníquese con su abogado." }, 403);
    if (sig.status !== "otp_verified") return json({ error: "Debe verificar su identidad antes de firmar." }, 403);
    if (new Date(sig.expires_at) < new Date()) {
      await adminClient.from("document_signatures").update({ status: "expired" }).eq("id", sig.id);
      return json({ error: "El enlace de firma ha expirado. Solicite uno nuevo a su abogado." }, 410);
    }

    const signedAt = new Date().toISOString();
    let strokeCount = 0, totalPoints = 0;
    if (signature_stroke_data && Array.isArray(signature_stroke_data)) {
      strokeCount = signature_stroke_data.length;
      totalPoints = signature_stroke_data.reduce((sum: number, stroke: any) => sum + (stroke.points?.length || 0), 0);
    }

    // Log consent event with hash chaining
    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
      event_type: "signature.consent_given",
      event_data: { consent_text: "Acepto firmar electrónicamente conforme a Ley 527/1999", timestamp: signedAt, device_fingerprint_hash: deviceFingerprintHash },
      actor_type: "signer", actor_id: sig.signer_email, actor_ip: signerIp, actor_user_agent: signerUA,
      device_fingerprint_hash: deviceFingerprintHash,
    }, sig.document_id);

    // Fetch document
    const { data: doc } = await adminClient
      .from("generated_documents")
      .select("id, title, content_html, organization_id, document_type, work_item_id, created_by, created_at, poderdante_type, entity_data")
      .eq("id", sig.document_id).single();
    if (!doc) return json({ error: "Documento no encontrado." }, 404);

    // Fetch lawyer info + branding (for next-signer email)
    let lawyerProfile: any = null;
    if (doc.created_by) {
      const { data: prof } = await adminClient.from("profiles").select("full_name, email, litigation_email, custom_branding_enabled, custom_logo_path, custom_firm_name").eq("id", doc.created_by).single();
      lawyerProfile = prof;
    }
    let orgData: any = null;
    if (sig.organization_id) {
      const { data: org } = await adminClient.from("organizations").select("name, custom_branding_enabled, custom_logo_path, custom_firm_name").eq("id", sig.organization_id).single();
      orgData = org;
    }
    const branding = resolveBranding(supabaseUrl, orgData, lawyerProfile);

    // Store drawn signature image
    let signatureImagePath: string | null = null;
    try {
      const binaryStr = atob(base64Part);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      signatureImagePath = `${sig.organization_id}/${sig.document_id}/signature-${sig.id}.png`;
      await adminClient.storage.from("signed-documents").upload(signatureImagePath, bytes, { contentType: "image/png", upsert: true });
    } catch (uploadErr) { console.error("Signature image upload error:", uploadErr); }

    // Log signed event with hash chaining
    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
      event_type: "signature.signed",
      event_data: {
        signature_method: "drawn", timestamp: signedAt, geolocation: geolocation || null,
        stroke_count: strokeCount, total_points: totalPoints, biometric_data_captured: true,
        device_fingerprint_hash: deviceFingerprintHash,
      },
      actor_type: "signer", actor_id: sig.signer_email, actor_ip: signerIp, actor_user_agent: signerUA,
      device_fingerprint_hash: deviceFingerprintHash,
    }, sig.document_id);

    // Update this signature record — mark as signed AND consumed
    await adminClient.from("document_signatures").update({
      status: "signed", signature_method: "drawn", signature_data: null,
      signature_image_path: signatureImagePath, signature_stroke_data: signature_stroke_data || null,
      signed_at: signedAt, signer_ip: signerIp, signer_user_agent: signerUA,
      signer_geolocation: geolocation || null,
      consumed_at: signedAt,
      device_fingerprint_hash: deviceFingerprintHash,
    }).eq("id", sig.id);

    // ─── Check for dependent signers (multi-signer sequential flow) ───
    const { data: waitingSigners } = await adminClient
      .from("document_signatures").select("*")
      .eq("document_id", sig.document_id).eq("depends_on", sig.id).eq("status", "waiting");

    if (waitingSigners && waitingSigners.length > 0) {
      // NOT all signers done — set partially_signed, activate next signers
      await adminClient.from("generated_documents").update({ status: "partially_signed" }).eq("id", sig.document_id);
      for (const nextSig of waitingSigners) {
        await adminClient.from("document_signatures").update({ status: "pending" }).eq("id", nextSig.id);
        await insertChainedEvent(adminClient, {
          organization_id: sig.organization_id, document_id: sig.document_id, signature_id: nextSig.id,
          event_type: "signature.requested",
          event_data: { signer_email: nextSig.signer_email, signer_name: nextSig.signer_name, triggered_by: sig.id },
          actor_type: "system", actor_id: "system",
        }, sig.document_id);

        // Send "your turn to sign" email to next signer
        const resendKeyNotify = Deno.env.get("RESEND_API_KEY");
        if (resendKeyNotify && nextSig.signer_email) {
          const expiresTs = Math.floor(new Date(nextSig.expires_at).getTime() / 1000);
          const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://andromeda.legal";
          const nextSigningUrl = `${appBaseUrl}/sign/${nextSig.signing_token}?expires=${expiresTs}&signature=${nextSig.hmac_signature}`;
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendKeyNotify}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: `${branding.firm_name} <info@andromeda.legal>`, to: [nextSig.signer_email],
                subject: `Su turno de firmar — ${doc.title}`,
                html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                  ${buildEmailHeader(branding)}
                  <div style="padding:24px 0;">
                    <h2 style="color:#1a1a2e;">Su turno de firmar</h2>
                    <p>${sig.signer_name} ha firmado el documento <strong>${doc.title}</strong>. Ahora es su turno.</p>
                    <div style="text-align:center;margin:24px 0;">
                      <a href="${nextSigningUrl}" style="background:#1a1a2e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Firmar Documento</a>
                    </div>
                  </div>
                  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
                  <p style="color:#999;font-size:12px;text-align:center;">${branding.firm_name}</p>
                </div>`,
              }),
            });
          } catch (emailErr) { console.error("Next signer notification error:", emailErr); }
        }
      }
      return json({
        ok: true, signature_id: sig.id, document_hash: null, signed_at: signedAt,
        download_url: null, is_partial: true, pdf_pending: false,
        message: "Su firma ha sido registrada. El documento requiere firmas adicionales.",
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // ALL SIGNERS COMPLETE — EXECUTION MOMENT
    // ═══════════════════════════════════════════════════════════════

    // ── Fetch all signatures for invariant validation ──
    const { data: allSignatures } = await adminClient
      .from("document_signatures").select("*").eq("document_id", sig.document_id)
      .order("signing_order", { ascending: true });
    const signedSigs = allSignatures?.filter(s => s.status === "signed") || [];
    const totalExpectedSigners = allSignatures?.length || 0;

    // ── EXECUTION INVARIANTS ──
    // 1. All required signers must have signed
    const isBilateral = doc.document_type === "contrato_servicios" || doc.document_type === "generic_pdf_signing";
    if (signedSigs.length < totalExpectedSigners) {
      console.error(`[complete-signature] Execution invariant violation: ${signedSigs.length}/${totalExpectedSigners} signed for doc ${sig.document_id}`);
      return json({ error: "No se puede finalizar: faltan firmas de una o más partes.", error_code: "EXECUTION_INCOMPLETE" }, 409);
    }

    // 2. Each signer must have non-empty signature payload
    for (const s of signedSigs) {
      const hasStrokes = s.signature_stroke_data && Array.isArray(s.signature_stroke_data) && s.signature_stroke_data.length > 0;
      const hasImage = !!s.signature_image_path;
      if (!hasStrokes && !hasImage) {
        console.error(`[complete-signature] Empty signature for signer ${s.id} (${s.signer_email})`);
        return json({
          error: `La firma de ${s.signer_name} está vacía. No se puede ejecutar el documento.`,
          error_code: "EMPTY_SIGNATURE",
        }, 422);
      }
    }

    // 3. Each signer must have OTP verified (check audit events)
    for (const s of signedSigs) {
      if (!s.otp_verified_at) {
        console.error(`[complete-signature] OTP not verified for signer ${s.id} (${s.signer_email})`);
        return json({
          error: `El firmante ${s.signer_name} no completó la verificación OTP.`,
          error_code: "OTP_NOT_VERIFIED",
        }, 422);
      }
    }

    console.log(`[complete-signature] Execution invariants passed: ${signedSigs.length}/${totalExpectedSigners} signers, doc ${sig.document_id}`);

    // ── Mark document as executed ──
    // IMPORTANT: final_pdf_sha256 is NOT set here. It is set ONLY by process-pdf-job
    // after the actual PDF bytes are generated. This prevents hash mismatches.
    const finalStatus = isBilateral ? "signed_finalized" : "signed";
    
    // Handle status transitions through allowed paths (the DB trigger enforces valid transitions)
    // ready_for_signature cannot go directly to signed_finalized; must go through partially_signed first
    const currentStatus = doc.status;
    if (finalStatus === "signed_finalized" && currentStatus === "ready_for_signature") {
      await adminClient.from("generated_documents").update({ status: "partially_signed" }).eq("id", sig.document_id);
    } else if (finalStatus === "signed" && currentStatus === "ready_for_signature") {
      // For unilateral: ready_for_signature → sent_for_signature → signed
      await adminClient.from("generated_documents").update({ status: "sent_for_signature" }).eq("id", sig.document_id);
    } else if (finalStatus === "signed" && currentStatus === "finalized") {
      // For unilateral via finalized: finalized → sent_for_signature → signed
      await adminClient.from("generated_documents").update({ status: "sent_for_signature" }).eq("id", sig.document_id);
    }
    
    await adminClient.from("generated_documents").update({
      status: finalStatus,
      finalized_at: new Date().toISOString(),
      finalized_by: sig.signer_name,
    }).eq("id", sig.document_id);

    // Log execution event
    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
      event_type: "document.executed",
      event_data: {
        total_signers: signedSigs.length,
        signer_model: isBilateral ? "BILATERAL" : "UNILATERAL",
        all_otp_verified: true,
        all_signatures_non_empty: true,
        execution_timestamp: new Date().toISOString(),
      },
      actor_type: "system", actor_id: "system",
    }, sig.document_id);

    // ── Enqueue async PDF generation job ──
    // CRITICAL: Notification emails are deferred to process-pdf-job.
    // Emails are ONLY sent after signed.pdf exists and final_pdf_sha256 is set.
    const { error: jobErr } = await adminClient.from("document_pdf_jobs").insert({
      document_id: sig.document_id,
      organization_id: sig.organization_id,
      status: "queued",
    });
    if (jobErr) {
      console.error("[complete-signature] PDF job enqueue error:", jobErr);
    } else {
      // Fire-and-forget: invoke process-pdf-job asynchronously
      fetch(`${supabaseUrl}/functions/v1/process-pdf-job`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: sig.document_id }),
      }).catch((e: unknown) => console.warn("[complete-signature] Async PDF job trigger warning:", e));
    }

    return json({
      ok: true, signature_id: sig.id,
      signed_at: signedAt, download_url: null,
      pdf_pending: true,
      message: "Documento firmado exitosamente. El PDF se está generando y recibirá una notificación por correo electrónico cuando esté listo.",
    });
  } catch (err) {
    console.error("complete-signature error:", err);
    return json({ error: "Hubo un error al procesar la firma. Por favor intente nuevamente." }, 500);
  }
});
