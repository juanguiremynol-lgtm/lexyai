import { describe, expect, it } from "vitest";
import {
  emailConnectionHealth,
  isExternalRevocation,
  lastSuccessfulRenewal,
} from "@/lib/email-connection-health";

const NOW = Date.parse("2026-09-19T16:00:00Z");

describe("email connection health — one policy for screen, MCP, digest and SQL", () => {
  it("does not degrade on a merely expired access token when renewal is fresh", () => {
    expect(
      emailConnectionHealth(
        {
          status: "CONNECTED",
          token_expires_at: "2026-09-19T15:59:00Z",
          last_refresh_success_at: "2026-09-19T15:00:00Z",
          last_refresh_outcome: "SUCCESS",
          refresh_failure_count: 0,
        },
        NOW,
      ),
    ).toBe("ACTIVA");
  });

  it("degrades after 24 h without a SUCCESSFUL renewal (the MCP used to say ACTIVA)", () => {
    expect(
      emailConnectionHealth(
        {
          status: "CONNECTED",
          token_expires_at: "2026-09-17T16:00:00Z",
          last_refresh_success_at: "2026-09-17T15:00:00Z",
          last_refresh_outcome: "SUCCESS",
          refresh_failure_count: 0,
        },
        NOW,
      ),
    ).toBe("POR_VENCER");
  });

  it("does not let a later failed ATTEMPT hide the last success", () => {
    const row = {
      status: "CONNECTED",
      last_refresh_at: "2026-09-19T15:30:00Z",
      last_refresh_success_at: "2026-09-19T15:00:00Z",
      last_refresh_outcome: "FAILED" as const,
    };
    expect(lastSuccessfulRenewal(row, NOW)).toBe(Date.parse("2026-09-19T15:00:00Z"));
  });

  it("separates a user disconnect from a Microsoft-side revocation", () => {
    expect(isExternalRevocation({ revoked_at: "2026-09-18T10:00:00Z", failure_code: null })).toBe(false);
    expect(isExternalRevocation({ revoked_at: "2026-09-18T10:00:00Z", failure_code: "INVALID_GRANT" })).toBe(true);
  });
});

/** Mirrors the row-level classification in get-actuaciones-hoy. */
function classify(row: { detected_at: string | null; act_date: string | null }, from: string, end: string) {
  const startMs = Date.parse(`${from}T00:00:00-05:00`);
  const endMs = Date.parse(`${end}T23:59:59.999-05:00`);
  const detMs = row.detected_at ? Date.parse(row.detected_at) : NaN;
  const detectada = Number.isFinite(detMs) && detMs >= startMs && detMs <= endMs;
  const act = row.act_date;
  const fechada = act !== null && act >= from && act <= end;
  return { detectada, fechada, tardia: detectada && act !== null && act < from };
}

describe("actuaciones classification is a property of the row, not of the query", () => {
  it("an act dated and detected the same day is never late", () => {
    expect(classify({ detected_at: "2026-09-18T08:02:07Z", act_date: "2026-09-18" }, "2026-09-18", "2026-09-18"))
      .toEqual({ detectada: true, fechada: true, tardia: false });
  });

  it("a future act date is not late", () => {
    expect(classify({ detected_at: "2026-09-18T08:00:00Z", act_date: "2026-09-21" }, "2026-09-18", "2026-09-18").tardia)
      .toBe(false);
  });

  it("a missing act date is not late", () => {
    expect(classify({ detected_at: "2026-09-18T08:00:00Z", act_date: null }, "2026-09-18", "2026-09-18").tardia)
      .toBe(false);
  });

  it("an older act date detected inside the window IS late", () => {
    expect(classify({ detected_at: "2026-09-18T08:00:00Z", act_date: "2026-09-01" }, "2026-09-18", "2026-09-18").tardia)
      .toBe(true);
  });
});
