/**
 * Iteration 26 — identity is computed in exactly ONE place.
 *
 * Five consecutive "data loss" incidents were all the same defect: two
 * representations of one legal fact failing to recognise each other because
 * identity was computed in more than one location. These tests are the
 * structural guard. They are BLOCKING: any new fingerprint code path that does
 * not route through the shared helper fails the build here.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalActFingerprint,
  canonicalPubFingerprint,
  resolvePartyHint,
} from "../../supabase/functions/_shared/canonicalFingerprint.ts";
import {
  toCanonicalActRow,
  canonicalActIdentityFromRow,
} from "../../supabase/functions/_shared/canonicalActMapper.ts";
import {
  canonicalPubIdentityFromRow,
  pubArticleIdFromRow,
  LEGACY_PUB_COMPOSITE_KEY_PREFIXES,
} from "../../supabase/functions/_shared/canonicalPublicacionMapper.ts";
import { computeCpnuFingerprint } from "../../supabase/functions/_shared/providerAdapters/cpnuAdapter.ts";
import { computeSamaiFingerprint } from "../../supabase/functions/_shared/providerAdapters/samaiAdapter.ts";
import { computeSamaiEstadosFingerprint } from "../../supabase/functions/_shared/providerAdapters/samaiEstadosAdapter.ts";
import { computePublicacionFingerprint } from "../../supabase/functions/_shared/providerAdapters/publicacionesAdapter.ts";
import {
  computeTutelasFingerprint,
  computeTutelasEstadoFingerprint,
} from "../../supabase/functions/_shared/providerAdapters/tutelasAdapter.ts";
import {
  CHAIN,
  PROVIDER_ROW_KINDS,
  PROVIDER_LOCAL_SOURCES,
  chainProviders,
  providerMatrixGaps,
} from "../../supabase/functions/_shared/bridgeProviderMatrix.ts";

const WI = "11111111-2222-4333-8444-555555555555";

// ────────────────────────────────────────────────────────────
// 1. TS ↔ SQL parity fixtures (executed against Postgres below)
// ────────────────────────────────────────────────────────────

type Fixture = {
  id: string;
  kind: "ACT" | "PUB";
  date: string | null;
  title: string | null;
  party_hint: string | null;
  tipo?: string | null;
};

/** Includes the shapes that caused every one of the five incidents:
 *  free-text roles in the tail, accents, double spaces, .pdf noise, copy
 *  markers, DD/MM dates, truncated titles, empty description. */
export const PARITY_FIXTURES: Fixture[] = [
  { id: "f01", kind: "ACT", date: "2026-01-15", title: "Auto admisorio", party_hint: null },
  { id: "f02", kind: "ACT", date: "2026-01-15", title: "Auto admisorio - DEMANDANTE JUAN PEREZ", party_hint: null },
  { id: "f03", kind: "ACT", date: "2026-01-15", title: "Auto admisorio", party_hint: "Demandante" },
  { id: "f04", kind: "ACT", date: "2026-01-15", title: "Auto  admisorio   de  la  demanda", party_hint: null },
  { id: "f05", kind: "ACT", date: "15/01/2026", title: "NOTIFICACIÓN POR ESTADO", party_hint: null },
  { id: "f06", kind: "ACT", date: "2026-01-15T13:22:00.000Z", title: "Notificacion por estado", party_hint: null },
  { id: "f07", kind: "ACT", date: null, title: "Acta de reparto", party_hint: null },
  { id: "f08", kind: "ACT", date: "2026-02-01", title: "", party_hint: null },
  { id: "f09", kind: "ACT", date: "2026-02-01", title: "Auto — ACCIONADO MUNICIPIO", party_hint: "Accionado" },
  { id: "f10", kind: "ACT", date: "2026-02-01", title: "Traslado APODERADO", party_hint: "apoderado" },
  { id: "f11", kind: "PUB", date: "2026-03-10", title: "003Estados20260310.pdf", party_hint: null, tipo: "Estado Electrónico" },
  { id: "f12", kind: "PUB", date: "2026-03-10", title: "003Estados20260310", party_hint: null, tipo: "document" },
  { id: "f13", kind: "PUB", date: "2026-03-10", title: "003Estados20260310 (1) (1)", party_hint: null, tipo: null },
  { id: "f14", kind: "PUB", date: "10/03/2026", title: "Estado del día", party_hint: null, tipo: "Estado" },
  { id: "f15", kind: "PUB", date: "2026-03-10", title: "Auto que resuelve — DEMANDADO EPS", party_hint: null, tipo: "Providencia" },
  { id: "f16", kind: "PUB", date: "2026-03-10", title: "Auto que resuelve", party_hint: "Demandado", tipo: "Providencia" },
  { id: "f17", kind: "PUB", date: null, title: "Edicto", party_hint: null, tipo: "Edicto" },
  { id: "f18", kind: "PUB", date: "2026-03-10", title: "x".repeat(260), party_hint: null, tipo: "Estado" },
];

