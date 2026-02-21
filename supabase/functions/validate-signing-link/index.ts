/**
 * validate-signing-link — Validates HMAC signature and expiration of a signing URL.
 * Public endpoint (no auth). Returns document data + branding if valid.
 * Phase 4: Returns identity confirmation requirements + enforces consumed tokens.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || req.headers.get("cf-connecting-ip")
    || "unknown";
}

async function computeHMAC(secret: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function resolveBranding(
  supabaseUrl: string,
  org: { custom_branding_enabled?: boolean; custom_logo_path?: string; custom_firm_name?: string; name?: string } | null,
  profile: { custom_branding_enabled?: boolean; custom_logo_path?: string; custom_firm_name?: string; full_name?: string } | null
): { logo_url: string | null; firm_name: string; is_custom: boolean } {
  if (org?.custom_branding_enabled && org?.custom_logo_path) {
    return {
      logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${org.custom_logo_path}`,
      firm_name: org.custom_firm_name || org.name || "Andromeda Legal",
      is_custom: true,
    };
  }
  if (profile?.custom_branding_enabled && profile?.custom_logo_path) {
    return {
      logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${profile.custom_logo_path}`,
      firm_name: profile.custom_firm_name || profile.full_name || "Andromeda Legal",
      is_custom: true,
    };
  }
  return { logo_url: null, firm_name: "Andromeda Legal", is_custom: false };
}

/** Recursive canonical JSON: sorts keys at all depths, normalizes null/undefined */
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

/** Compute hash-chained event hash */
async function computeEventHash(previousHash: string | null, eventData: Record<string, unknown>): Promise<string> {
  const canonical = canonicalStringify(eventData);
  const input = (previousHash || "GENESIS") + canonical;
  return sha256Hex(input);
}

