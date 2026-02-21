/**
 * verify-signing-identity — Confirms signer identity by matching name + cédula
 * against the document_signatures record (linked to work item data).
 * Public endpoint. Must be called before OTP step.
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

/** Normalize a name for comparison: lowercase, remove accents, collapse spaces, trim */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a cédula: extract digits only */
function normalizeCedula(cedula: string): string {
  return cedula.replace(/\D/g, "");
}

/** Mask a cédula for logging (show first 2 and last 3) */
function maskCedula(cedula: string): string {
  if (cedula.length <= 5) return "***";
  return cedula.substring(0, 2) + "*".repeat(cedula.length - 5) + cedula.substring(cedula.length - 3);
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
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

async function computeEventHash(previousHash: string | null, eventData: Record<string, unknown>): Promise<string> {
  const canonical = canonicalStringify(eventData);
  return sha256Hex((previousHash || "GENESIS") + canonical);
}

async function insertChainedEvent(adminClient: any, event: Record<string, unknown>, documentId: string): Promise<void> {
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

function computeDeviceFingerprint(ip: string, ua: string): string {
  const raw = `${ip}|${ua}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { signing_token, confirmed_name, confirmed_cedula } = body;

    if (!signing_token || !confirmed_name || !confirmed_cedula) {
      return json({ error: "signing_token, confirmed_name, and confirmed_cedula are required" }, 400);
    }

    // Basic input validation
    if (typeof confirmed_name !== "string" || confirmed_name.trim().length < 2) {
      return json({ error: "Nombre inválido." }, 400);
    }
    if (typeof confirmed_cedula !== "string" || normalizeCedula(confirmed_cedula).length < 4) {
      return json({ error: "Número de cédula inválido." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    const clientIp = getClientIp(req);
    const clientUA = req.headers.get("user-agent") || "unknown";
    const deviceFingerprintHash = computeDeviceFingerprint(clientIp, clientUA);

    // Rate limiting: 10 attempts per token per hour
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await adminClient
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("key", `identity:${signing_token}`)
      .eq("endpoint", "verify-signing-identity")
      .gte("window_start", oneHourAgo);

    if ((count || 0) >= 10) {
      return json({ error: "Demasiados intentos de verificación. Intente nuevamente más tarde." }, 429);
    }

    await adminClient.from("rate_limits").insert({
      key: `identity:${signing_token}`,
      endpoint: "verify-signing-identity",
      window_start: new Date().toISOString(),
    });

    // Fetch signature record
    const { data: sig, error: sigErr } = await adminClient
      .from("document_signatures")
      .select("id, document_id, signer_name, signer_email, signer_cedula, status, organization_id, identity_confirmed_at")
      .eq("signing_token", signing_token)
      .single();

    if (sigErr || !sig) return json({ error: "Solicitud de firma no encontrada." }, 404);
    if (sig.status === "signed") return json({ error: "Este documento ya fue firmado." }, 409);

    // Already confirmed
    if (sig.identity_confirmed_at) {
      return json({ ok: true, already_confirmed: true, message: "Identidad ya verificada." });
    }

    // Normalize and compare
    const normalizedInputCedula = normalizeCedula(confirmed_cedula);
    const normalizedStoredCedula = sig.signer_cedula ? normalizeCedula(sig.signer_cedula) : "";
    const normalizedInputName = normalizeName(confirmed_name);
    const normalizedStoredName = normalizeName(sig.signer_name);

    // Primary check: cédula must match exactly (digits only)
    const cedulaMatch = normalizedInputCedula === normalizedStoredCedula;

    // Name check: normalized comparison
    const nameMatch = normalizedInputName === normalizedStoredName;

    // If cédula matches, allow minor name variations (e.g., middle name missing)
    // by checking if input name words are a subset of stored name words
    let nameFlexibleMatch = false;
    if (cedulaMatch && !nameMatch) {
      const inputWords = normalizedInputName.split(" ").filter(w => w.length > 1);
      const storedWords = normalizedStoredName.split(" ").filter(w => w.length > 1);
      // At least 2 words must match (first + last name minimum)
      const matchingWords = inputWords.filter(w => storedWords.includes(w));
      nameFlexibleMatch = matchingWords.length >= 2 && matchingWords.length >= Math.min(inputWords.length, storedWords.length) - 1;
    }

    const identityVerified = cedulaMatch && (nameMatch || nameFlexibleMatch);

    if (!identityVerified) {
      // Log failed attempt (masked data only)
      await insertChainedEvent(adminClient, {
        organization_id: sig.organization_id,
        document_id: sig.document_id,
        signature_id: sig.id,
        event_type: "signature.identity_failed",
        event_data: {
          timestamp: new Date().toISOString(),
          cedula_match: cedulaMatch,
          name_match: nameMatch || nameFlexibleMatch,
          input_cedula_masked: maskCedula(normalizedInputCedula),
          device_fingerprint_hash: deviceFingerprintHash,
        },
        actor_type: "signer",
        actor_id: sig.signer_email,
        actor_ip: clientIp,
        actor_user_agent: clientUA,
        device_fingerprint_hash: deviceFingerprintHash,
      }, sig.document_id);

      return json({
        ok: false,
        verified: false,
        message: "Los datos ingresados no coinciden con los registros del documento. Verifique su nombre completo y número de cédula.",
      }, 403);
    }

    // Identity confirmed — update signature record
    const now = new Date().toISOString();
    await adminClient
      .from("document_signatures")
      .update({
        identity_confirmed_at: now,
        identity_confirmation_data: {
          confirmed_name: confirmed_name.trim(),
          confirmed_cedula_masked: maskCedula(normalizedInputCedula),
          method: "name_cedula_match",
          confirmed_at: now,
          ip: clientIp,
          device_fingerprint_hash: deviceFingerprintHash,
        },
        device_fingerprint_hash: deviceFingerprintHash,
      })
      .eq("id", sig.id);

    // Log successful identity confirmation with hash chaining
    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id,
      document_id: sig.document_id,
      signature_id: sig.id,
      event_type: "signature.identity_confirmed",
      event_data: {
        timestamp: now,
        method: "name_cedula_match",
        cedula_matched: true,
        name_matched: nameMatch,
        name_flexible_matched: nameFlexibleMatch,
        device_fingerprint_hash: deviceFingerprintHash,
      },
      actor_type: "signer",
      actor_id: sig.signer_email,
      actor_ip: clientIp,
      actor_user_agent: clientUA,
      device_fingerprint_hash: deviceFingerprintHash,
    }, sig.document_id);

    return json({
      ok: true,
      verified: true,
      message: "Identidad verificada correctamente.",
    });
  } catch (err) {
    console.error("verify-signing-identity error:", err);
    return json({ error: "Error de conexión. Por favor intente nuevamente." }, 500);
  }
});