function tsFingerprint(f: Fixture): string {
  return f.kind === "PUB"
    ? canonicalPubFingerprint({
        work_item_id: WI, pub_date: f.date, tipo_publicacion: f.tipo ?? null,
        title: f.title, party_hint: f.party_hint,
      })
    : canonicalActFingerprint({
        work_item_id: WI, act_date: f.date, actuacion: f.title, party_hint: f.party_hint,
      });
}

describe("iter26 · 1 — TS ↔ SQL fingerprint parity", () => {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const online = Boolean(url && key);

  it.runIf(online)("every fixture hashes byte-identically in Postgres", async () => {
    const res = await fetch(`${url}/rest/v1/rpc/rpc_canon_fingerprint_probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key!, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        p_payload: { items: PARITY_FIXTURES.map((f) => ({ ...f, work_item_id: WI })) },
      }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    const bySql = new Map<string, string>(
      (body.results as Array<{ id: string; fingerprint: string }>).map((r) => [r.id, r.fingerprint]),
    );
    const divergent = PARITY_FIXTURES
      .filter((f) => bySql.get(f.id) !== tsFingerprint(f))
      .map((f) => ({ id: f.id, ts: tsFingerprint(f), sql: bySql.get(f.id) }));
    expect(divergent).toEqual([]);
  }, 30_000);

  it("free-text roles never change identity (the iteration-25 defect)", () => {
    const plain = tsFingerprint(PARITY_FIXTURES[0]);
    const withRoleTail = tsFingerprint(PARITY_FIXTURES[1]);
    expect(withRoleTail).toBe(plain);
    // A STRUCTURED party hint, on the other hand, must discriminate.
    expect(tsFingerprint(PARITY_FIXTURES[2])).not.toBe(plain);
  });

  it("tipo_publicacion is provenance, not identity (iteration 24)", () => {
    expect(tsFingerprint(PARITY_FIXTURES[11])).toBe(tsFingerprint(PARITY_FIXTURES[10]));
    expect(tsFingerprint(PARITY_FIXTURES[12])).toBe(tsFingerprint(PARITY_FIXTURES[10]));
  });
});

// ────────────────────────────────────────────────────────────
// 2. Adapters must not compute identity their own way
// ────────────────────────────────────────────────────────────

describe("iter26 · 2 — adapter identity == persistence identity", () => {
  it("resolvePartyHint reads every structured party field shape", () => {
    expect(resolvePartyHint({ parte: "Demandante" })).toBe("Demandante");
    expect(resolvePartyHint({ "Docum. a notif.": "Demandado" })).toBe("Demandado");
    expect(resolvePartyHint({ Sujeto: "Accionante" })).toBe("Accionante");
    expect(resolvePartyHint({ anotacion: "el DEMANDANTE aporta poder" })).toBeNull();
    expect(resolvePartyHint(null)).toBeNull();
  });

  it("cpnu: a raw payload carrying a parte propagates into identity", () => {
    const raw = { fecha: "2026-04-01", actuacion: "Auto admisorio", parte: "Demandante" };
    const adapterFp = computeCpnuFingerprint(
      "05001333301520260011300", raw.fecha, raw.actuacion, "Juzgado 15",
      WI, false, "2026-04-02", "anotación libre", "1", resolvePartyHint(raw),
    );
    const rowFp = canonicalActIdentityFromRow(
      { act_date: raw.fecha, description: raw.actuacion, raw_data: raw } as any,
      WI,
    );
    expect(adapterFp).toBe(rowFp);
    // …and it differs from the same act without the parte.
    expect(adapterFp).not.toBe(computeCpnuFingerprint(
      "05001333301520260011300", raw.fecha, raw.actuacion, "Juzgado 15",
      WI, false, undefined, undefined, undefined, null,
    ));
  });

  it("samai: partyHint option reaches the canonical helper", () => {
    const raw = { fechaActuacion: "2026-04-02", actuacion: "Sentencia", parte: "Demandado" };
    const adapterFp = computeSamaiFingerprint(raw.fechaActuacion, raw.actuacion, null, {
      workItemId: WI, partyHint: resolvePartyHint(raw),
    });
    expect(adapterFp).toBe(canonicalActIdentityFromRow(
      { act_date: raw.fechaActuacion, description: raw.actuacion, raw_data: raw } as any, WI,
    ));
  });

  it("samai_estados: pub identity matches the stored-row recomputation", () => {
    const raw = { fecha: "2026-04-03", actuacion: "Auto que admite", parte: "Accionado" };
    const adapterFp = computeSamaiEstadosFingerprint(
      raw.fecha, raw.actuacion, "", WI, false, resolvePartyHint(raw),
    );
    expect(adapterFp).toBe(canonicalPubIdentityFromRow(
      { fecha_fijacion: raw.fecha, tipo_publicacion: raw.actuacion, title: raw.actuacion, raw_data: raw } as any,
      WI,
    ));
  });

  it("publicaciones: party hint is derived from rawData through the shared helper", () => {
    const raw = { titulo: "Estado Electrónico", fecha_publicacion: "2026-04-04", parte: "Demandante" };
    const adapterFp = computePublicacionFingerprint(WI, undefined, undefined, raw.titulo, false, {
      pubDate: raw.fecha_publicacion, tipo: "Estado Electrónico", rawData: raw,
    });
    expect(adapterFp).toBe(canonicalPubIdentityFromRow(
      { fecha_fijacion: raw.fecha_publicacion, tipo_publicacion: "Estado Electrónico", title: raw.titulo, raw_data: raw } as any,
      WI,
    ));
  });

  it("tutelas: acts use the ACT helper and estados use the PUB helper", () => {
    const raw = { fecha: "2026-04-05", actuacion: "Fallo de tutela", parte: "Accionante" };
    expect(computeTutelasFingerprint(raw.fecha, raw.actuacion, "", WI, false, resolvePartyHint(raw)))
      .toBe(canonicalActIdentityFromRow(
        { act_date: raw.fecha, description: raw.actuacion, raw_data: raw } as any, WI));
    const estadoFp = computeTutelasEstadoFingerprint(raw.fecha, raw.actuacion, WI, resolvePartyHint(raw));
    expect(estadoFp.startsWith("pub_")).toBe(true);
    expect(estadoFp).toBe(canonicalPubIdentityFromRow(
      { fecha_fijacion: raw.fecha, tipo_publicacion: raw.actuacion, title: raw.actuacion, raw_data: raw } as any, WI));
  });
});

// ────────────────────────────────────────────────────────────
// 3. The composite key must never be parsed ad hoc again
// ────────────────────────────────────────────────────────────

describe("iter26 · 3 — article_id is an explicit field", () => {
  it("reads the explicit field first", () => {
    expect(pubArticleIdFromRow({ raw_data: { article_id: "184731165", key: "individual:999:x:y" } }))
      .toBe("184731165");
    expect(pubArticleIdFromRow({ raw_data: { estado: { article_id: 42 } } })).toBe("42");
  });

  it("locks the LEGACY composite-key format so any pub-writer refactor fails loudly", () => {
    // If this assertion ever needs changing, every legacy row's article_id
    // token changes with it — hence the lock.
    expect(LEGACY_PUB_COMPOSITE_KEY_PREFIXES).toEqual(["estado", "individual"]);
    expect(pubArticleIdFromRow({ raw_data: { key: "individual:184731165:Auto:2026-01-01" } }))
      .toBe("184731165");
    expect(pubArticleIdFromRow({ raw_data: { key: "estado:770:12:2026-01-01:Estados" } })).toBe("770");
    // Unknown prefixes must NOT be mined for a phantom token.
    expect(pubArticleIdFromRow({ raw_data: { key: "otro:770:x" } })).toBeNull();
    expect(pubArticleIdFromRow({ raw_data: {} })).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// 4. Stored rows must still hash to what we would compute today
// ────────────────────────────────────────────────────────────

describe("iter26 · 4 — stored-vs-recomputed invariant", () => {
  it("a canonical act row's stored hash equals its recomputation", () => {
    const row = toCanonicalActRow(
      { fecha: "2026-05-01", descripcion: "Auto admisorio", parte: "Demandante" } as any,
      { work_item_id: WI, source: "cpnu" } as any,
    );
    expect(row.hash_fingerprint).toBe(canonicalActIdentityFromRow(row as any, WI));
  });

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  it.runIf(Boolean(url && key))("portfolio-wide: zero drift on live rows", async () => {
    const res = await fetch(`${url}/rest/v1/rpc/rpc_identity_drift_summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key!, Authorization: `Bearer ${key}` },
      body: "{}",
    });
    expect(res.ok).toBe(true);
    const s = await res.json();
    // Archived rows deliberately keep their historical hash (they document the
    // drift that caused the incident); LIVE rows must be exact.
    expect({ acts: s.acts_live_drift, pubs: s.pubs_live_drift }).toEqual({ acts: 0, pubs: 0 });
  }, 30_000);
});

// ────────────────────────────────────────────────────────────
// 5. CHAIN ↔ row-kinds ↔ local-sources lockstep
// ────────────────────────────────────────────────────────────

describe("iter26 · 5 — provider matrix lockstep", () => {
  it("every CHAIN provider has row kinds and local sources", () => {
    expect(providerMatrixGaps()).toEqual([]);
  });

  it("no orphan entries in either map", () => {
    const providers = new Set(chainProviders());
    // tutelas is reachable through the CPNU+TUTELAS union route.
    providers.add("tutelas");
    for (const k of Object.keys(PROVIDER_ROW_KINDS)) expect(providers.has(k)).toBe(true);
    for (const k of Object.keys(PROVIDER_LOCAL_SOURCES)) expect(providers.has(k)).toBe(true);
  });

  it("row kinds are well formed", () => {
    for (const [p, kinds] of Object.entries(PROVIDER_ROW_KINDS)) {
      expect(kinds.length, p).toBeGreaterThan(0);
      for (const k of kinds) expect(["ACT", "PUB"]).toContain(k);
    }
    expect(Object.keys(CHAIN).length).toBeGreaterThan(0);
  });
});
