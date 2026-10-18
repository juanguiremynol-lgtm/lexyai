import { describe, it, expect } from "vitest";
import { isAndromedaCopyUrl, summarizeActAttachments, verifyPdfBytes } from "@/lib/act-attachments-inventory";
import { getActAttachments } from "@/lib/mcp/act-attachments-core";

const OWN = "https://storage.googleapis.com/andromeda-cpnu-documentos-2026/x/a.pdf";
const OWN2 = "https://storage.googleapis.com/andromeda-cpnu-documentos-2026/x/b.pdf";
const pdfRes = () => new Response(new TextEncoder().encode("%PDF-1.7\n..."), { status: 206 });
const fetchMap = (m: Record<string, () => Response>) => async (u: string) => (m[u] ?? (() => new Response("", { status: 404 })))();

describe("provenance", () => {
  it("accepts only Andromeda buckets with exact host and no query", () => {
    expect(isAndromedaCopyUrl(OWN)).toBe(true);
    expect(isAndromedaCopyUrl("https://storage.googleapis.com/other-bucket/a.pdf")).toBe(false);
    expect(isAndromedaCopyUrl(`${OWN}?X-Goog-Signature=abc`)).toBe(false);
    expect(isAndromedaCopyUrl("https://andromeda-cpnu-documentos-2026.storage.googleapis.com/a.pdf")).toBe(false);
    expect(isAndromedaCopyUrl("http://storage.googleapis.com/andromeda-cpnu-documentos-2026/a.pdf")).toBe(false);
    expect(isAndromedaCopyUrl("https://storage.googleapis.com/andromeda-cpnu-documentos-2026/../evil/a.pdf")).toBe(false);
  });
});

describe("byte verification", () => {
  it("PDF bytes → pdf; 403/expired → inaccesible; HTML → no_pdf; network → error_red", async () => {
    expect((await verifyPdfBytes(OWN, async () => pdfRes())).status).toBe("pdf");
    expect((await verifyPdfBytes(OWN, async () => new Response("AccessDenied", { status: 403 }))).status).toBe("inaccesible");
    expect((await verifyPdfBytes(OWN, async () => new Response("<html>", { status: 200 }))).status).toBe("no_pdf");
    expect((await verifyPdfBytes(OWN, async () => { throw new Error("timeout"); })).status).toBe("error_red");
  });
});

describe("summary states", () => {
  it("null documentos, no evidence → desconocido", () => {
    expect(summarizeActAttachments({ documentos: null, raw_data: {} }).estado).toBe("desconocido");
  });
  it("URL without verification is never disponible", () => {
    const s = summarizeActAttachments({ documentos: [{ gcs_url: OWN }], raw_data: {} });
    expect(s.estado).toBe("enlaces_sin_verificar");
    expect(s.archivos[0].url).toBeNull();
  });
  it("foreign bucket is never exposed nor counted", () => {
    const s = summarizeActAttachments(
      { documentos: [{ gcs_url: "https://storage.googleapis.com/other/a.pdf" }], raw_data: {} },
      { "https://storage.googleapis.com/other/a.pdf": { status: "pdf", http: 200 } },
    );
    expect(s.verificados).toBe(0);
    expect(s.archivos[0].verificacion).toBe("origen_no_permitido");
    expect(s.archivos[0].url).toBeNull();
  });
  it("1 verified of 6 announced → parcial, faltan 5", () => {
    const s = summarizeActAttachments(
      { documentos: [{ gcs_url: OWN }, { gcs_url: OWN2 }], raw_data: { anexos_inventario: { anunciados: 6 } } },
      { [OWN]: { status: "pdf", http: 206 }, [OWN2]: { status: "inaccesible", http: 403 } },
    );
    expect(s.estado).toBe("parcial");
    expect(s.verificados).toBe(1);
    expect(s.anunciados).toBe(6);
    expect(s.faltantes).toBe(5);
    expect(s.causa).toContain("1 de 6");
  });
  it("all links expired → inaccesible", () => {
    const s = summarizeActAttachments({ documentos: [{ gcs_url: OWN }] }, { [OWN]: { status: "inaccesible", http: 403 } });
    expect(s.estado).toBe("inaccesible");
  });
  it("explicit provider zero → sin_anexos", () => {
    expect(summarizeActAttachments({ documentos: [], documentos_observados_en: "2026-10-18", raw_data: {} }).estado).toBe("sin_anexos");
  });
});

// Fake RLS: user U1 sees org1 rows only.
function fakeSb(visibleActs: any[], visibleItems: any[]) {
  return {
    from(table: string) {
      const rows = table === "work_item_acts" ? visibleActs : visibleItems;
      let id: string | null = null;
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => { id = v; return q; },
        maybeSingle: async () => ({ data: rows.find((r) => r.id === id) ?? null, error: null }),
      };
      return q;
    },
  };
}
const resolver = async (sb: any, a: { id?: string; radicado?: string }) => {
  const { data } = await sb.from("work_items").select().eq("id", a.id ?? a.radicado).maybeSingle();
  return data ? { item: data, error: null } : { item: null, error: "Asunto no encontrado (o no pertenece a tu cuenta)." };
};
const ACT = { id: "a1", work_item_id: "w1", documentos: [{ gcs_url: OWN }], raw_data: { anexos_inventario: { anunciados: 6 } } };

describe("MCP core isolation", () => {
  it("act_id alone works for the owner and verifies bytes", async () => {
    const r = await getActAttachments({ sb: fakeSb([ACT], [{ id: "w1" }]), resolveWorkItem: resolver, fetchImpl: fetchMap({ [OWN]: pdfRes }), act_id: "a1" });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.estado).toBe("parcial"); expect(r.data.faltantes).toBe(5); }
  });
  it("other account (RLS hides act) → not found, no fetch performed", async () => {
    let fetched = false;
    const r = await getActAttachments({ sb: fakeSb([], []), resolveWorkItem: resolver, fetchImpl: async () => { fetched = true; return pdfRes(); }, act_id: "a1" });
    expect(r.ok).toBe(false);
    expect(fetched).toBe(false);
  });
  it("act visible but its matter not visible/deleted → rejected", async () => {
    const r = await getActAttachments({ sb: fakeSb([ACT], []), resolveWorkItem: resolver, fetchImpl: fetchMap({}), act_id: "a1" });
    expect(r.ok).toBe(false);
  });
  it("named matter different from the act's matter → rejected", async () => {
    const r = await getActAttachments({ sb: fakeSb([ACT], [{ id: "w1" }, { id: "w2" }]), resolveWorkItem: resolver, fetchImpl: fetchMap({}), act_id: "a1", work_item_id: "w2" });
    expect(r).toEqual({ ok: false, error: "La actuación no pertenece al asunto indicado." });
  });
});
