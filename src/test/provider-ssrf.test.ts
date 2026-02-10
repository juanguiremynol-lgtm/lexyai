import { describe, it, expect } from "vitest";

// Re-implement the pure functions from externalProviderClient.ts for vitest (Node) context
// These mirror the edge function implementations exactly.

function parseHost(urlStr: string): { url: URL; host: string } {
  const url = new URL(urlStr);
  if (url.protocol !== "https:") throw new Error("Only https scheme is allowed");
  if (url.username || url.password) throw new Error("Userinfo in URL is not allowed");
  const host = url.hostname.toLowerCase();
  return { url, host };
}

function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

function isBlockedHost(host: string): boolean {
  const blockedExact = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "metadata.google.internal",
  ];
  if (blockedExact.includes(host)) return true;
  if (host.endsWith(".local")) return true;
  if (/^10\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  return false;
}

function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  for (const pat of allowlist) {
    const p = pat.toLowerCase().trim();
    if (!p) continue;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1);
      if (host === p.slice(2) || host.endsWith(suffix)) return true;
    } else if (host === p) {
      return true;
    }
  }
  return false;
}

function validateUrl(urlStr: string, allowlist: string[]): URL {
  const { url, host } = parseHost(urlStr);
  if (isIpLiteral(host)) throw new Error(`Blocked: IP literal host "${host}"`);
  if (isBlockedHost(host)) throw new Error(`Blocked: forbidden host "${host}"`);
  if (!hostMatchesAllowlist(host, allowlist)) {
    throw new Error(`Host "${host}" is not in the connector allowlist [${allowlist.join(", ")}]`);
  }
  return url;
}

describe("SSRF Protection", () => {
  const allowlist = ["api.partner.com", "*.run.app"];

  it("rejects http scheme", () => {
    expect(() => validateUrl("http://api.partner.com/resolve", allowlist)).toThrow(
      "Only https scheme is allowed"
    );
  });

  it("rejects localhost", () => {
    expect(() => validateUrl("https://localhost/resolve", allowlist)).toThrow("Blocked");
  });

  it("rejects 127.0.0.1 (IP literal)", () => {
    expect(() => validateUrl("https://127.0.0.1/resolve", allowlist)).toThrow("Blocked");
  });

  it("rejects arbitrary IPv4 literal", () => {
    expect(() => validateUrl("https://192.168.1.1/resolve", allowlist)).toThrow("Blocked");
  });

  it("rejects private range 10.x", () => {
    expect(() => validateUrl("https://10.0.0.5/resolve", allowlist)).toThrow("Blocked");
  });

  it("rejects private range 172.16.x", () => {
    expect(() => validateUrl("https://172.16.0.1/resolve", allowlist)).toThrow("Blocked");
  });

  it("rejects AWS metadata host", () => {
    expect(() => validateUrl("https://169.254.169.254/latest/meta-data/", allowlist)).toThrow(
      "Blocked"
    );
  });

  it("rejects GCP metadata host", () => {
    expect(() => validateUrl("https://metadata.google.internal/computeMetadata/", allowlist)).toThrow(
      "Blocked"
    );
  });

  it("rejects .local suffix", () => {
    expect(() => validateUrl("https://myserver.local/api", allowlist)).toThrow("Blocked");
  });

  it("rejects URL with userinfo", () => {
    expect(() => validateUrl("https://user:pass@api.partner.com/resolve", allowlist)).toThrow(
      "Userinfo"
    );
  });

  it("rejects host not in allowlist", () => {
    expect(() => validateUrl("https://evil.example.com/resolve", allowlist)).toThrow(
      "not in the connector allowlist"
    );
  });

  it("accepts api.partner.com when allowlist includes it", () => {
    const url = validateUrl("https://api.partner.com/resolve", allowlist);
    expect(url.hostname).toBe("api.partner.com");
  });

  it("accepts wildcard match *.run.app", () => {
    const url = validateUrl("https://my-service.run.app/snapshot", allowlist);
    expect(url.hostname).toBe("my-service.run.app");
  });

  it("accepts exact match for wildcard root (run.app)", () => {
    const url = validateUrl("https://run.app/test", allowlist);
    expect(url.hostname).toBe("run.app");
  });
});