/** Get the last event hash for a document */
async function getLastEventHash(adminClient: any, documentId: string): Promise<string | null> {
  const { data } = await adminClient
    .from("document_signature_events")
    .select("event_hash")
    .eq("document_id", documentId)
    .not("event_hash", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.event_hash || null;
}

/** Insert an event with hash chaining */
async function insertChainedEvent(
  adminClient: any,
  event: Record<string, unknown>,
  documentId: string,
): Promise<void> {
  const previousHash = await getLastEventHash(adminClient, documentId);
  const eventHash = await computeEventHash(previousHash, {
    event_type: event.event_type,
    event_data: event.event_data,
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    timestamp: new Date().toISOString(),
  });
  await adminClient.from("document_signature_events").insert({
    ...event,
    previous_event_hash: previousHash,
    event_hash: eventHash,
  });
}

/** Compute a privacy-preserving device fingerprint hash */
function computeDeviceFingerprint(ip: string, ua: string): string {
  // We'll compute this synchronously with a simple hash approach
  // The actual crypto hash is async so we build a deterministic string
  const raw = `${ip}|${ua}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { signing_token, expires, signature } = body;

    if (!signing_token || !expires || !signature) {
      return json({ error: "signing_token, expires, and signature are required" }, 400);
    }

    const signingSecret = Deno.env.get("SIGNING_SECRET");
    if (!signingSecret) return json({ error: "Server configuration error" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    const clientIp = getClientIp(req);
    const clientUA = req.headers.get("user-agent") || "unknown";

    // Rate limiting: 20 req/min per IP
    const oneMinAgo = new Date(Date.now() - 60000).toISOString();
    const { count } = await adminClient
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("key", clientIp)
      .eq("endpoint", "validate-signing-link")
      .gte("window_start", oneMinAgo);

    if ((count || 0) >= 20) {
      return json({ error: "Demasiadas solicitudes. Intente nuevamente en unos minutos." }, 429);
    }

    await adminClient.from("rate_limits").insert({
      key: clientIp,
      endpoint: "validate-signing-link",
      window_start: new Date().toISOString(),
    });

    // Reject expires more than 168h (7 days) in the future
    const expiresMs = parseInt(expires) * 1000;
    const maxFutureMs = Date.now() + 168 * 60 * 60 * 1000;
    if (expiresMs > maxFutureMs) {
      console.warn(`Rejected future expiry from IP ${clientIp}: expires=${expires}`);
      return json({ error: "invalid_link", message: "El enlace de firma no es válido." }, 403);
    }

    // Timing-safe HMAC verification
    const expectedBytes = await computeHMAC(signingSecret, signing_token + expires);
    const providedBytes = hexToBytes(signature);
    if (!timingSafeEqual(expectedBytes, providedBytes)) {
      console.warn(`HMAC validation failed from IP ${clientIp}`);
      return json({ error: "invalid_link", message: "Este enlace no es válido. Verifique que esté usando el enlace correcto." }, 403);
    }

    // Check expiration
    if (Date.now() > expiresMs) {
      return json({ error: "expired", message: "Este enlace ha vencido. Solicite a su abogado un nuevo enlace de firma." }, 410);
    }

    // Fetch signature record
    const { data: sig, error: sigErr } = await adminClient
      .from("document_signatures")
      .select("id, document_id, signer_name, signer_email, signer_cedula, status, otp_verified_at, organization_id, created_by, consumed_at, identity_confirmed_at")
      .eq("signing_token", signing_token)
      .single();

    if (sigErr || !sig) {
      return json({ error: "not_found", message: "Documento no encontrado. Este enlace puede haber sido revocado." }, 404);
    }

    // Check if token was already consumed (one-time use after signing)
    if (sig.consumed_at) {
      return json({ error: "consumed", message: "Este enlace ya fue utilizado. El documento ya fue firmado." }, 409);
    }

    // DB-level TTL check (defense in depth — also checked via HMAC expiry above)
    if (sig.expires_at && new Date(sig.expires_at) < new Date()) {
      return json({ error: "expired", message: "Este enlace ha vencido. Solicite a su abogado un nuevo enlace de firma." }, 410);
    }

    if (sig.status === "signed") {
      const { data: fullSig } = await adminClient
        .from("document_signatures")
        .select("signed_at")
        .eq("id", sig.id)
        .single();
      const signedDate = fullSig?.signed_at
        ? new Date(fullSig.signed_at).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" })
        : "";
      return json({ error: "already_signed", message: `Este documento ya fue firmado${signedDate ? ` el ${signedDate}` : ""}.` }, 409);
    }
    if (sig.status === "revoked") {
      return json({ error: "revoked", message: "Esta solicitud de firma fue cancelada por el abogado." }, 403);
    }
    if (sig.status === "declined") {
      return json({ error: "declined", message: "Esta solicitud de firma fue declinada." }, 403);
    }
    if (sig.status === "expired") {
      return json({ error: "expired", message: "Este enlace ha vencido. Solicite a su abogado un nuevo enlace de firma." }, 410);
    }

    // Fetch document
    const { data: doc, error: docErr } = await adminClient
      .from("generated_documents")
      .select("id, title, content_html, document_type, status, created_by")
      .eq("id", sig.document_id)
      .single();

    if (docErr || !doc) {
      return json({ error: "document_not_found", message: "Documento no encontrado." }, 404);
    }

    // Resolve branding
    let branding = { logo_url: null as string | null, firm_name: "Andromeda Legal", is_custom: false };
    try {
      const [orgResult, profileResult] = await Promise.all([
        sig.organization_id
          ? adminClient.from("organizations").select("name, custom_branding_enabled, custom_logo_path, custom_firm_name").eq("id", sig.organization_id).single()
          : Promise.resolve({ data: null }),
        doc.created_by
          ? adminClient.from("profiles").select("full_name, custom_branding_enabled, custom_logo_path, custom_firm_name").eq("id", doc.created_by).single()
          : Promise.resolve({ data: null }),
      ]);
      branding = resolveBranding(supabaseUrl, orgResult.data, profileResult.data);
    } catch (e) {
      console.error("Branding resolution error:", e);
    }

    // Update status to viewed if pending
    if (sig.status === "pending") {
      await adminClient
        .from("document_signatures")
        .update({ status: "viewed" })
        .eq("id", sig.id);
    }

    // Device fingerprint
    const deviceFingerprintHash = computeDeviceFingerprint(clientIp, clientUA);
    const serverSessionId = crypto.randomUUID().substring(0, 8);

    // Log link opened event with hash chaining
    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id,
      document_id: sig.document_id,
      signature_id: sig.id,
      event_type: "signature.link_opened",
      event_data: { timestamp: new Date().toISOString(), device_session_indicator_hash: deviceFingerprintHash, server_session_id: serverSessionId },
      actor_type: "signer",
      actor_id: sig.signer_email,
      actor_ip: clientIp,
      actor_user_agent: clientUA,
      device_fingerprint_hash: deviceFingerprintHash,
    }, sig.document_id);

    // Mask cedula for display
    const maskedCedula = sig.signer_cedula
      ? sig.signer_cedula.replace(/^(.{2})(.*)(.{3})$/, (_, start, mid, end) => start + "*".repeat(mid.length) + end)
      : null;

    // Determine if identity confirmation is required (not yet confirmed)
    const requiresIdentityConfirmation = !sig.identity_confirmed_at;

    return json({
      ok: true,
      signature_id: sig.id,
      signer_name: sig.signer_name,
      signer_email_masked: sig.signer_email.replace(/^(.{2})(.*)(@.*)$/, (_, s, m, e) => s + "*".repeat(m.length) + e),
      signer_cedula_masked: maskedCedula,
      otp_verified: !!sig.otp_verified_at,
      identity_confirmed: !!sig.identity_confirmed_at,
      requires_identity_confirmation: requiresIdentityConfirmation,
      has_cedula: !!sig.signer_cedula,
      status: sig.status,
      branding,
      document: {
        id: doc.id,
        title: doc.title,
        content_html: sig.otp_verified_at ? doc.content_html : null,
        document_type: doc.document_type,
      },
    });
  } catch (err) {
    console.error("validate-signing-link error:", err);
    return json({ error: "Error de conexión. Por favor intente nuevamente." }, 500);
  }
});
