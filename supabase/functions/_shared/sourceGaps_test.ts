import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sourceGaps, describeSourceQuality } from "./sourceRunQuality.ts";
Deno.test("CPNU 44/43/3 private/40 usable → 1 sin respuesta, 4 sin lectura confirmada", () => {
  const c = { expected_count: 44, attempted_count: 44, answered_count: 43, usable_confirmed_count: 40,
    pending_upstream_count: 0, error_count: 1, not_found_count: 0 } as any;
  const g = sourceGaps(c);
  assertEquals(g.sinRespuesta, 1);
  assertEquals(g.sinLecturaConfirmada, 4);
  const s = describeSourceQuality(c, 0);
  assert(!s.includes("0 sin confirmar"), s);
});
