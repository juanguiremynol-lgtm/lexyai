/**
 * MM1/MM2/MM3 — the mailbox connection must never fail silently again.
 *
 * These guard the three regressions that produced the 17-day outage:
 *  1. AADSTS50194 was classified as UNKNOWN, so nobody could act on it,
 *  2. the refresh path left no trace of its attempts,
 *  3. the UI offered a "retry" button for a failure only we can fix.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { presentFailure, type EmailFailureCode } from "@/lib/email-connection-failures";

const read = (p: string) => readFileSync(p, "utf8");

describe("MM1 — AADSTS classification", () => {
  const src = read("supabase/functions/_shared/msOAuth.ts");

  it("maps the single-tenant misconfiguration to its own code", () => {
    expect(src).toMatch(/APP_NOT_MULTITENANT/);
    expect(src).toMatch(/AADSTS50194/);
  });

  it("classifies tenant, consent, MFA, expiry and outage families explicitly", () => {
    for (const code of ["AADSTS90002", "AADSTS65001", "AADSTS50076", "AADSTS700084", "AADSTS50173"]) {
      expect(src).toContain(code);
    }
    expect(src).toMatch(/PROVIDER_UNAVAILABLE/);
  });

  it("keeps the raw Microsoft identifier for support without showing it", () => {
    expect(src).toMatch(/export function extractAadsts/);
    const codes: EmailFailureCode[] = [
      "APP_NOT_MULTITENANT",
      "TENANT_NOT_FOUND",
      "PROVIDER_UNAVAILABLE",
    ];
    for (const c of codes) expect(presentFailure(c)!.detail).not.toMatch(/AADSTS/);
  });

  it("tells the lawyer to do nothing when only the vendor can fix it", () => {
    expect(presentFailure("APP_NOT_MULTITENANT")!.action).toBe("NONE");
    expect(presentFailure("PROVIDER_UNAVAILABLE")!.action).toBe("NONE");
    expect(presentFailure("TENANT_NOT_FOUND")!.action).toBe("RECONNECT");
  });
});

describe("MM2 — proactive refresh", () => {
  const graph = read("supabase/functions/_shared/outlookGraph.ts");

  it("renews well before expiry instead of at the last minute", () => {
    expect(graph).toMatch(/REFRESH_SKEW_MS = 20 \* 60_000/);
    expect(graph).toMatch(/expiresAt > Date\.now\(\) \+ REFRESH_SKEW_MS/);
  });

  it("retries transient refusals with backoff but never terminal ones", () => {
    expect(graph).toMatch(/REFRESH_BACKOFF_MS/);
    expect(graph).toMatch(/if \(failure\.terminal \|\| failure\.resolution === "VENDOR_FIX"\) break;/);
  });

  it("stamps every attempt, success or failure", () => {
    expect(graph).toMatch(/last_refresh_outcome: "SUCCESS"/);
    expect(graph).toMatch(/last_refresh_outcome: "FAILED"/);
    expect(graph).toMatch(/refresh_failure_count/);
  });

  it("runs on its own schedule, not only inside a mailbox sync", () => {
    const fn = read("supabase/functions/outlook-token-refresh/index.ts");
    expect(fn).toMatch(/REFRESH_SKEW_MS/);
    expect(fn).toMatch(/\.in\("status", \["CONNECTED", "ERROR"\]\)/);
    // A revoked grant is the lawyer's decision: never retried automatically.
    expect(fn).not.toMatch(/"REVOKED"/);
  });

  it("never logs a token", () => {
    const fn = read("supabase/functions/outlook-token-refresh/index.ts");
    expect(fn).not.toMatch(/console\.[a-z]+\([^)]*(access_token|refresh_token|Bearer)/i);
  });
});

describe("MM3 — visible, self-service connection state", () => {
  it("derives one health state the UI can render", () => {
    const hook = read("src/hooks/use-email-connection.ts");
    expect(hook).toMatch(/export function connectionHealth/);
    for (const s of ["ACTIVA", "POR_VENCER", "ERROR", "NO_CONECTADO", "CONECTANDO"]) {
      expect(hook).toContain(s);
    }
    expect(hook).toMatch(/token_expires_at, last_refresh_at, last_refresh_outcome/);
  });

  it("shows the state and disables retry when retrying cannot help", () => {
    const ui = read("src/pages/SettingsConnections.tsx");
    expect(ui).toMatch(/connectionHealth/);
    expect(ui).toMatch(/failure\?\.action === "NONE"/);
    expect(ui).toMatch(/Última renovación automática/);
  });
});
