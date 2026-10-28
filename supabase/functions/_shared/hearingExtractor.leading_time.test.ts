import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractHearingsFromAct } from "./hearingExtractor.ts";

Deno.test("time written before the date is used (9:00 a.m. Bogotá)", () => {
  const c = extractHearingsFromAct({ act_type: "Auto fija fecha audiencia", description: "fija fecha audiencia a las 9:00 a.m. del 10 de noviembre de 2026" });
  assertEquals(c.length, 1);
  assertEquals(c[0].starts_at_iso, "2026-11-10T14:00:00.000Z");
  assertEquals(c[0].time_inferred, false);
});

Deno.test("time written after the date still works", () => {
  const c = extractHearingsFromAct({ act_type: "Auto fija fecha audiencia", description: "fija fecha audiencia para el 10 de noviembre de 2026 a las 2:30 p.m." });
  assertEquals(c[0].starts_at_iso, "2026-11-10T19:30:00.000Z");
});
