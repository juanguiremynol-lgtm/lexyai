/**
 * Iteration 3: owner-identity blocklist, name fan-out cap, NDR exclusion and
 * the guarantee that re-sweeps never resurrect a resolved link.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildOwnerIdentity,
  isOwnerIdentityValue,
  isBounceMessage,
  isExcludedMessage,
  matchMessage,
  type GraphMessage,
  type PortfolioItem,
} from "../../supabase/functions/_shared/emailMatcher.ts";

const msg = (m: Partial<GraphMessage>): GraphMessage =>
  ({ id: "m1", subject: "", bodyPreview: "", ...m }) as GraphMessage;
const from = (address: string) => ({ emailAddress: { address } });

const wi = (id: string, over: Partial<PortfolioItem> = {}): PortfolioItem => ({
  id,
  organization_id: null,
  radicado: null,
  authority_name: null,
  authority_email: null,
  demandantes: null,
  demandados: null,
  title: null,
  ...over,
});

const owner = buildOwnerIdentity({ names: ["Juan Guillermo Restrepo Maya"], emails: ["gr@lexetlit.com"] });

describe("FIX 1 — owner identity blocklist", () => {
  it("blocks the owner full name and normalizations", () => {
    for (const v of [
      "JUAN GUILLERMO RESTREPO MAYA",
      "JUAN RESTREPO MAYA",
      "RESTREPO MAYA",
      "LEX ET LITTERAE",
      "LEX ET LIT",
      "gr@lexetlit.com",
    ]) {
      expect(isOwnerIdentityValue(v, owner)).toBe(true);
    }
  });

  it("does not block third-party names", () => {
    expect(isOwnerIdentityValue("MARIA FERNANDA GOMEZ", owner)).toBe(false);
    expect(isOwnerIdentityValue("BANCOLOMBIA S.A.", owner)).toBe(false);
  });

  it("A. personal golf-club mail with owner signature yields zero links", () => {
    const portfolio = Array.from({ length: 12 }, (_, i) =>
      wi(`w${i}`, { client_name: "JUAN GUILLERMO RESTREPO MAYA" }),
    );
    const m = msg({
      subject: "Socio Ausente 1619500 - 230726",
      bodyPreview: "Cordialmente, Juan Guillermo Restrepo Maya - Lex et Litterae",
      from: from("gr@lexetlit.com"),
    });
    expect(matchMessage(m, portfolio, { owner })).toEqual([]);
  });
});

describe("FIX 2 — name fan-out cap", () => {
  it("B1. 5 WIs matched only by third-party name -> zero links", () => {
    const portfolio = Array.from({ length: 5 }, (_, i) =>
      wi(`w${i}`, { client_name: "CONSTRUCTORA ANDINA SAS" }),
    );
    const m = msg({ subject: "Constructora Andina SAS - seguimiento", from: from("x@y.com") });
    expect(matchMessage(m, portfolio, { owner })).toEqual([]);
  });

  it("keeps up to 3 name matches", () => {
    const portfolio = Array.from({ length: 3 }, (_, i) =>
      wi(`w${i}`, { client_name: "CONSTRUCTORA ANDINA SAS" }),
    );
    const m = msg({ subject: "Constructora Andina SAS - seguimiento", from: from("x@y.com") });
    expect(matchMessage(m, portfolio, { owner })).toHaveLength(3);
  });

  it("B2. two valid radicados are exempt from the cap", () => {
    const a = "05001333301520260011300";
    const b = "05380408900320250070600";
    const portfolio = [
      wi("wa", { radicado: a }),
      wi("wb", { radicado: b }),
      ...Array.from({ length: 5 }, (_, i) => wi(`wc${i}`, { client_name: "CONSTRUCTORA ANDINA SAS" })),
    ];
    const m = msg({
      subject: `${a} y ${b} - Constructora Andina SAS`,
      from: from("x@y.com"),
    });
    const res = matchMessage(m, portfolio, { owner });
    expect(res.filter((r) => r.matched_by === "RADICADO")).toHaveLength(2);
    expect(res.filter((r) => r.matched_by === "CLIENTE" || r.matched_by === "PARTE")).toHaveLength(0);
  });
});

describe("FIX 4 — NDR / bounce exclusion", () => {
  const cases: GraphMessage[] = [
    msg({ subject: "No se puede entregar: Memorial", from: from("postmaster@lexetlit.com") }),
    msg({ subject: "Undeliverable: Recurso", from: from("mailer-daemon@outlook.com") }),
    msg({
      subject: "Delivery has failed to these recipients or groups",
      from: from("microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@lexetlit.onmicrosoft.com"),
    }),
    msg({
      subject: "Delivery Status Notification (Failure)",
      from: from("x@y.com"),
      internetMessageId: "<202607061344.abc@microsoft.com>",
    }),
  ];

  it("D. excludes every NDR shape", () => {
    for (const m of cases) {
      expect(isBounceMessage(m)).toBe(true);
      expect(isExcludedMessage(m)).toBe(true);
      expect(matchMessage(m, [wi("w1", { client_name: "CONSTRUCTORA ANDINA SAS" })], { owner })).toEqual([]);
    }
  });

  it("does not exclude a normal judicial mail", () => {
    expect(isBounceMessage(msg({ subject: "Traslado de excepciones", from: from("j03@cendoj.ramajudicial.gov.co") }))).toBe(false);
  });
});

describe("FIX 3c — re-sweeps never resurrect a resolved link", () => {
  it("the sync upsert ignores duplicates on (message_id, work_item_id)", () => {
    const src = readFileSync("supabase/functions/outlook-sync/index.ts", "utf8");
    expect(src).toContain('onConflict: "message_id,work_item_id", ignoreDuplicates: true');
    // No code path may overwrite link_status of an existing row.
    expect(src).not.toMatch(/update\(\{\s*link_status/);
  });
});
