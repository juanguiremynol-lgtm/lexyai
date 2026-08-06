/**
 * outlookGraph.ts — Microsoft Graph helpers for the multi-tenant Outlook
 * integration.
 *
 * Design invariants (ratified, non-negotiable):
 *   1. Multi-tenant: ONE Andromeda-owned Azure app registration; every
 *      subscriber connects their OWN mailbox from their OWN directory and
 *      never supplies a client id or secret.
 *   2. Inference, not mirroring: Andromeda never persists full message bodies.
 *   3. Mail.ReadWrite is never requested — Andromeda never modifies or deletes
 *      anything in the mailbox. Mail.Send is NOT requested at connection time
 *      either: it is asked for incrementally, the first time the user sends.
 */
import {
  CONNECT_SCOPES,
  SEND_SCOPES,
  authorityTenant,
  classifyMsError,
  scopesFor,
} from "./msOAuth.ts";

export { CONNECT_SCOPES, SEND_SCOPES, scopesFor };

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * Outbound sending, authorized with two controls: explicit per-send human
 * confirmation in the UI and an immutable audit log row per attempt.
 */
export const OUTLOOK_SEND_ENABLED = true;

/**
 * Back-compat alias. Connection-time consent is read-only; Mail.Send arrives
 * through incremental consent (see SEND_SCOPES).
 */
export const GRAPH_SCOPES = CONNECT_SCOPES;

/** Parses the space-delimited scope string Microsoft returns with the token. */
export function parseScopes(scope: string | undefined | null): string[] {
  return (scope ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split("/").pop() as string);
}

export function grantsSend(scopes: string[]): boolean {
  return scopes.some((s) => s.toLowerCase() === "mail.send");
}

export function msConfig() {
  const clientId = Deno.env.get("MS_CLIENT_ID");
  const clientSecret = Deno.env.get("MS_CLIENT_SECRET");
  // Multi-tenant authority. MS_TENANT_ID (the owner's own directory) is kept
  // only for reference; it must never pin the authority for other customers.
  const tenant = authorityTenant();
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

/**
 * POST to Graph. Returns the parsed body (empty object for 202/204 replies).
 * Errors carry the provider status and body verbatim — never a generic 500.
 */
export async function graphPost(
  url: string,
  accessToken: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH_BASE}${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Graph [${res.status}]: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

// ------------------------------------------------------- connection tokens ---

export interface StoredConnection {
  id: string;
  access_token_cipher: string | null;
  access_token_nonce: string | null;
  refresh_token_cipher: string | null;
  refresh_token_nonce: string | null;
  token_expires_at: string | null;
}

/**
 * Returns a valid access token for the connection, refreshing and re-persisting
 * it when the stored one is expired or about to expire.
 */
export async function ensureAccessToken(
  admin: { from: (t: string) => any },
  conn: StoredConnection,
): Promise<string> {
  const expiresAt = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  if (expiresAt > Date.now() + 60_000) {
    const token = await decryptToken(conn.access_token_cipher, conn.access_token_nonce);
    if (token) return token;
  }
  const refresh = await decryptToken(conn.refresh_token_cipher, conn.refresh_token_nonce);
  if (!refresh) throw new Error("La conexión no tiene refresh token. Vuelve a conectar Outlook.");

  const tokens = await refreshTokens(refresh);
  const access = await encryptToken(tokens.access_token);
  const scopes = parseScopes(tokens.scope);
  const patch: Record<string, unknown> = {
    access_token_cipher: access.cipherHex,
    access_token_nonce: access.nonceHex,
    token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
    status: "CONNECTED",
    last_error: null,
  };
  if (scopes.length > 0) {
    patch.scopes = scopes;
    patch.can_send = grantsSend(scopes);
  }
  if (tokens.refresh_token) {
    const nr = await encryptToken(tokens.refresh_token);
    patch.refresh_token_cipher = nr.cipherHex;
    patch.refresh_token_nonce = nr.nonceHex;
  }
  await admin.from("user_email_connections").update(patch).eq("id", conn.id);
  return tokens.access_token;
}