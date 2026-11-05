import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { prepareInitialHistoricalRequest } from "./initialRequestPreparation.ts";
Deno.test("initial historical request preserves explicit approved dates without daily defaults or new jobs", () => {
  const input = { radicado: "12345678901234567890100", fecha_inicio: "2026-01-01", fecha_fin: "2026-11-05" };
  assertEquals(prepareInitialHistoricalRequest(input), input);
  assertEquals(Object.keys(prepareInitialHistoricalRequest(input)), ["radicado", "fecha_inicio", "fecha_fin"]);
});
Deno.test("initial historical request rejects absent, reversed or invalid calendar scopes", () => {
  for (const [fecha_inicio, fecha_fin] of [["", "2026-11-05"], ["2026-02-30", "2026-11-05"], ["2026-11-06", "2026-11-05"]]) {
    assertThrows(() => prepareInitialHistoricalRequest({ radicado: "12345678901234567890100", fecha_inicio, fecha_fin }), Error, "INITIAL_HISTORICAL_SCOPE_REQUIRED");
  }
});