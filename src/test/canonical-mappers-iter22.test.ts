/**
 * Iteration 22 — the structural cause of the false bridge gap.
 *
 * The invariant under test: for a given provider payload, EVERY ingestion route
 * (adapter inventory, sync persistence, bridge recomputation from the stored
 * row) must arrive at the SAME identity. If any of these assertions fail, the
 * bridge will report a phantom gap again.
 */
import { describe, it, expect } from "vitest";
import {
  explodeProviderPublicaciones,
  toCanonicalPubRow,
  canonicalPubIdentityFromRow,
  mapProviderPayloadToCanonicalPubRows,
} from "../../supabase/functions/_shared/canonicalPublicacionMapper.ts";
import {
  toCanonicalActRow,
  canonicalActIdentityFromRow,
} from "../../supabase/functions/_shared/canonicalActMapper.ts";

const WI = "11111111-2222-4333-8444-555555555555";

const EL_RETIRO_PAYLOAD = {
  actuaciones: [
    {
      fecha: "2025-12-16",
      descripcion: "Auto que ordena requerir",
      texto_auto: "El Retiro, dieciseis (16) de diciembre de dos mil veinticinco (2025)",
      entry_url: "https://example.gov.co/entry/1",
      pdf_url: "https://publicaciones-procesales-api-abc.run.app/pdf/auto1.pdf",
      pdf_individual_nombre: "auto1.pdf",
      estado: {
        article_id: "184731165",
        numero: "003",
        fecha_publicacion: "2025-12-17",
        pdf_url: "https://publicaciones-procesales-api-abc.run.app/pdf/003Estados20251217.pdf",
        pdf_nombre: "003Estados20251217.pdf",
      },
      documentos_pdf: [
        { tipo: "estado", titulo: "003Estados20251217.pdf", fecha: "2025-12-17", pdf_url: "https://publicaciones-procesales-api-abc.run.app/pdf/003Estados20251217.pdf" },
        { tipo: "auto", titulo: "auto1.pdf", fecha: "2025-12-16", pdf_url: "https://publicaciones-procesales-api-abc.run.app/pdf/auto1.pdf" },
      ],
    },
  ],
};

describe("canonical publicacion mapper — single transformation", () => {
  it("explodes one actuación into the estado planilla and the individual providencia", () => {
    const units = explodeProviderPublicaciones(EL_RETIRO_PAYLOAD);
    expect(units.map((u) => u.tipo)).toEqual(["Estado Electrónico", "Providencia"]);
  });

  it("produces an identity recomputable from the stored row (bridge parity)", () => {
    const rows = mapProviderPayloadToCanonicalPubRows(EL_RETIRO_PAYLOAD, {
      work_item_id: WI,
      organization_id: null,
      source: "publicaciones",
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // What `bridge-reconcile` recomputes from the persisted row must equal
      // what the writer stored. This is the assertion that failed in iter 21.
      expect(canonicalPubIdentityFromRow(row, WI)).toBe(row.hash_fingerprint);
    }
  });

  it("gives the same identity no matter which route mapped the payload", () => {
    const viaFullRoute = mapProviderPayloadToCanonicalPubRows(EL_RETIRO_PAYLOAD, {
      work_item_id: WI, organization_id: null, source: "publicaciones",
    }).map((r) => r.hash_fingerprint);

    const viaTwoSteps = explodeProviderPublicaciones(EL_RETIRO_PAYLOAD)
      .map((u) => toCanonicalPubRow(u, { work_item_id: WI, organization_id: null, source: "publicaciones" }))
      .map((r) => r.hash_fingerprint);

    expect(viaTwoSteps).toEqual(viaFullRoute);
    expect(new Set(viaFullRoute).size).toBe(2); // estado ≠ providencia
  });

  it("never writes fecha_fijacion for SAMAI rows (doctrine 6.2)", () => {
    const [row] = mapProviderPayloadToCanonicalPubRows(
      { publicaciones: [{ titulo: "Auto admisorio", fecha_publicacion: "2026-01-20" }] },
      { work_item_id: WI, organization_id: null, source: "samai_estados" },
    );
    expect(row.fecha_fijacion).toBeNull();
    expect(row.published_at).toBe("2026-01-20T05:00:00.000Z");
  });
});

describe("canonical act mapper — PENAL_906 joins the model", () => {
  it("hashes a penal actuación exactly like any other CPNU actuación", () => {
    const unit = {
      actuacion: "Audiencia de formulación de imputación",
      anotacion: "Se fija fecha",
      fecha: "16/12/2025",
      _source: "cpnu",
    };
    const penal = toCanonicalActRow(unit, {
      owner_id: "o", organization_id: "org", work_item_id: WI,
      workflow_type: "PENAL_906", scrape_date: "2026-01-01", despacho: null, source: "cpnu",
    });
    const cgp = toCanonicalActRow(unit, {
      owner_id: "o", organization_id: "org", work_item_id: WI,
      workflow_type: "CGP", scrape_date: "2026-01-01", despacho: null, source: "cpnu",
    });
    // Identity is the juridical fact, never the workflow label or the route.
    expect(penal.hash_fingerprint).toBe(cgp.hash_fingerprint);
    expect(penal.hash_fingerprint.startsWith("penal_")).toBe(false);
    expect(canonicalActIdentityFromRow(penal, WI)).toBe(penal.hash_fingerprint);
  });
});
