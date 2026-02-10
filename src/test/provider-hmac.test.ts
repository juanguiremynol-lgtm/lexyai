import { describe, it, expect } from "vitest";

// Mirror the crypto helpers from externalProviderClient.ts for Node/vitest context
// using Web Crypto API (available in Node 18+)

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type AuthType = "API_KEY" | "HMAC_SHARED_SECRET";

interface ProviderInstanceInfo {
  id: string;
  base_url: string;
  auth_type: AuthType;
  timeout_ms: number;
  rpm_limit: number;
  allowed_domains: string[];
}

async function buildAuthHeaders(params: {
  instance: ProviderInstanceInfo;
  decryptedSecret: string;
  method: string;
  path: string;
  body: string;
  orgId: string;
  // For deterministic testing:
  _ts?: string;
  _nonce?: string;
}): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-atenia-org-id": params.orgId,
  };

  if (params.instance.auth_type === "API_KEY") {
    headers["x-api-key"] = params.decryptedSecret;
    return headers;
  }

  const ts = params._ts || new Date().toISOString();
  const nonce = params._nonce || crypto.randomUUID();
  const bodyHash = await sha256Hex(params.body);
  const canonical = `${ts}.${nonce}.${params.method.toUpperCase()}.${params.path}.${bodyHash}`;
  const signature = await hmacSha256Hex(params.decryptedSecret, canonical);

  headers["x-atenia-timestamp"] = ts;
  headers["x-atenia-nonce"] = nonce;
  headers["x-atenia-signature"] = signature;
  headers["x-atenia-signature-input"] = "ts.nonce.method.path.body_sha256";
  return headers;
}

describe("HMAC Signing", () => {
  const instance: ProviderInstanceInfo = {
    id: "inst-1",
    base_url: "https://api.partner.com",
    auth_type: "HMAC_SHARED_SECRET",
    timeout_ms: 8000,
    rpm_limit: 60,
    allowed_domains: ["api.partner.com"],
  };

  const fixedTs = "2026-01-15T10:00:00.000Z";
  const fixedNonce = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const secret = "my-shared-secret-key";
  const body = JSON.stringify({ input_type: "RADICADO", value: "2024-00123" });

  it("produces deterministic signature for known inputs", async () => {
    const headers1 = await buildAuthHeaders({
      instance,
      decryptedSecret: secret,
      method: "POST",
      path: "/resolve",
      body,
      orgId: "org-123",
      _ts: fixedTs,
      _nonce: fixedNonce,
    });

    const headers2 = await buildAuthHeaders({
      instance,
      decryptedSecret: secret,
      method: "POST",
      path: "/resolve",
      body,
      orgId: "org-123",
      _ts: fixedTs,
      _nonce: fixedNonce,
    });

    expect(headers1["x-atenia-signature"]).toBe(headers2["x-atenia-signature"]);
    expect(headers1["x-atenia-signature"]).toHaveLength(64); // SHA-256 hex
    expect(headers1["x-atenia-timestamp"]).toBe(fixedTs);
    expect(headers1["x-atenia-nonce"]).toBe(fixedNonce);
  });

  it("changes signature when body changes", async () => {
    const h1 = await buildAuthHeaders({
      instance,
      decryptedSecret: secret,
      method: "POST",
      path: "/resolve",
      body: '{"a":1}',
      orgId: "org-123",
      _ts: fixedTs,
      _nonce: fixedNonce,
    });

    const h2 = await buildAuthHeaders({
      instance,
      decryptedSecret: secret,
      method: "POST",
      path: "/resolve",
      body: '{"a":2}',
      orgId: "org-123",
      _ts: fixedTs,
      _nonce: fixedNonce,
    });

    expect(h1["x-atenia-signature"]).not.toBe(h2["x-atenia-signature"]);
  });

  it("changes signature when secret changes", async () => {
    const h1 = await buildAuthHeaders({
      instance,
      decryptedSecret: "secret-A",
      method: "POST",
      path: "/resolve",
      body,
      orgId: "org-123",
      _ts: fixedTs,
      _nonce: fixedNonce,
    });

    const h2 = await buildAuthHeaders({
      instance,
      decryptedSecret: "secret-B",
      method: "POST",
      path: "/resolve",
      body,
      orgId: "org-123",
      _ts: fixedTs,
      _nonce: fixedNonce,
    });

    expect(h1["x-atenia-signature"]).not.toBe(h2["x-atenia-signature"]);
  });

  it("API_KEY mode returns x-api-key header, no signature", async () => {
    const apiKeyInstance: ProviderInstanceInfo = {
      ...instance,
      auth_type: "API_KEY",
    };

    const headers = await buildAuthHeaders({
      instance: apiKeyInstance,
      decryptedSecret: "my-api-key-123",
      method: "POST",
      path: "/resolve",
      body,
      orgId: "org-123",
    });

    expect(headers["x-api-key"]).toBe("my-api-key-123");
    expect(headers["x-atenia-signature"]).toBeUndefined();
    expect(headers["x-atenia-timestamp"]).toBeUndefined();
  });
});
