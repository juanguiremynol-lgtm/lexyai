import { describe, expect, it } from "vitest";
import {
  deriveAlDespachoSuspensions,
  filterRulesToRegimen,
  resolveLaboralRegimenForMatter,
  resolveTicAnchor,
} from "@/lib/laboral/laboral-terms";
import { computePenalTerms } from "@/lib/penal906/penal906-terms";
import type { WorkflowDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

const rule = (over: Partial<WorkflowDeadlineRule> = {}): WorkflowDeadlineRule =>
  ({
    id: "r1",
    organization_id: null,
    workflow_type: "LABORAL",
    regimen: "LABORAL_2452",
    track_kind: null,
    deadline_type: "LAB25_CASACION_SUSTENTACION",
    label: "Sustentación",
    citation: "Ley 2452 de 2025, art. 243",
    anchor_type: "ANCHOR_ACTO",
    anchor_event: "CONCESION_RECURSO_CASACION",
    days_amount: 20,
    day_type: "BUSINESS",
    description: null,
    research_notes: null,
    sources: null,
    requires_manual_review: false,
    status: "RATIFIED",
    ratified_at: "2026-08-06T00:00:00Z",
    ratified_by: null,
    ...over,
  }) as WorkflowDeadlineRule;

describe("iter40 — Laboral regime (A)", () => {
  it("keys only on the filing date", () => {
    expect(resolveLaboralRegimenForMatter("2026-04-02").regimen).toBe("LABORAL_2452");
    expect(resolveLaboralRegimenForMatter("2026-04-01").regimen).toBe("LABORAL_CPTSS_1948");
  });

  it("a matter filed 2026-03-31 stays under CPTSS 1948 even for a 2027 casación", () => {
    const res = resolveLaboralRegimenForMatter("2026-03-31");
    expect(res.regimen).toBe("LABORAL_CPTSS_1948");
    // No 2452 rule may reach a 1948 matter, whatever the stage or instance.
    const scoped = filterRulesToRegimen(
      [rule(), rule({ id: "r2", regimen: "LABORAL_CPTSS_1948" })],
      res.regimen,
    );
    expect(scoped.map((r) => r.id)).toEqual(["r2"]);
  });

  it("computes nothing when the filing date is unknown", () => {
    const res = resolveLaboralRegimenForMatter(null);
    expect(res.regimen).toBeNull();
    expect(res.computes).toBe(false);
    expect(res.basis).toMatch(/no determinable/i);
    expect(filterRulesToRegimen([rule()], res.regimen)).toEqual([]);
  });
});

describe("iter40 — art. 324 computation (B)", () => {
  it("terms in months land on the same day and extend to the next business day", () => {
    const terms = computePenalTerms(
      [rule({ day_type: "MONTHS", days_amount: 1 })],
      [{ type: "ANCHOR_ACTO", event: "CONCESION_RECURSO_CASACION", date: "2026-05-02" }],
    );
    // 2 June 2026 is a Tuesday (business day).
    expect(terms[0].deadlineDate).toBe("2026-06-02");
  });

  it("suspends while the file is al despacho", () => {
    const anchors = [
      { type: "ANCHOR_ACTO" as const, event: "CONCESION_RECURSO_CASACION", date: "2026-05-04" },
    ];
    const plain = computePenalTerms([rule({ days_amount: 5 })], anchors);
    const suspended = computePenalTerms([rule({ days_amount: 5 })], anchors, [
      { from: "2026-05-05", until: "2026-05-08", reason: "al despacho" },
    ]);
    expect(suspended[0].suspendedDays).toBe(3);
    expect(suspended[0].deadlineDate! > plain[0].deadlineDate!).toBe(true);
  });

  it("refuses to compute while the file is still al despacho", () => {
    const terms = computePenalTerms(
      [rule({ days_amount: 5 })],
      [{ type: "ANCHOR_ACTO", event: "CONCESION_RECURSO_CASACION", date: "2026-05-04" }],
      [{ from: "2026-05-06", until: null, reason: "al despacho" }],
    );
    expect(terms[0].deadlineDate).toBeNull();
    expect(terms[0].suspendedOpenEnded).toBe(true);
  });

  it("derives al despacho windows from the acts", () => {
    const windows = deriveAlDespachoSuspensions([
      { at: "2026-05-05", text: "Pasa al despacho" },
      { at: "2026-05-08", text: "Vuelve a secretaría" },
      { at: "2026-05-20", text: "Ingresa al despacho" },
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[0].until).toBe("2026-05-08");
    expect(windows[1].until).toBeNull();
  });
});

describe("iter40 — TIC anchor (C)", () => {
  it("uses acknowledgement when known", () => {
    const a = resolveTicAnchor({ sentAt: "2026-05-04", acknowledgedAt: "2026-05-05" });
    expect(a.restsOn).toBe("ACUSE_VERIFICABLE");
    expect(a.date).toBe("2026-05-06");
  });

  it("falls back to the 2-business-day deeming rule", () => {
    const a = resolveTicAnchor({ sentAt: "2026-05-04" });
    expect(a.restsOn).toBe("PRESUNCION_2_DIAS");
    expect(a.date).toBe("2026-05-07");
    expect(a.basis).toMatch(/2 días hábiles/);
  });
});
