/**
 * WhatsApp Provider Adapter — Meta WhatsApp Business Cloud API.
 *
 * Single point of integration. To swap to another provider (e.g. Twilio),
 * replace only this file.
 */

const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

export interface WhatsAppEnv {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
}

export function readWhatsAppEnv(): WhatsAppEnv | null {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!accessToken || !phoneNumberId || !verifyToken || !appSecret) return null;
  return { accessToken, phoneNumberId, verifyToken, appSecret };
}

export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // constant-time compare
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function sendWhatsAppText(
  env: WhatsAppEnv,
  toE164: string,
  body: string,
): Promise<{ ok: boolean; wa_message_id?: string; error?: string }> {
  const to = toE164.replace(/^\+/, "");
  const url = `${META_GRAPH_BASE}/${env.phoneNumberId}/messages`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: body.slice(0, 4000), preview_url: false },
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: JSON.stringify(json).slice(0, 500) };
    }
    const waId = json?.messages?.[0]?.id;
    return { ok: true, wa_message_id: waId };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  }
}

export interface ParsedInboundMessage {
  waMessageId: string;
  fromE164: string; // with +
  timestamp: number;
  type: string;
  text?: string;
  profileName?: string;
}

/**
 * Extract the first user text message from a Meta webhook payload.
 * Ignores status callbacks and non-text media.
 */
export function parseInboundMessage(payload: unknown): ParsedInboundMessage | null {
  try {
    const entry = (payload as { entry?: unknown[] })?.entry?.[0] as {
      changes?: unknown[];
    } | undefined;
    const change = entry?.changes?.[0] as { value?: Record<string, unknown> } | undefined;
    const value = change?.value ?? {};
    const messages = (value.messages as unknown[]) ?? [];
    if (!messages.length) return null;
    const msg = messages[0] as Record<string, unknown>;
    const contact = ((value.contacts as unknown[]) ?? [])[0] as
      | { profile?: { name?: string } }
      | undefined;
    const from = String(msg.from ?? "");
    if (!from) return null;
    return {
      waMessageId: String(msg.id ?? ""),
      fromE164: from.startsWith("+") ? from : `+${from}`,
      timestamp: Number(msg.timestamp ?? Date.now() / 1000),
      type: String(msg.type ?? "text"),
      text: (msg.text as { body?: string } | undefined)?.body,
      profileName: contact?.profile?.name,
    };
  } catch {
    return null;
  }
}
