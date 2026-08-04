/**
 * Iteration 24 — `source` is a closed lowercase enum and identity never
 * depends on it (nor on the publication's `tipo`).
 *
 * Regression guard for the third guise of the fingerprint-divergence bug:
 * the same provider written as `cpnu` / `CPNU` / `CPNU+TUTELAS`, and the same
 * estado typed as `Estado Electrónico` / `document` / null, each producing a
 * distinct row for one juridical fact.
 */
import { describe, it, expect } from "vitest";
import {
  CANONICAL_SOURCES,
  normalizeSourceKey,
  normalizeSourceList,
} from "../../supabase/functions/_shared/canonicalSource.ts";
import { toCanonicalActRow } from "../../supabase/functions/_shared/canonicalActMapper.ts";
import { toCanonicalPubRow } from "../../supabase/functions/_shared/canonicalPublicacionMapper.ts";
import { canonicalPubFingerprint } from "../../supabase/functions/_shared/canonicalFingerprint.ts";

const WI = "11111111-2222-4333-8444-555555555555";
const ctx = { work_item_id: WI, owner_id: null, organization_id: null, workflow_type: "CGP" };

describe("iter24 — source canonicalisation", () => {
  it("collapses casing and aliases to the closed enum", () => {
    expect(normalizeSourceKey("CPNU")).toBe("cpnu");
    expect(normalizeSourceKey("SAMAI_ESTADOS")).toBe("samai_estados");
    expect(normalizeSourceKey("pp")).toBe("publicaciones");
    expect(normalizeSourceKey("tutelas-api")).toBe("tutelas");
    expect(normalizeSourceKey("CPNU+TUTELAS")).toBe("cpnu");
  });

  it("records the chain in `sources`, never in `source`", () => {
    expect(normalizeSourceList("CPNU+TUTELAS")).toEqual(["cpnu", "tutelas"]);
  });

  it("every emitted token belongs to the enum", () => {
    for (const raw of ["CPNU", "pp", "CPNU+TUTELAS", "SAMAI_ESTADOS", "wat"]) {
      expect(CANONICAL_SOURCES).toContain(normalizeSourceKey(raw));
    }
  });

  it("act mapper normalises source and keeps identity source-agnostic", () => {
    const unit = { actuacion: "Auto admite demanda", fecha: "2026-02-10" };
    const a = toCanonicalActRow({ ...unit, _source: "CPNU" }, ctx);
    const b = toCanonicalActRow({ ...unit, _source: "CPNU+TUTELAS" }, ctx);
    expect(a.source).toBe("cpnu");
    expect(b.source).toBe("cpnu");
    expect(b.sources).toEqual(["cpnu", "tutelas"]);
    expect(a.hash_fingerprint).toBe(b.hash_fingerprint);
  });

  it("publication identity ignores tipo_publicacion", () => {
    const base = { work_item_id: WI, pub_date: "2025-10-31", title: "Estado N° 161 del 31 de octubre de 2025.pdf", party_hint: null };
    const fps = ["Estado Electrónico", "document", null].map((t) =>
      canonicalPubFingerprint({ ...base, tipo_publicacion: t }),
    );
    expect(new Set(fps).size).toBe(1);
  });

  it("pub mapper emits a lowercase enum source", () => {
    const row = toCanonicalPubRow(
      { key: "k1", titulo: "Estado N° 161.pdf", fecha_publicacion: "2025-10-31", tipo: "document" } as any,
      { work_item_id: WI, organization_id: null, source: "PP" },
    );
    expect(row.source).toBe("publicaciones");
    expect(row.sources).toEqual(["publicaciones"]);
  });
});
