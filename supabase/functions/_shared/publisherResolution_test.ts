import { assert, assertEquals } from "jsr:@std/assert@1";
import { articleNamesAuthorDespacho, locateCaseInPackagePages, portalSearchPlan, verifyDeclaredCasePages } from "./publisherResolution.ts";

const RIONEGRO = "JUZGADO 002 CIVIL MUNICIPAL DE RIONEGRO";

Deno.test("search plan: author despacho first, then municipality candidates", () => {
  assertEquals(portalSearchPlan("05615400300220260036600"), [
    { kind: "author_despacho", code: "056154003002" },
    { kind: "municipality", code: "05615" },
  ]);
});

Deno.test("central publisher article accepted only when it names the author despacho", () => {
  assert(articleNamesAuthorDespacho("Notificación por Estado No 131 - 02 CIVIL MUNICIPAL DE RIONEGRO de 20 oct 2026", RIONEGRO));
  assert(!articleNamesAuthorDespacho("Notificación por Estado No 90 - 01 CIVIL MUNICIPAL DE RIONEGRO de 20 oct 2026", RIONEGRO));
  assert(!articleNamesAuthorDespacho("Notificación por Estado No 12 - 02 CIVIL CIRCUITO DE RIONEGRO de 20 oct 2026", RIONEGRO));
  assert(!articleNamesAuthorDespacho("Notificación por Estado No 12 - 02 CIVIL MUNICIPAL DE MARINILLA de 20 oct 2026", RIONEGRO));
});

Deno.test("package pages: full radicado with fragmented separators", () => {
  const pages = ["otro 05615400300220260011100", "05615 40 03 002\n2026-00366-00 admite", "sin caso"];
  assertEquals(locateCaseInPackagePages(pages, "05615400300220260036600", RIONEGRO), [2]);
});

Deno.test("package pages: short radicado only with author despacho context", () => {
  const pages = [
    "JUZGADO SEGUNDO CIVIL MUNICIPAL DE RIONEGRO 2026-00366",
    "JUZGADO PRIMERO CIVIL MUNICIPAL DE RIONEGRO 2026-00366",
    "JUZGADO 02 CIVIL MUNICIPAL DE RIONEGRO 2026-366 auto",
  ];
  // page 1 uses an ordinal word; numeric context required on short-form pages
  assertEquals(locateCaseInPackagePages(pages, "05615400300220260036600", RIONEGRO), [3]);
});

Deno.test("declared ranges must each contain a located page", () => {
  assert(verifyDeclaredCasePages([5, 60], [[5, 5], [60, 61]]));
  assert(!verifyDeclaredCasePages([5], [[5, 5], [60, 61]]));
  assert(!verifyDeclaredCasePages([5], []));
});

Deno.test("short form without page context only when the author despacho is the publisher", () => {
  const pages = ["2026-456 VERBAL SUMARIO"];
  assertEquals(locateCaseInPackagePages(pages, "05607408900120260045600", "JUZGADO 001 PROMISCUO MUNICIPAL DE EL RETIRO"), []);
  assertEquals(locateCaseInPackagePages(pages, "05607408900120260045600", "JUZGADO 001 PROMISCUO MUNICIPAL DE EL RETIRO", true), [1]);
});
