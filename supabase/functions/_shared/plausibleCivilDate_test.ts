import { assertEquals } from "jsr:@std/assert@1";
import { plausibleCivilDate, extractDateFromTitle } from "./canonicalPublicacionMapper.ts";
import { extractDateFromTitle as adapterExtract } from "./providerAdapters/publicacionesAdapter.ts";
Deno.test("radicado digits never become a date", () => {
  const t = "Providencia 11001311001320240075200 Admite DIV..pdf — sin-fecha";
  assertEquals(extractDateFromTitle(t), undefined);
  assertEquals(adapterExtract(t), undefined);
  assertEquals(adapterExtract("11001311001320240075200.pdf"), undefined);
});
Deno.test("standalone yyyymmdd still parses", () => {
  assertEquals(extractDateFromTitle("003Estados20260122.pdf"), "2026-01-22");
});
Deno.test("implausible or impossible civil dates are null", () => {
  assertEquals(plausibleCivilDate("0131-10-01"), null);
  assertEquals(plausibleCivilDate("sin-fecha"), null);
  assertEquals(plausibleCivilDate("2026-02-30"), null);
  assertEquals(plausibleCivilDate("2026-10-20T12:00:00Z"), "2026-10-20");
});
