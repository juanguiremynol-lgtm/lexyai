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

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(readFileSync(p, "utf8"));
      }
    }
  };
  walk("supabase/functions");
  walk("src");
  return out;
}

describe("LT3 outcome declaration audit", () => {
  const scan = scanOutcomeLiterals(sources());

  it("declares every outcome the code branches on", () => {
    const missing = undeclaredOutcomes(scan.deciding, [...DECLARED_OUTCOMES]);
    expect(missing, `Undeclared deciding outcomes: ${missing.join(", ")}`).toEqual([]);
  });

  it("declares nothing that the code no longer decides on", () => {
    const stale = [...DECLARED_OUTCOMES].filter((v) => !scan.deciding.includes(v));
    expect(stale, `Declared but never decided: ${stale.join(", ")}`).toEqual([]);
  });

  it("is case-sensitive — a lowercase declaration does not cover an uppercase value", () => {
    expect(undeclaredOutcomes(["PENDING_UPSTREAM"], ["pending_upstream"])).toEqual([
      "PENDING_UPSTREAM",
    ]);
  });
});
