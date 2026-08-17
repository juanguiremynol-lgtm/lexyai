/**
 * ITER63 — the provider column is a declared vocabulary with a stable
 * multi-source ordering, and a run that cannot name its provider asserts
 * nothing (neither an error nor a success).
 */
import { describe, expect, it } from "vitest";
import {
  DECLARED_PROVIDERS,
  canonProviderTokens,
  canonicalizeProvider,
  isDeclaredProvider,
  isProviderAttributable,
} from "@/lib/syncVocabulary";

describe("ITER63 provider vocabulary", () => {
  it("collapses the two orderings of the same source pair into one value", () => {
    const a = canonicalizeProvider("cpnu+tutelas");
    const b = canonicalizeProvider("tutelas+cpnu");
    expect(a.provider).toBe(b.provider);
    // ITER48: tutelas never existed; that data came from CPNU.
    expect(a.providers).toEqual(["cpnu"]);
  });

  it("sorts multi-source arrays deterministically", () => {
    expect(canonProviderTokens("samai_estados+publicaciones")).toEqual([
      "publicaciones",
      "samai_estados",
    ]);
    expect(canonProviderTokens("publicaciones|samai_estados")).toEqual([
      "publicaciones",
      "samai_estados",
    ]);
  });

  it("quarantines an undeclared value instead of accepting it", () => {
    const r = canonicalizeProvider("nueva_fuente_no_anunciada");
    expect(r.undeclared).toEqual(["nueva_fuente_no_anunciada"]);
    expect(r.providers).toEqual(["unknown"]);
  });

  it("declares every provider it canonicalises to", () => {
    for (const raw of ["cpnu", "pp", "estados", "samai_api", "tutelas"]) {
      const { providers } = canonicalizeProvider(raw);
      providers.forEach((p) => expect(isDeclaredProvider(p)).toBe(true));
    }
    expect(DECLARED_PROVIDERS).toContain("unknown");
  });

  it("keeps unattributable runs out of provider health, both directions", () => {
    expect(isProviderAttributable(["cpnu"])).toBe(true);
    expect(isProviderAttributable(["publicaciones", "samai_estados"])).toBe(true);
    expect(isProviderAttributable(["unknown"])).toBe(false); // error without a name
    expect(isProviderAttributable(["none"])).toBe(false); // caller-side rejection
    expect(isProviderAttributable([])).toBe(false);
  });
});
