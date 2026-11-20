/**
 * LT3 — the instrument. Every outcome literal the code DECIDES on must be
 * declared, with the exact case it is written in. A declaration that reads
 * `pending_upstream` while the code writes `PENDING_UPSTREAM` is coverage,
 * not a declaration, and is worse than none.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanOutcomeLiterals, undeclaredOutcomes } from "@/lib/outcome-literals";
import { DECLARED_OUTCOMES } from "@/lib/declaredOutcomes";

function sources() {
  const out: { fileName: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", "dist", "__tests__", "test"].includes(entry)) continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry) && !/[._]test\.tsx?$/.test(entry)) {
        out.push({ fileName: p, text: readFileSync(p, "utf8") });
      }
    }
  };
  walk("supabase/functions");
  walk("src");
  return out;
}

describe("LT3 outcome declaration audit", () => {
  const scan = scanOutcomeLiterals(sources());

  it("does not register neighbouring fields or conditional selectors as outcomes", () => {
    const result = scanOutcomeLiterals([{ fileName: "example.ts", text:
      'const row = { error_code: kind === "SELECTOR" ? "RIGHT_VALUE" : null, status: "NEIGHBOUR" };\n' +
      'if (x === "RIGHT_VALUE" || x === "NEIGHBOUR" || x === "SELECTOR") decide();' }]);
    expect(result.deciding).toEqual(["RIGHT_VALUE"]);
  });

  it("declares every outcome the code branches on", () => {
    const missing = undeclaredOutcomes(scan.deciding, [...DECLARED_OUTCOMES]);
    expect(missing, `Undeclared deciding outcomes: ${missing.join(", ")}`).toEqual([]);
  });

  it("retains the versioned historical registry and mirrors additive SQL releases", () => {
    const baseline = readFileSync("supabase/migrations/20260912142804_13e859c1-da8c-4f3f-a64d-67990eb91dfd.sql", "utf8");
    const historicalValues = baseline.slice(baseline.indexOf("INSERT INTO public.sync_vocabulary"))
      .match(/'([A-Z][A-Z0-9_]+)'/g)?.map(v => v.slice(1, -1)) ?? [];
    const release = readFileSync("supabase/migrations/20261120194500_register_outcome_vocabulary.sql", "utf8");
    const addedValues = [...release.matchAll(/\('outcome', '([A-Z0-9_]+)',/g)].map(match => match[1]);
    expect([...new Set([...historicalValues, ...addedValues])].sort()).toEqual([...DECLARED_OUTCOMES].sort());
    const stale = [...DECLARED_OUTCOMES].filter((v) => !scan.deciding.includes(v) && !historicalValues.includes(v));
    expect(stale, `Declared but never decided: ${stale.join(", ")}`).toEqual([]);
  });

  it("is case-sensitive — a lowercase declaration does not cover an uppercase value", () => {
    expect(undeclaredOutcomes(["PENDING_UPSTREAM"], ["pending_upstream"])).toEqual([
      "PENDING_UPSTREAM",
    ]);
  });
});
