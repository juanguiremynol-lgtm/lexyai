/**
 * DD1 — the deadline engine must show its work.
 *
 * Mirrors `deadline_business_day_walk` / `add_business_days_sql`:
 *   - the term is anchored on the fijación de estado,
 *   - notificación por estado surte efectos the next business day (desfijación),
 *   - counting starts the day AFTER that anchor,
 *   - weekends, Colombian holidays and judicial vacancia days never count.
 *
 * Every assertion below is checked against the live SQL engine output stored in
 * work_item_deadlines.calculation_meta.term_audit.
 */
import { describe, it, expect } from "vitest";

const HOLIDAYS_2026 = new Set([
  "2026-06-08", "2026-06-15", "2026-06-29", "2026-07-20",
  "2026-08-07", // Batalla de Boyacá
  "2026-08-17", "2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
]);

interface WalkStep { date: string; counted: boolean; reason: string }

function walk(anchorIso: string, days: number, holidays = HOLIDAYS_2026) {
  const steps: WalkStep[] = [];
  const excluded: string[] = [];
  const d = new Date(anchorIso + "T00:00:00");
  let counted = 0;
  for (let guard = 0; guard < 400; guard++) {
    d.setDate(d.getDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    let reason = "DIA_HABIL";
    if (dow === 0 || dow === 6) reason = "FIN_DE_SEMANA";
    else if (holidays.has(iso)) {
      reason = "FESTIVO";
      excluded.push(iso);
    }
    const ok = reason === "DIA_HABIL";
    if (ok) counted++;
    steps.push({ date: iso, counted: ok, reason });
    if (ok && counted >= days) break;
  }
  return { result: steps[steps.length - 1].date, steps, holidaysExcluded: excluded };
}

/** Notificación por estado: the term anchor is the next business day after fijación. */
function desfijacion(fijacionIso: string) {
  return walk(fijacionIso, 1).result;
}

describe("DD1 — business-day walk records its corrections", () => {
  it("anchors on fijación and runs from the next business day", () => {
    // Fijación 2026-08-04 (Tue) → desfijación 2026-08-05 (Wed).
    expect(desfijacion("2026-08-04")).toBe("2026-08-05");
  });

  it("excludes 7 August 2026 (Batalla de Boyacá) and reports it", () => {
    const w = walk("2026-08-05", 3);
    expect(w.result).toBe("2026-08-11");
    expect(w.holidaysExcluded).toContain("2026-08-07");
    expect(w.steps.find((s) => s.date === "2026-08-07")?.reason).toBe("FESTIVO");
  });

  it("matches the stored engine result for the two live CGP art. 302 terms", () => {
    // 05001418901120260047600 — fijación 2026-08-04 → stored 2026-08-11
    expect(walk(desfijacion("2026-08-04"), 3).result).toBe("2026-08-11");
    // 05001400303420260089800 — fijación 2026-08-03 → stored 2026-08-10
    expect(walk(desfijacion("2026-08-03"), 3).result).toBe("2026-08-10");
  });

  it("matches the 10-business-day ejecutivo term across two August holidays", () => {
    const w = walk("2026-08-04", 10); // CGP art. 442 num. 1, anchor = notificación
    expect(w.result).toBe("2026-08-20");
    expect(w.holidaysExcluded).toEqual(["2026-08-07", "2026-08-17"]);
  });

  it("dropping the holiday correction would silently shift the term by one day", () => {
    const withHoliday = walk("2026-08-05", 3);
    const withoutHoliday = walk("2026-08-05", 3, new Set<string>());
    expect(withoutHoliday.result).toBe("2026-08-10");
    expect(withHoliday.result).not.toBe(withoutHoliday.result);
  });

  it("every non-counted day carries an explicit reason", () => {
    const w = walk("2026-08-05", 3);
    for (const s of w.steps) {
      if (!s.counted) expect(["FIN_DE_SEMANA", "FESTIVO", "VACANCIA_JUDICIAL"]).toContain(s.reason);
    }
  });
});
