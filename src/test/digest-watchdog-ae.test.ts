/**
 * AE1(b)(c) — prove digest-failure-watchdog fires on each of its three
 * conditions, WITHOUT touching the database and WITHOUT sending any email.
 * The pure logic is exercised with constructed fixtures; the rendered HTML is
 * asserted so the operator can read exactly what the alert would say.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  classifyDigestDay,
  renderWatchdogHtml,
  renderWatchdogSubject,
  STUCK_MINUTES,
} from "../../supabase/functions/digest-failure-watchdog/logic.ts";

const NOW = new Date("2026-08-28T15:00:00Z");
const DAY = "2026-08-28";
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

describe("AE1(b) — the three alert conditions", () => {
  it("FAILED: a run that recorded a failure is reported with its error", () => {
    const v = classifyDigestDay([U1], [{
      recipient_user_id: U1,
      recipient_email: "abogado@example.com",
      status: "FAILED",
      error_summary: "outbox: relation email_outbox denied",
      created_at: "2026-08-28T12:05:00Z",
    }], NOW);
    expect(v).toMatchObject({ problems: 1, missing: [], stuck: [] });
    expect(v.failed[0]).toContain("abogado@example.com");
    const html = renderWatchdogHtml(DAY, 1, v);
    expect(html).toContain("FALLIDOS (1)");
    expect(html).toContain("outbox: relation email_outbox denied");
    expect(renderWatchdogSubject(DAY, v)).toContain("1 fallidos");
  });

  it("MISSING (AE1c): a monitored recipient with NO run row at all", () => {
    // The crash-before-claim path: nothing exists to self-report.
    const v = classifyDigestDay([U1, U2], [{
      recipient_user_id: U1,
      recipient_email: "uno@example.com",
      status: "SENT",
      created_at: "2026-08-28T12:05:00Z",
    }], NOW);
    expect(v.missing).toEqual([U2]);
    expect(v.failed).toEqual([]);
    expect(v.problems).toBe(1);
    const html = renderWatchdogHtml(DAY, 2, v);
    expect(html).toContain("SIN CORRIDA (1)");
    expect(html).toContain(U2);
    expect(html).toContain("ninguna fila en daily_digest_runs");
    expect(renderWatchdogSubject(DAY, v)).toContain("1 sin corrida");
  });

  it("STUCK: a RUNNING row older than the lease window", () => {
    const stale = new Date(NOW.getTime() - (STUCK_MINUTES + 5) * 60_000).toISOString();
    const fresh = new Date(NOW.getTime() - 2 * 60_000).toISOString();
    expect(classifyDigestDay([U1], [{
      recipient_user_id: U1, recipient_email: "lento@example.com",
      status: "RUNNING", created_at: stale,
    }], NOW).stuck).toEqual(["lento@example.com"]);
    // A RUNNING row inside the window is NOT an alert.
    expect(classifyDigestDay([U1], [{
      recipient_user_id: U1, status: "RUNNING", created_at: fresh,
    }], NOW).problems).toBe(0);
  });

  it("healthy day and opted-out day produce no alert", () => {
    expect(classifyDigestDay([U1], [{
      recipient_user_id: U1, status: "SENT", created_at: "2026-08-28T12:05:00Z",
    }], NOW).problems).toBe(0);
    expect(classifyDigestDay([U1], [{
      recipient_user_id: U1, status: "EMPTY_NO_EMAIL", created_at: "2026-08-28T12:05:00Z",
    }], NOW).problems).toBe(0);
    expect(classifyDigestDay([U1], [{
      recipient_user_id: U1, status: "SKIPPED_OPTED_OUT", created_at: "2026-08-28T12:05:00Z",
    }], NOW).problems).toBe(0);
  });

  it("all three at once render in one email", () => {
    const stale = new Date(NOW.getTime() - 90 * 60_000).toISOString();
    const v = classifyDigestDay([U1, U2, "33333333-3333-3333-3333-333333333333"], [
      { recipient_user_id: U1, recipient_email: "a@x.com", status: "FAILED", error_summary: "boom", created_at: stale },
      { recipient_user_id: U2, recipient_email: "b@x.com", status: "RUNNING", created_at: stale },
    ], NOW);
    const html = renderWatchdogHtml(DAY, 3, v);
    expect(v.problems).toBe(3);
    for (const marker of ["FALLIDOS (1)", "ATASCADOS (1)", "SIN CORRIDA (1)"]) {
      expect(html).toContain(marker);
    }
  });
});

describe("AE1 — the edge function stays wired to this logic", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "supabase/functions/digest-failure-watchdog/index.ts"),
    "utf8",
  );
  it("imports the shared classifier and renderer instead of duplicating them", () => {
    expect(src).toContain('from "./logic.ts"');
    expect(src).toContain("classifyDigestDay");
    expect(src).toContain("renderWatchdogHtml");
  });
  it("honours dry_run so a test invocation never enqueues an alert", () => {
    expect(src).toContain("dryRun");
    expect(src).toMatch(/problems === 0 \|\| dryRun/);
  });
});

/**
 * AF1(b) — the outbox backlog condition: mail enqueued and due, never drained.
 * Invisible to GCP's Resend watcher (never reached the provider) and to the
 * digest itself (it returns once the row is written).
 */
describe("AF1(b) — outbox backlog", () => {
  it("flags PENDING rows past their due time and renders them", async () => {
    const { classifyOutboxBacklog, renderOutboxBacklogBlock, OUTBOX_BACKLOG_MINUTES } = await import(
      "../../supabase/functions/digest-failure-watchdog/logic.ts"
    );
    const stale = new Date(NOW.getTime() - (OUTBOX_BACKLOG_MINUTES + 60) * 60_000).toISOString();
    const fresh = new Date(NOW.getTime() - 60_000).toISOString();
    const b = classifyOutboxBacklog([
      { to_email: "gr@lexetlit.com", subject: "Resumen diario", status: "PENDING", next_attempt_at: stale },
      { to_email: "otro@x.com", subject: "Otro", status: "PENDING", next_attempt_at: fresh },
      { to_email: "ya@x.com", subject: "Enviado", status: "SENT", next_attempt_at: stale },
    ], NOW);
    expect(b.stalled).toBe(1);
    expect(b.oldestMinutes).toBeGreaterThanOrEqual(OUTBOX_BACKLOG_MINUTES);
    expect(renderOutboxBacklogBlock(b)).toContain("CORREO SIN SALIR (1)");
    expect(renderOutboxBacklogBlock({ stalled: 0, oldestMinutes: 0, samples: [] })).toBe("");
  });
});
