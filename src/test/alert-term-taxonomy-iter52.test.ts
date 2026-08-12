import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  classifyTermUrgency,
  isTermAlertType,
  TERM_ALERT_TYPES,
} from "@/lib/alerts/term-urgency";
import { DOCTRINE_ALERT_TYPES } from "@/lib/alerts/doctrine";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("iteration 52 — term alert taxonomy", () => {
  it("maps remaining business days onto the three canonical types", () => {
    expect(classifyTermUrgency(-1)).toEqual({
      alert_type: "TERMINO_VENCIDO",
      severity: "CRITICAL",
    });
    expect(classifyTermUrgency(0).alert_type).toBe("TERMINO_CRITICO");
    expect(classifyTermUrgency(3).alert_type).toBe("TERMINO_CRITICO");
    expect(classifyTermUrgency(4).alert_type).toBe("TERMINO_POR_VENCER");
    expect(classifyTermUrgency(8)).toEqual({
      alert_type: "TERMINO_POR_VENCER",
      severity: "WARNING",
    });
  });

  it("never asserts a miss when the term length is unresolved", () => {
    expect(classifyTermUrgency(null)).toEqual({
      alert_type: "TERMINO_POR_VENCER",
      severity: "WARNING",
    });
  });

  it("keeps the three types inside the doctrine catalogue", () => {
    for (const t of TERM_ALERT_TYPES) {
      expect(DOCTRINE_ALERT_TYPES as readonly string[]).toContain(t);
    }
    expect(isTermAlertType("TERMINO_DEADLINE")).toBe(false);
  });

  it("no alert path emits a term type outside the three", () => {
    const files = [...walk("src"), ...walk("supabase/functions")].filter(
      (f) => !f.endsWith("alert-term-taxonomy-iter52.test.ts"),
    );
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/["'`](TERMINO_[A-Z_]+)["'`]/g)) {
        if (!isTermAlertType(m[1])) offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});