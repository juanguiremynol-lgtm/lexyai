import { describe, expect, it } from "vitest";
import { selectEligibleWorkItems } from "../../supabase/functions/_shared/sync-eligibility.ts";
import { SYNC_ENABLED_WORKFLOWS } from "../../supabase/functions/_shared/syncPolicy.ts";
import { ONLINE_SYNC_ELIGIBLE_WORKFLOWS } from "../../supabase/functions/_shared/onlineSyncEligibility.ts";
import { resolveProviders } from "../../supabase/functions/_shared/providerRouting.ts";

type Row = Record<string, unknown>;

// Behaves like the small subset of PostgREST used by the production selector;
// no database or provider is contacted.
function database(rows: Row[]) {
  return {
    from(table: string) {
      if (table !== "work_items") throw new Error(`unexpected table ${table}`);
      let selected = rows.slice();
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => { selected = selected.filter((r) => r[key] === value); return q; },
        is: (key: string, value: unknown) => { selected = selected.filter((r) => r[key] === value); return q; },
        in: (key: string, values: readonly unknown[]) => { selected = selected.filter((r) => values.includes(r[key])); return q; },
        or: () => q,
        not: (key: string, op: string, value: unknown) => {
          if (op === "is" && value === null) selected = selected.filter((r) => r[key] !== null);
          return q;
        },
        order: () => q,
        then: (resolve: (value: unknown) => unknown) => resolve({ data: selected, error: null }),
      };
      return q;
    },
  };
}

const base = { organization_id: "org", monitoring_enabled: true, deleted_at: null,
  lifecycle_state: "ACTIVE", stage: null, radicado: "05001310302120250021100" };

describe("executive cases in daily source eligibility", () => {
  it("selects a monitored EJECUTIVO alongside CGP but not internal requests", async () => {
    const rows = [
      { ...base, id: "1", workflow_type: "EJECUTIVO" },
      { ...base, id: "2", workflow_type: "CGP" },
      { ...base, id: "3", workflow_type: "PETICION" },
      { ...base, id: "4", workflow_type: "EJECUTIVO", monitoring_enabled: false },
      { ...base, id: "5", workflow_type: "EJECUTIVO", radicado: "1234" },
      { ...base, id: "6", workflow_type: "EJECUTIVO", organization_id: "another" },
    ];
    const result = await selectEligibleWorkItems(database(rows), "org");
    expect(result.map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("keeps the daily list aligned with canonical eligibility and routing", () => {
    expect(SYNC_ENABLED_WORKFLOWS).toEqual(ONLINE_SYNC_ELIGIBLE_WORKFLOWS);
    expect(SYNC_ENABLED_WORKFLOWS).toContain("EJECUTIVO");
    expect(SYNC_ENABLED_WORKFLOWS).not.toContain("PETICION");
    expect(resolveProviders("EJECUTIVO")).toMatchObject({
      eligible: true, actuaciones: ["CPNU"], estados: ["PP"],
    });
  });
});
