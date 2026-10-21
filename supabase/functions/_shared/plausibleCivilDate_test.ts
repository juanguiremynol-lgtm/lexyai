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
const FAMILIA_TITLES = [
  "Providencia 11001311001320240075200.pdf — sin-fecha",
  "Providencia 11001311001320240075200 Continúa Trámite.pdf — sin-fecha",
  "Providencia 11001311001320240075200 Admite DIV..pdf — sin-fecha",
];
Deno.test("Familia 0131 titles: unknown date stays undefined, never today", () => {
  for (const t of FAMILIA_TITLES) {
    assertEquals(extractDateFromTitle(t), undefined);
    assertEquals(adapterExtract(t), undefined);
  }
});
Deno.test("explicit valid date parses; impossible calendar day does not", () => {
  assertEquals(extractDateFromTitle("Estado 20261020 Juzgado"), "2026-10-20");
  assertEquals(extractDateFromTitle("Estado 20260230.pdf"), undefined);
  assertEquals(extractDateFromTitle("Estado 20260230 Juzgado"), undefined);
});
