/**
 * iter32-addendum.test.ts — routing lockstep for the three new workflows and
 * the oral, in-hearing anchor (CPTSS art. 66) that has no written term.
 */
import { describe, it, expect } from "vitest";
import { PROVIDER_CHAIN_BY_WORKFLOW, providerChainFor } from "@/lib/monitoring-matrix";
import {
  CHAIN,
  PROVIDER_ROW_KINDS,
  PROVIDER_LOCAL_SOURCES,
  providerMatrixGaps,
} from "../../supabase/functions/_shared/bridgeProviderMatrix";
import { computePenalTerms } from "@/lib/penal906/penal906-terms";
import type { WorkflowDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

const rule = (patch: Partial<WorkflowDeadlineRule>): WorkflowDeadlineRule => ({
  id: "r1",
  organization_id: null,
  workflow_type: "LABORAL",
  regimen: "LABORAL_CPTSS_1948",
  track_kind: null,
  deadline_type: "APELACION_SENTENCIA",
  label: "Apelación contra sentencia",
  citation: "CPTSS art. 66",
  anchor_type: "ANCHOR_ORAL_EN_AUDIENCIA",
  anchor_event: "SENTENCIA_EN_AUDIENCIA",
  days_amount: 0,
  day_type: "NONE",
  description: null,
  research_notes: null,
  sources: null,
  requires_manual_review: true,
  status: "RATIFIED",
  ratified_at: "2026-08-05T00:00:00Z",
  ratified_by: null,
  ...patch,
});

describe("iter32 addendum · routing matrix", () => {
  it("EJECUTIVO, LABORAL and PENAL_906 route exactly like CGP", () => {
    for (const wt of ["EJECUTIVO", "LABORAL", "PENAL_906"]) {
      expect(providerChainFor(wt)).toEqual(["cpnu", "publicaciones"]);
      expect(CHAIN[wt]).toEqual(["cpnu", "publicaciones"]);
    }
  });

  it("CPACA stays SAMAI-exclusive and TUTELA keeps the union", () => {
    expect(providerChainFor("CPACA")).toEqual(["samai", "samai_estados"]);
    expect(CHAIN.TUTELA).toEqual(["cpnu", "samai", "publicaciones", "samai_estados"]);
  });

  it("frontend mirror and bridge matrix agree on every workflow", () => {
    for (const [wt, chain] of Object.entries(PROVIDER_CHAIN_BY_WORKFLOW)) {
      expect(CHAIN[wt], `chain drift for ${wt}`).toEqual(chain);
    }
  });

  it("every chained provider has row kinds and local sources", () => {
    expect(providerMatrixGaps()).toEqual([]);
    expect(PROVIDER_ROW_KINDS.cpnu).toEqual(["ACT"]);
    expect(PROVIDER_LOCAL_SOURCES.publicaciones).toContain("pp");
  });
});

describe("iter32 addendum · oral in-hearing anchor", () => {
  const anchor = {
    type: "ANCHOR_ORAL_EN_AUDIENCIA" as const,
    event: "SENTENCIA_EN_AUDIENCIA",
    date: "2026-09-21",
  };

  it("produces no date — the term is discharged in the hearing", () => {
    const [term] = computePenalTerms([rule({})], [anchor]);
    expect(term.oralInHearing).toBe(true);
    expect(term.deadlineDate).toBeNull();
  });

  it("still computes written terms normally", () => {
    const [term] = computePenalTerms(
      [rule({ anchor_type: "ANCHOR_AUDIENCIA", day_type: "BUSINESS", days_amount: 5 })],
      [{ ...anchor, type: "ANCHOR_AUDIENCIA" }],
    );
    expect(term.oralInHearing).toBe(false);
    expect(term.deadlineDate).toBe("2026-09-28");
  });

  it("draft oral rules compute nothing", () => {
    expect(computePenalTerms([rule({ status: "DRAFT", ratified_at: null })], [anchor])).toEqual([]);
  });
});
