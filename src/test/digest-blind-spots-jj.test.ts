/**
 * Iteration JJ — the three silences this block closes.
 *
 *  JJ1  the firm-side email channel can go down without anyone being told,
 *  JJ2  a matter can be suspended while the lawyer believes it is monitored,
 *  JJ3  a petición is not a judicial process and must never reach a scraper,
 *  JJ5  Lexy and the ticker must read the same monitored universe as the digest.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const digestIndex = read("supabase/functions/scheduled-daily-digest/index.ts");
const digestHtml = read("supabase/functions/scheduled-daily-digest/html.ts");
const digestTypes = read("supabase/functions/scheduled-daily-digest/types.ts");

describe("JJ1 — mailbox connection is a headline condition", () => {
  it("reads the connection state and classifies error, expiry and pre-expiry", () => {
    expect(digestIndex).toMatch(/from\("user_email_connections"\)/);
    expect(digestIndex).toMatch(/"ERROR"/);
    expect(digestIndex).toMatch(/expiringSoon/);
    // JJ1(d): 7-day warning window, before expiry.
    expect(digestIndex).toMatch(/7 \* 86_400_000/);
  });

  it("renders the connection block before novedades", () => {
    const conn = digestHtml.indexOf("${connectionBlock(");
    const nov = digestHtml.indexOf("${novedadesBlock(");
    expect(conn).toBeGreaterThan(-1);
    expect(conn).toBeLessThan(nov);
  });

  it("marks a broken connection in the subject line", () => {
    expect(digestIndex).toMatch(/Conexión de correo caída/);
  });
});

describe("OO1 — hidden matters are surfaced accurately (still being read)", () => {
  it("queries hidden matters and never mixes them into novedades", () => {
    expect(digestIndex).toMatch(/not\("monitoring_suspended_at", "is", null\)/);
    expect(digestIndex).toMatch(/is\("deleted_at", null\)/);
    expect(digestHtml).toMatch(/Monitoreo oculto — no aparecen en este resumen/);
  });

  it("states plainly that nothing is being lost, and never claims reading stopped", () => {
    expect(digestHtml).toMatch(/se siguen consultando con sus proveedores/);
    expect(digestHtml).not.toMatch(/no se está consultando/);
  });

  it("warns about an accumulating gap only when ingestion is off", () => {
    expect(digestHtml).toMatch(/No — lectura detenida/);
    expect(digestHtml).toMatch(/acumulando un vacío/);
    expect(digestIndex).toMatch(/reading_active: s\.lifecycle_state === "ACTIVE"/);
  });

  it("reports movement accumulated since the matter was hidden", () => {
    expect(digestHtml).toMatch(/Movimiento desde entonces/);
    expect(digestIndex).toMatch(/acts_since/);
    expect(digestIndex).toMatch(/estados_since/);
  });


  it("does not offer to reactivate anything", () => {
    expect(digestHtml).not.toMatch(/reactivar ahora|Reactivar →/i);
  });
});

describe("JJ3 — non-judicial workflows", () => {
  it("names PETICION and GOV_PROCEDURE as non-judicial in one place", () => {
    expect(digestTypes).toMatch(/NON_JUDICIAL_WORKFLOWS = \["PETICION", "GOV_PROCEDURE"\]/);
  });

  it("never sends them to provider tables", () => {
    expect(digestIndex).toMatch(/judicialIds/);
    expect(digestIndex).toMatch(/from\("work_item_acts"\)[\s\S]{0,400}judicialIds/);
    expect(digestIndex).toMatch(/from\("work_item_publicaciones"\)[\s\S]{0,400}judicialIds/);
  });

  it("gives them their own section and their own count", () => {
    expect(digestHtml).toMatch(/Peticiones y actuaciones administrativas/);
    expect(digestHtml).toMatch(/Las dos cifras no se suman/);
  });

  it("keeps the provider routing table ineligible for both", () => {
    const routing = read("supabase/functions/_shared/providerRouting.ts");
    expect(routing).toMatch(/PETICION:\s*\{ actuaciones: \[\], estados: \[\], eligible: false/);
    expect(routing).toMatch(/GOV_PROCEDURE:\s*\{ actuaciones: \[\], estados: \[\], eligible: false/);
  });
});

describe("JJ5 — one monitored universe across the product", () => {
  it("Lexy picks recipients from the canonical view", () => {
    const lexy = read("supabase/functions/lexy-daily-message/index.ts");
    expect(lexy).toMatch(/from\("v_monitored_work_items"\)/);
    expect(lexy).toMatch(/is\("work_items\.deleted_at", null\)/);
    expect(lexy).toMatch(/is\("work_items\.monitoring_suspended_at", null\)/);
  });

  it("the ticker applies the same predicate on every query", () => {
    const ticker = read("src/lib/services/ticker-data-service.ts");
    const occurrences = ticker.match(/work_items\.monitoring_suspended_at/g) ?? [];
    expect(occurrences.length).toBe(3);
    expect(ticker).toMatch(/work_items\.deleted_at/);
  });
});
