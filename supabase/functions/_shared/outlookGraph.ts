/**
 * outlookGraph.ts — Microsoft Graph helpers for the multi-tenant Outlook
 * integration.
 *
 * Design invariants (ratified, non-negotiable):
 *   1. Multi-user: every subscriber connects their OWN mailbox.
 *   2. Inference, not mirroring: Andromeda never persists full message bodies.
 *   3. Read-only: the only mail scope requested is Mail.Read. Never Mail.Send
 *      and never Mail.ReadWrite.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const GRAPH_SCOPES = ["Mail.Read", "offline_access", "User.Read"] as const;

export function msConfig() {
  const clientId = Deno.env.get("MS_CLIENT_ID");
  const clientSecret = Deno.env.get("MS_CLIENT_SECRET");
  const tenant = Deno.env.get("MS_TENANT_ID") || "common";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const redirectUri = Deno.env.get("MS_REDIRECT_URI") ||
    `${supabaseUrl}/functions/v1/outlook-callback`;
  return { clientId, clientSecret, tenant, redirectUri };
}

export function authorityBase(tenant: string) {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

// ---------------------------------------------------------------- crypto ---

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = Deno.env.get("MS_GRAPH_ENCRYPTION_KEY");
  if (!raw) throw new Error("Missing env MS_GRAPH_ENCRYPTION_KEY");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  cachedKey = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

function toHex(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromPg(value: string | null): Uint8Array | null {
  if (!value) return null;
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function encryptToken(plain: string): Promise<{ cipherHex: string; nonceHex: string }> {
  const key = await getKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(plain),
  );
  return { cipherHex: toHex(new Uint8Array(buf)), nonceHex: toHex(nonce) };
}

export async function decryptToken(cipher: string | null, nonce: string | null): Promise<string | null> {
  const c = fromPg(cipher);
  const n = fromPg(nonce);
  if (!c || !n) return null;
  const key = await getKey();
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: n }, key, c);
  return new TextDecoder().decode(new Uint8Array(buf));
}

// ------------------------------------------------------------ state HMAC ---

async function hmacKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("MS_GRAPH_ENCRYPTION_KEY");
  if (!raw) throw new Error("Missing env MS_GRAPH_ENCRYPTION_KEY");
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Stateless signed OAuth state: userId + orgId + issued-at, HMAC-SHA256. */
export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ ...payload, iat: Date.now() })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyState(
  state: string,
  maxAgeMs = 15 * 60 * 1000,
): Promise<Record<string, unknown> | null> {
  const [body, sig] = (state || "").split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    unb64url(sig),
    new TextEncoder().encode(body),
  );
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
  if (typeof payload.iat !== "number" || Date.now() - payload.iat > maxAgeMs) return null;
  return payload;
}

// ------------------------------------------------------------ token flow ---

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const { tenant } = msConfig();
  const res = await fetch(`${authorityBase(tenant)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Microsoft token endpoint [${res.status}]: ${text}`);
  return JSON.parse(text) as TokenResponse;
}

export function exchangeCode(code: string) {
  const { clientId, clientSecret, redirectUri } = msConfig();
  return tokenRequest({
    client_id: clientId!,
    client_secret: clientSecret!,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: GRAPH_SCOPES.join(" "),
  });
}

export function refreshTokens(refreshToken: string) {
  const { clientId, clientSecret, redirectUri } = msConfig();
  return tokenRequest({
    client_id: clientId!,
    client_secret: clientSecret!,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: redirectUri,
    scope: GRAPH_SCOPES.join(" "),
  });
}

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export async function graphGet(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH_BASE}${url}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Graph [${res.status}]: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}