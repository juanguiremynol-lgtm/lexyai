/**
 * externalProviderClient.ts — SSRF-safe HTTP client for external provider calls.
 *
 * Features:
 *  - Domain allowlist enforcement (wildcard + exact match)
 *  - IP literal / localhost / private-range / metadata-host rejection
 *  - HTTPS-only scheme
 *  - Userinfo rejection
 *  - API_KEY header mode
 *  - HMAC_SHARED_SECRET request signing mode (anti-replay with timestamp + nonce)
 *  - Configurable timeout via AbortController
 */

// ────────────────────────────── Types ──────────────────────────────

export type AuthType = "API_KEY" | "HMAC_SHARED_SECRET";

export interface ProviderInstanceInfo {
  id: string;
  base_url: string;
  auth_type: AuthType;
  timeout_ms: number;
  rpm_limit: number;
  allowed_domains: string[]; // from connector.allowed_domains
}

// ────────────────────────────── URL / Host helpers ──────────────────────────────

export function parseHost(urlStr: string): { url: URL; host: string } {
  const url = new URL(urlStr);
  if (url.protocol !== "https:") throw new Error("Only https scheme is allowed");
  if (url.username || url.password) throw new Error("Userinfo in URL is not allowed");
  const host = url.hostname.toLowerCase();
  return { url, host };
}

export function isIpLiteral(host: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (bracketed in URL, but hostname strips brackets)
  if (host.includes(":")) return true;
  return false;
}

export function isBlockedHost(host: string): boolean {
  const blockedExact = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254", // AWS metadata
    "metadata.google.internal", // GCP metadata
  ];
  if (blockedExact.includes(host)) return true;
  if (host.endsWith(".local")) return true;
  // Private IPv4 ranges (basic check for common patterns)
  if (/^10\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  return false;
}

export function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  for (const pat of allowlist) {
    const p = pat.toLowerCase().trim();
    if (!p) continue;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1); // e.g. ".run.app"
      if (host === p.slice(2) || host.endsWith(suffix)) return true;
    } else if (host === p) {
      return true;
    }
  }
  return false;
}

export function validateUrl(urlStr: string, allowlist: string[]): URL {
  const { url, host } = parseHost(urlStr);
  if (isIpLiteral(host)) throw new Error(`Blocked: IP literal host "${host}"`);
  if (isBlockedHost(host)) throw new Error(`Blocked: forbidden host "${host}"`);
  if (!hostMatchesAllowlist(host, allowlist)) {
    throw new Error(`Host "${host}" is not in the connector allowlist [${allowlist.join(", ")}]`);
  }
  return url;
}

// ────────────────────────────── Crypto helpers ──────────────────────────────

export async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ────────────────────────────── Auth headers ──────────────────────────────

export async function buildAuthHeaders(params: {
  instance: ProviderInstanceInfo;
  decryptedSecret: string;
  method: string;
  path: string;
  body: string;
  orgId: string;
}): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-atenia-org-id": params.orgId,
  };

  if (params.instance.auth_type === "API_KEY") {
    headers["x-api-key"] = params.decryptedSecret;
    return headers;
  }

  // HMAC_SHARED_SECRET mode — anti-replay with timestamp + nonce
  const ts = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(params.body);
  const canonical = `${ts}.${nonce}.${params.method.toUpperCase()}.${params.path}.${bodyHash}`;
  const signature = await hmacSha256Hex(params.decryptedSecret, canonical);

  headers["x-atenia-timestamp"] = ts;
  headers["x-atenia-nonce"] = nonce;
  headers["x-atenia-signature"] = signature;
  headers["x-atenia-signature-input"] = "ts.nonce.method.path.body_sha256";
  return headers;
}

// ────────────────────────────── Safe fetch ──────────────────────────────

export async function safeFetchProvider(params: {
  url: string;
  allowlist: string[];
  init: RequestInit;
  timeoutMs: number;
}): Promise<Response> {
  // Validate URL against allowlist + SSRF checks
  validateUrl(params.url, params.allowlist);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), params.timeoutMs);
  try {
    return await fetch(params.url, { ...params.init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
