import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  mapProviderPayloadToCanonicalPubRows,
  toCanonicalPubRow,
  canonicalPubIdentityFromRow,
} from "../../supabase/functions/_shared/canonicalPublicacionMapper.ts";
import {
  DECLARED_ATTEMPT_STATUSES,
  canonicalAttemptStatus,
  canonicalizeAttemptsForPersist,
  sameAttemptStatus,
} from "@/lib/syncVocabulary";
import * as denoVocab from "../../supabase/functions/_shared/syncVocabulary.ts";

const WI = "11111111-2222-4333-8444-555555555555";
const ctx = { work_item_id: WI, organization_id: null, source: "samai_estados" };

describe("AUD6 — SAMAI fecha_fijacion only from GCP capture (disabled)", () => {
  it("refuses 'Fecha Estado' labels and normalized guesses", () => {
    for (const raw of [{ "Fecha Estado": "14/07/2026" }, { fecha_estado_raw: "2026-07-14" }, { fecha_estado_normalizada: "2026-07-14" }]) {
      const row = toCanonicalPubRow(
        { titulo: "A", fecha_publicacion: "2026-07-10", _source_provider: "samai_estados", raw_data: raw } as any,
        ctx,
      );
      expect(row.fecha_fijacion).toBeNull();
      expect(canonicalPubIdentityFromRow(row, WI)).toBe(row.hash_fingerprint);
    }
  });

  it("refuses even a provenanced capture while the gate is off", () => {
    const row = toCanonicalPubRow(
      {
        titulo: "A", fecha_publicacion: "2026-07-10", _source_provider: "samai_estados",
        raw_data: { hash_documento: "h1", fecha_estado: "2026-07-14", fecha_estado_provenance: { source: "samai_estado_list", document_hash: "h1" } },
      } as any,
      ctx,
    );
    expect(row.fecha_fijacion).toBeNull();
  });

  it("never copies fecha_providencia and never infers a date", () => {
    const [row] = mapProviderPayloadToCanonicalPubRows(
      { publicaciones: [{ titulo: "Auto admisorio", fecha_publicacion: "2026-01-20", fecha_providencia: "2026-01-20" }] },
      ctx,
    );
    expect(row.fecha_fijacion).toBeNull();
  });
});

describe("AUD2 — canonical uppercase attempt status", () => {
  it("canonicalises both provider casings to one declared form", () => {
    for (const [raw, want] of [
      ["success", "SUCCESS"], ["SUCCESS", "SUCCESS"], ["pending_upstream", "PENDING_UPSTREAM"],
      ["skipped", "SKIPPED"], ["EMPTY", "EMPTY"], ["restricted", "RESTRICTED"], ["weird", "UNKNOWN"],
    ] as const) {
      expect(canonicalAttemptStatus(raw)).toBe(want);
      expect(DECLARED_ATTEMPT_STATUSES).toContain(want);
    }
    expect(canonicalizeAttemptsForPersist([{ status: "weird" }])[0]).toEqual({ status: "UNKNOWN", status_raw: "weird" });
    expect(sameAttemptStatus("error", "ERROR")).toBe(true);
  });

  it("declares exactly uppercase values, identical in both mirrors", () => {
    for (const s of DECLARED_ATTEMPT_STATUSES) expect(s).toBe(s.toUpperCase());
    expect([...denoVocab.DECLARED_ATTEMPT_STATUSES]).toEqual([...DECLARED_ATTEMPT_STATUSES]);
  });

  it("every writer of provider_attempts canonicalises", () => {
    for (const f of [
      "supabase/functions/sync-publicaciones-by-work-item/index.ts",
      "supabase/functions/sync-by-radicado/index.ts",
      "supabase/functions/_shared/syncOrchestrator.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      const writes = src.match(/^\s*provider_attempts:\s*(?!ProviderAttempt)[^\n]+/gm) ?? [];
      expect(writes.length).toBeGreaterThan(0);
      for (const w of writes) expect(w).toContain("canonicalizeAttemptsForPersist(");
    }
  });
});

describe("AUD3 — restricted answers seal the read", () => {
  it("sealReadOutcome treats restricted as answered", () => {
    const src = readFileSync("supabase/functions/sync-by-work-item/index.ts", "utf8");
    const body = src.slice(src.indexOf("async function sealReadOutcome"), src.indexOf("function jsonResponse"));
    expect(body).toContain("'restricted'");
    expect(src).toContain('attempt.status === "restricted" ? "restricted"');
  });
});
