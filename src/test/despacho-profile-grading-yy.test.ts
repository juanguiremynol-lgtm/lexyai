/**
 * YY1 / YY2 / YY3 / YY4 — the learned despacho profiles become load-bearing.
 *
 * These tests pin the CONTRACT of the wiring, not the current numbers: the
 * profiles must only ever explain an absence, never manufacture one, and the
 * effect must always be visible to the reader.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const monitor = read("supabase/functions/_shared/estadosMonitor.ts");
const digestIndex = read("supabase/functions/scheduled-daily-digest/index.ts");
const digestHtml = read("supabase/functions/scheduled-daily-digest/html.ts");
const digestTypes = read("supabase/functions/scheduled-daily-digest/types.ts");

describe("YY1 — profiles wired into grading", () => {
  it("exposes the delta the profiles caused on every source row", () => {
    expect(digestTypes).toMatch(/expected_before_profile\?: number/);
    expect(digestTypes).toMatch(/excluded_by_profile\?: number/);
    expect(digestIndex).toMatch(/expected_before_profile: Number\(row\.expected_before_profile/);
  });

  it("prints the exclusion in the mail instead of shrinking the portfolio silently", () => {
    expect(digestHtml).toMatch(/function profileNote/);
    expect(digestHtml).toMatch(/excluidos del denominador/);
    expect(digestHtml).toMatch(/\$\{profileNote\(rows\)\}/);
  });
});

describe("YY2 — the observed-behaviour sentence", () => {
  it("is carried on the work item and rendered as an observation", () => {
    expect(digestTypes).toMatch(/courtBehavior\?: string \| null/);
    expect(digestIndex).toMatch(/despacho_behavior_statement/);
    expect(digestHtml).toMatch(/Comportamiento observado del despacho/);
  });

  it("renders nothing when the database returns no statement", () => {
    // The sentence is opt-in on a non-null value; there is no fallback text.
    expect(digestHtml).toMatch(/wi\?\.courtBehavior\s*\n?\s*\?/);
    expect(digestHtml).toMatch(/:\s*"";/);
  });
});

describe("YY3 — one-time reconciliation", () => {
  it("is content on its own and is never counted as novedad", () => {
    expect(digestIndex).toMatch(/digest_reconciliation_notices/);
    expect(digestIndex).toMatch(/reconciliations\.length > 0/);
    // The novedad counter is built from actuaciones + estados only.
    expect(digestIndex).toMatch(/const novedades = actuaciones\.length \+ estados\.length;/);
  });

  it("is consumed only by a real send, never by a preview", () => {
    const markIdx = digestIndex.indexOf("delivered_at: new Date().toISOString()");
    const outboxIdx = digestIndex.indexOf('from("email_outbox")');
    expect(markIdx).toBeGreaterThan(outboxIdx);
  });
});

describe("YY4 — the label describes the last read", () => {
  it("stamps the attempt clock on every attempt", () => {
    expect(monitor).toMatch(/last_sync_attempt_at: stampedAt/);
  });

  it("maps an answered read to SUCCESS and a pending one to IN_PROGRESS", () => {
    expect(monitor).toMatch(/label === "pending"\s*\n?\s*\? "IN_PROGRESS"/);
    expect(monitor).toMatch(/label === "error"\s*\n?\s*\? "FAILED"/);
    expect(monitor).toMatch(/: "SUCCESS"/);
  });

  it("never lets a routing skip rewrite the read verdict", () => {
    expect(monitor).toMatch(/if \(label !== "no_aplica"\) \{/);
  });
});
