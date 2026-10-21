import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveActIdentity, extractActOrigin, toActIdentityCandidate } from "./actOriginIdentity.ts";

// Two CPNU memoriales on the same day with distinct consActuacion arrive in
// one batch. The first is inserted and read back; the second must become its
// own row (versioned fingerprint), never a skip onto the first fingerprint.
const evidence = "Agregar Memorial - Correo electrónico";
const persistedFirst = {
  id: "first", source: "cpnu", hash_fingerprint: "V1", act_date: "2026-10-16",
  description: evidence, raw_data: { indice: "126614731", origen_indice: "126614731" },
};

Deno.test("same-day distinct CPNU origins in one batch both insert", () => {
  const rows = [toActIdentityCandidate(persistedFirst, "S")];
  const d = resolveActIdentity({ v1: "V1", semanticKey: "S", provider: "cpnu",
    incoming: extractActOrigin({ indice: "126614718", anotacion: "Correo electrónico" }), evidence, rows });
  assertEquals(d.kind, "insert");
  if (d.kind === "insert") assertEquals(d.fingerprint.startsWith("V1_o"), true);
});

Deno.test("read-back without source/fingerprint would hide the first row (regression guard)", () => {
  const rows = [toActIdentityCandidate({ ...persistedFirst, source: undefined, hash_fingerprint: undefined }, "S")];
  const d = resolveActIdentity({ v1: "V1", semanticKey: "S", provider: "cpnu",
    incoming: extractActOrigin({ indice: "126614718", anotacion: "Correo electrónico" }), evidence, rows });
  // Plain v1 would collide with the stored row in the RPC and be skipped.
  assertEquals(d.kind === "insert" && d.fingerprint, "V1");
});

Deno.test("repeat of the same native origin matches, no duplicate", () => {
  const rows = [toActIdentityCandidate(persistedFirst, "S")];
  const d = resolveActIdentity({ v1: "V1", semanticKey: "S", provider: "cpnu",
    incoming: extractActOrigin({ indice: "126614731", anotacion: "Correo electrónico" }), evidence, rows });
  assertEquals(d.kind, "match");
});
