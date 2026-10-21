import { describe, it, expect } from "vitest";
import { splitOccurredAndScheduled } from "@/lib/last-occurred-event";
const now = new Date("2026-10-21T15:00:00Z");
describe("last occurred event", () => {
  it("future portal date (10 Nov) never advances the cursor and is shown as scheduled", () => {
    const r = splitOccurredAndScheduled([
      { occurred_at: "2026-11-10T00:00:00+00:00", kind: "ACTUACION", title: "ENVÍO A OTROS DESPACHOS" },
      { occurred_at: "2026-05-14T00:00:00+00:00", kind: "ACTUACION", title: "Expediente digital" },
    ], now);
    expect(r.last?.day).toBe("2026-05-14");
    expect(r.nextScheduled?.day).toBe("2026-11-10");
  });
  it("an estado newer than the last act wins (J21 estado 137 of 15 Oct over act 13 Oct)", () => {
    const r = splitOccurredAndScheduled([
      { occurred_at: "2026-10-13T00:00:00+00:00", kind: "ACTUACION", title: "Agregar Memorial" },
      { occurred_at: "2026-10-15T12:00:00+00:00", kind: "ESTADO", title: "Estado 137" },
    ], now);
    expect(r.last).toMatchObject({ day: "2026-10-15", kind: "ESTADO" });
  });
  it("today's civil date counts as occurred", () => {
    expect(splitOccurredAndScheduled([{ occurred_at: "2026-10-21", kind: "ACTUACION", title: "x" }], now).last?.day).toBe("2026-10-21");
  });
});
