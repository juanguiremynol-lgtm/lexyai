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
import { digestHasContent, digestSubject } from "../../supabase/functions/scheduled-daily-digest/content.ts";

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
    expect(digestHtml).toMatch(/s\.excluded_by_profile/);
    expect(digestHtml).toMatch(/fuera del alcance de esta fuente/);
  });
});

describe("YY2 — the compact report links out to case details", () => {
  it("does not require a sequential behaviour query before delivery", () => {
    expect(digestIndex).not.toMatch(/despacho_behavior_statement/);
    expect(digestHtml).toMatch(/\/app\/work-items\//);
  });
});

describe("YY3 — one-time reconciliation", () => {
  it("is content on its own and is never counted as novedad", () => {
    expect(digestIndex).toMatch(/digest_reconciliation_notices/);
    expect(digestIndex).toMatch(/rowCount:[^,]+\breconciliations\.length/);
    expect(digestHasContent({ rowCount: 1, manualReviewCount: 0, coverageIncomplete: false })).toBe(true);
    expect(digestIndex).toMatch(/digestSubject\(\{\s*critical, estados: estados\.length, actuaciones: actuaciones\.length/);
    expect(digestSubject({ critical: false, estados: 1, actuaciones: 2, coverageIncomplete: false })).toContain('3 novedades');
  });

  it("is consumed only by a real send, never by a preview", () => {
    const markIdx = digestIndex.indexOf("delivered_at: new Date().toISOString()");
    const outboxIdx = digestIndex.indexOf('from("email_outbox")');
    expect(markIdx).toBeGreaterThan(outboxIdx);
  });
});

describe("YY4 — the estados monitor reports on its own channel only", () => {
  it("stamps the attempt clock on every attempt", () => {
    expect(monitor).toMatch(/last_sync_attempt_at: stampedAt/);
  });

  it("never writes the source-agnostic scrape verdict", () => {
    // `scrape_status` / `last_scrape_at` belong to the actuaciones sync path.
    // An estados read must not turn a healthy matter red.
    expect(monitor).not.toMatch(/patch\.scrape_status/);
    expect(monitor).not.toMatch(/patch\.last_scrape_at/);
  });

  it("labels the Publicaciones channel and lets a routing skip stand", () => {
    expect(monitor).toMatch(/patch\.pp_estado = label/);
    expect(monitor).toMatch(/if \(success && scoped\.clockEligible && result\.reused_completed_read !== true && result\.source_query_attempted !== false\) patch\.pp_ultima_sync = stampedAt/);
  });
});

