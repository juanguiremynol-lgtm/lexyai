import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sameSamaiGrant, sourceGrantToken } from "./samaiGrantIdentity.ts";

// Regression: descriptors without source URLs must not construct (and throw)
// URLs during pairwise matching, while real source grants keep resolving.
Deno.test("grant matching skips non-source URL values without constructing URLs", () => {
  const Orig = globalThis.URL;
  let constructed = 0;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).URL = class extends Orig { constructor(u: string | URL, b?: string | URL) { constructed++; super(u, b); } };
  try {
    const legacy = { id: "a", nombre: "auto.pdf", url: "https://storage.example/x.pdf", urlVer: null };
    assertEquals(sourceGrantToken(legacy), "a");
    assertEquals(sameSamaiGrant(legacy, { ...legacy, id: "b" }), null);
    assertEquals(constructed, 0);
    const src = { url_origen: "HTTPS://samaicore.consejodeestado.gov.co/x?tokenDoc=t1" };
    assertEquals(sourceGrantToken(src), "t1");
    assertEquals(constructed, 1);
  } finally {
    globalThis.URL = Orig;
  }
});
