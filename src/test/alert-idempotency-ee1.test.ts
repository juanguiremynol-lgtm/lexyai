/**
 * EE1 — one live alert per deadline, kept current.
 *
 * The evaluator must not embed the evaluation day or the urgency bucket in the
 * deduplication key: that is exactly what produced 40 TERMINO_VENCIDO rows for
 * three deadlines across ten mornings.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("supabase/functions/evaluate-deadline-alerts/index.ts", "utf8");

describe("EE1 alert idempotency", () => {
  it("uses a day-independent, bucket-independent dedupe key", () => {
    expect(SRC).toContain("`deadline_TERM_${args.deadlineId}`");
    expect(SRC).not.toContain("`deadline_${bucket}_${d.id}_${today}`");
  });

  it("updates the live alert instead of inserting a second one", () => {
    expect(SRC).toContain("escalation_history");
    expect(SRC).toMatch(/\.update\(\{[\s\S]*alert_type: args\.alertType/);
  });

  it("collapses duplicates as SUPERSEDED, never RESOLVED or DISMISSED", () => {
    expect(SRC).toContain('status: "SUPERSEDED"');
    expect(SRC).not.toMatch(/status:\s*"RESOLVED"/);
  });

  it("never resurrects an alert the lawyer already closed", () => {
    expect(SRC).toContain("closed_by_lawyer");
    expect(SRC).toMatch(/\["RESOLVED", "DISMISSED", "CANCELLED"\]/);
  });
});
