/**
 * Iteration 39 — self-service, multi-tenant mailbox connection.
 *
 * Guards the three things that would silently break tenants:
 *  1. no tenant identity is hardcoded in the matcher,
 *  2. the connect consent stays read-only,
 *  3. every classified Microsoft failure has actionable Spanish copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { presentFailure, type EmailFailureCode } from "@/lib/email-connection-failures";

const read = (p: string) => readFileSync(p, "utf8");

describe("multi-tenant identity", () => {
  it("keeps no hardcoded owner name or address in the matcher", () => {
    const src = read("supabase/functions/_shared/emailMatcher.ts");
    expect(src).not.toMatch(/lexetlit\.com/i);
    expect(src).not.toMatch(/RESTREPO MAYA/i);
    expect(src).toMatch(/FALLBACK_OWNER_IDENTITY: OwnerIdentity = \{ names: \[\], emails: \[\] \}/);
  });

  it("derives the owner identity from the connected mailbox and profile", () => {
    const src = read("supabase/functions/outlook-sync/index.ts");
    expect(src).toMatch(/conn\.ms_account_email/);
    expect(src).toMatch(/\.eq\("id", conn\.user_id\)/);
  });
});

describe("consent scopes", () => {
  it("requests read-only access when connecting", () => {
    const src = read("supabase/functions/_shared/msOAuth.ts");
    expect(src).toMatch(/CONNECT_SCOPES = \["Mail\.Read", "offline_access", "User\.Read"\]/);
    // Mail.Send only via incremental consent.
    expect(src).toMatch(/SEND_SCOPES = \[\.\.\.CONNECT_SCOPES, "Mail\.Send"\]/);
  });

  it("uses a multi-tenant authority, not a single fixed tenant", () => {
    const src = read("supabase/functions/_shared/msOAuth.ts");
    expect(src).toMatch(/MS_AUTHORITY_TENANT.*\|\| "common"/);
  });

  it("uses PKCE on the authorize request", () => {
    const src = read("supabase/functions/outlook-connect/index.ts");
    expect(src).toMatch(/code_challenge/);
    expect(src).toMatch(/S256/);
  });
});

describe("failure presentation", () => {
  const codes: EmailFailureCode[] = [
    "ADMIN_CONSENT_REQUIRED",
    "CONDITIONAL_ACCESS",
    "MFA_REQUIRED",
    "CONSENT_REVOKED",
    "PASSWORD_CHANGED",
    "TOKEN_EXPIRED",
    "USER_DECLINED",
    "UNVERIFIED_PUBLISHER",
    "UNKNOWN",
  ];

  it("covers every code the backend classifier can emit", () => {
    const src = read("supabase/functions/_shared/msOAuth.ts");
    for (const code of codes) expect(src).toContain(code);
    for (const code of codes) expect(presentFailure(code)).not.toBeNull();
  });

  it("never leaks a Microsoft error number to the user", () => {
    for (const code of codes) {
      const p = presentFailure(code)!;
      expect(p.detail).not.toMatch(/AADSTS/);
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.actionLabel.length).toBeGreaterThan(3);
    }
  });

  it("routes tenant-blocked cases to the administrator flow", () => {
    expect(presentFailure("ADMIN_CONSENT_REQUIRED")!.action).toBe("ADMIN_CONSENT");
    expect(presentFailure("UNVERIFIED_PUBLISHER")!.action).toBe("ADMIN_CONSENT");
    expect(presentFailure("CONSENT_REVOKED")!.action).toBe("RECONNECT");
  });

  it("returns nothing when there is no failure", () => {
    expect(presentFailure(null)).toBeNull();
    expect(presentFailure(undefined)).toBeNull();
  });
});

describe("revocation", () => {
  it("wipes tokens and does not downgrade a revoked grant to a retryable error", () => {
    const disc = read("supabase/functions/outlook-disconnect/index.ts");
    expect(disc).toMatch(/access_token_cipher: null/);
    expect(disc).toMatch(/refresh_token_cipher: null/);
    expect(disc).toMatch(/status: "REVOKED"/);
    const sync = read("supabase/functions/outlook-sync/index.ts");
    expect(sync).toMatch(/if \(!\(e instanceof ConnectionRevokedError\)\)/);
  });
});
