/**
 * Cross-component equivalence for mailbox health.
 *
 * The audit's finding was not that any single rule was wrong: it was that the
 * screen, the MCP tool, the digest and the SQL detector each carried their own.
 * These tests pin the shared TS policy and the Deno copy the digest consumes to
 * the SAME verdict over the exact matrix the audit used, including the case it
 * caught: a voluntary disconnect must raise NOTHING anywhere.
 */
import { describe, expect, it } from "vitest";
import {
  emailConnectionHealth,
  isExternalRevocation,
  type EmailHealthInput,
} from "@/lib/email-connection-health";
import {
  digestConnectionIssue,
  emailConnectionHealth as denoHealth,
  isVoluntaryDisconnect,
} from "../../supabase/functions/_shared/emailConnectionHealth";

const NOW = Date.parse("2026-09-19T19:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const healthy: EmailHealthInput = {
  status: "CONNECTED",
  last_refresh_at: hoursAgo(0.5),
  last_refresh_success_at: hoursAgo(0.5),
  last_refresh_outcome: "SUCCESS",
  refresh_failure_count: 0,
  token_expires_at: new Date(NOW + 3_000_000).toISOString(),
};

const voluntaryDisconnect: EmailHealthInput = {
  status: "REVOKED",
  revoked_at: hoursAgo(2),
  failure_code: null,
};

const externalRevocation: EmailHealthInput = {
  status: "REVOKED",
  revoked_at: hoursAgo(2),
  failure_code: "invalid_grant",
};

/** The case the digest used to miss entirely: no expiry recorded at all. */
const staleNoExpiry: EmailHealthInput = {
  status: "CONNECTED",
  last_refresh_at: hoursAgo(25),
  last_refresh_success_at: hoursAgo(25),
  last_refresh_outcome: "SUCCESS",
  refresh_failure_count: 0,
  token_expires_at: null,
};

const failingRenewal: EmailHealthInput = {
  status: "CONNECTED",
  last_refresh_at: hoursAgo(0.2),
  last_refresh_success_at: hoursAgo(3),
  last_refresh_outcome: "FAILED",
  refresh_failure_count: 3,
  token_expires_at: new Date(NOW + 1_000_000).toISOString(),
};

describe("shared policy and its Deno copy never diverge", () => {
  for (const [name, row] of Object.entries({
    healthy,
    voluntaryDisconnect,
    externalRevocation,
    staleNoExpiry,
    failingRenewal,
  })) {
    it(name, () => {
      expect(denoHealth(row, NOW)).toBe(emailConnectionHealth(row, NOW));
    });
  }
});

describe("digest verdict", () => {
  it("a voluntary disconnect raises nothing at all", () => {
    expect(isVoluntaryDisconnect(voluntaryDisconnect)).toBe(true);
    expect(digestConnectionIssue(voluntaryDisconnect, NOW)).toBeNull();
  });

  it("an external revocation is critical and named as Microsoft's", () => {
    expect(isExternalRevocation(externalRevocation)).toBe(true);
    const issue = digestConnectionIssue(externalRevocation, NOW)!;
    expect(issue.severity).toBe("CRITICAL");
    expect(issue.status).toBe("REVOCADA POR MICROSOFT");
  });

  it("a healthy mailbox raises nothing even with the access token about to expire", () => {
    expect(digestConnectionIssue(healthy, NOW)).toBeNull();
  });

  it("25 h without a successful renewal is reported even when no expiry is stored", () => {
    const issue = digestConnectionIssue(staleNoExpiry, NOW)!;
    expect(issue.status).toBe("SIN RENOVACIÓN");
    expect(emailConnectionHealth(staleNoExpiry, NOW)).toBe("POR_VENCER");
  });

  it("consecutive failures are a warning, not a 24-hour claim", () => {
    const issue = digestConnectionIssue(failingRenewal, NOW)!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.headline).not.toContain("24");
  });

  it("a later successful attempt does not resurrect an old success date", () => {
    // The operational defect: last_refresh_at advanced with SUCCESS while
    // last_refresh_success_at lagged. The policy trusts the dedicated column.
    const lagging: EmailHealthInput = {
      status: "CONNECTED",
      last_refresh_at: hoursAgo(0.2),
      last_refresh_outcome: "SUCCESS",
      last_refresh_success_at: hoursAgo(30),
      refresh_failure_count: 0,
      token_expires_at: null,
    };
    expect(emailConnectionHealth(lagging, NOW)).toBe("POR_VENCER");
  });
});
