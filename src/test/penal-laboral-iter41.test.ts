import "@/test/helpers/localstorage-polyfill";
/**
 * iteration 41 — UNSPECIFIED day type and antinomia modelling.
 *
 * Two invariants: a rule whose day type the statute does not fix computes no
 * date and cannot be ratified; a conflicting-norm group resolves to the SHORTER
 * term as operative while keeping both norms visible.
 */
import { describe, expect, it } from "vitest";
import { computePenalTerms, ruleComputesDate } from "@/lib/penal906/penal906-terms";
import { buildRuleTermSuggestions } from "@/lib/workflow-terms/rule-term-suggestions";
import { canRatifyRule, type WorkflowDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

function rule(over: Partial<WorkflowDeadlineRule>): WorkflowDeadlineRule {
  return {
    id: "r1",
    organization_id: null,
    workflow_type: "PENAL_906",
    regimen: null,
    track_kind: null,
    deadline_type: "X",
    label: "X",
    citation: "art. 1",
    anchor_type: "ANCHOR_ACTO",
    anchor_event: "EJECUTORIA_SENTENCIA",
    days_amount: 5,
    day_type: "BUSINESS",
    description: null,
    verification_state: "VERIFICADA_FUENTE_PRIMARIA",
    research_notes: null,
    sources: [],
    requires_manual_review: false,
    status: "RATIFIED",
    ratified_at: "2026-01-01T00:00:00Z",
    ratified_by: "u",
    ...over,
  } as WorkflowDeadlineRule;
}

const anchor = {
  type: "ANCHOR_ACTO" as const,
  event: "EJECUTORIA_SENTENCIA",
  date: "2026-08-03",
};

describe("UNSPECIFIED day type", () => {
  it("never computes a date", () => {
    const r = rule({ day_type: "UNSPECIFIED" });
    expect(ruleComputesDate(r)).toBe(false);
    expect(computePenalTerms([r], [anchor])).toHaveLength(0);
  });

  it("cannot be ratified", () => {
    expect(canRatifyRule(rule({ day_type: "UNSPECIFIED", status: "DRAFT" })).ok).toBe(false);
    expect(canRatifyRule(rule({ day_type: "BUSINESS", status: "DRAFT" })).ok).toBe(true);
  });

  it("is still surfaced so the gap is visible", () => {
    const r = rule({ day_type: "UNSPECIFIED", status: "DRAFT", ratified_at: null, ratified_by: null });
    const out = buildRuleTermSuggestions([r], []);
    expect(out.suggested).toHaveLength(0);
    expect(out.unspecified).toHaveLength(1);
    expect(out.unspecified[0].note).toMatch(/no especificado/i);
  });

  it("a computable rule still computes", () => {
    expect(computePenalTerms([rule({})], [anchor])[0].deadlineDate).toBeTruthy();
  });
});

describe("antinomia groups", () => {
  const long = rule({ id: "a", anchor_type: "ANCHOR_EJECUTORIA", days_amount: 15, citation: "art. 93", antinomia_group: "G" });
  const short = rule({ id: "b", anchor_type: "ANCHOR_EJECUTORIA", days_amount: 10, citation: "art. 94", antinomia_group: "G" });

  it("keeps the shorter term as the operative suggestion", () => {
    const out = buildRuleTermSuggestions([long, short], [
      { at: "2026-08-03T00:00:00Z", text: "Ejecutoria de la providencia", source: "ACTUACION" },
    ]);
    expect(out.suggested.map((s) => s.ruleId)).toEqual(["b"]);
    expect(out.antinomias).toHaveLength(1);
    expect(out.antinomias[0].operativeRuleId).toBe("b");
    expect(out.antinomias[0].members).toHaveLength(2);
    expect(out.antinomias[0].members.map((m) => m.citation)).toEqual(["art. 93", "art. 94"]);
  });

  it("honours an explicit designation and records it", () => {
    const designated = { ...long, antinomia_designated_rule_id: "a", antinomia_designated_at: "2026-08-06T00:00:00Z", antinomia_designated_by: "owner" };
    const out = buildRuleTermSuggestions([designated as WorkflowDeadlineRule, short], [
      { at: "2026-08-03T00:00:00Z", text: "Ejecutoria de la providencia", source: "ACTUACION" },
    ]);
    expect(out.antinomias[0].operativeRuleId).toBe("a");
    expect(out.antinomias[0].designatedBy).toBe("owner");
    expect(out.suggested.map((s) => s.ruleId)).toEqual(["a"]);
  });

  it("never resolves silently — both norms remain visible", () => {
    const out = buildRuleTermSuggestions([long, short], []);
    expect(out.antinomias[0].members.every((m) => !!m.citation)).toBe(true);
  });
});
