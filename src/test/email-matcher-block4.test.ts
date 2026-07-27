/**
 * Block 4 polish pack: judicial domain trust, SGDE datetime parsing, SGDE token
 * low-content, Alfresco/TYBA expediente links and weekly self-report exclusion.
 */
import { describe, expect, it } from "vitest";
import {
  JUDICIAL_DOMAINS,
  parseAllowedUntil,
  parseSgdeEvidence,
  isLowContentMessage,
  extractExpedienteAccessUrl,
  isExcludedMessage,
  type GraphMessage,
} from "../../supabase/functions/_shared/emailMatcher.ts";

const msg = (m: Partial<GraphMessage>): GraphMessage =>
  ({ id: "m1", subject: "", bodyPreview: "", ...m }) as GraphMessage;

const from = (address: string) => ({ emailAddress: { address } });

describe("4.1 JUDICIAL_DOMAINS", () => {
  it("includes cortesuprema and deaj", () => {
    expect(JUDICIAL_DOMAINS).toContain("cortesuprema.gov.co");
    expect(JUDICIAL_DOMAINS).toContain("deaj.ramajudicial.gov.co");
  });
});

describe("4.2 parseSgdeEvidence datetime", () => {
  it("Indefinido -> null", () => {
    expect(parseAllowedUntil("Consulta permitida hasta: Indefinido")).toBeNull();
  });
  it("date only -> ISO date", () => {
    expect(parseAllowedUntil("Consulta permitida hasta 31-07-2026")).toBe("2026-07-31");
  });
  it("date + time -> ISO datetime (real strings)", () => {
    expect(parseAllowedUntil("Consulta permitida hasta: 31-07-2026 11:32")).toBe(
      "2026-07-31T11:32:00-05:00",
    );
    expect(parseAllowedUntil("Consulta permitida hasta: 01-08-2026 15:50")).toBe(
      "2026-08-01T15:50:00-05:00",
    );
  });
  it("propagates through parseSgdeEvidence", () => {
    const e = parseSgdeEvidence(
      msg({ subject: "Se le ha compartido información de proceso judicial" }),
      "Consulta permitida hasta: 01-08-2026 15:50",
    );
    expect(e.allowed_until).toBe("2026-08-01T15:50:00-05:00");
  });
});

describe("4.3 SGDE token mail is low_content", () => {
  it("marks token validación mail", () => {
    expect(
      isLowContentMessage(
        msg({
          subject: "Token validación de acceso al expediente electrónico",
          from: from("notificacionessgde@cendoj.ramajudicial.gov.co"),
        }),
      ),
    ).toBe(true);
  });
  it("does not mark the ordinary SGDE share mail", () => {
    expect(
      isLowContentMessage(
        msg({
          subject: "Se le ha compartido información de proceso judicial",
          from: from("notificacionessgde@cendoj.ramajudicial.gov.co"),
        }),
      ),
    ).toBe(false);
  });
});

describe("4.4 Alfresco / TYBA expediente links", () => {
  const judicial = from("j03prmpalestrella@cendoj.ramajudicial.gov.co");
  it("accepts alfresco share links from a judicial sender", () => {
    expect(
      extractExpedienteAccessUrl(
        msg({ from: judicial }),
        "Acceda en https://alfresco.ramajudicial.gov.co/share/s/aBc-123_x",
      ),
    ).toBe("https://alfresco.ramajudicial.gov.co/share/s/aBc-123_x");
  });
  it("accepts TYBA links", () => {
    expect(
      extractExpedienteAccessUrl(
        msg({ from: judicial }),
        "https://tyba.ramajudicial.gov.co/consulta/12345",
      ),
    ).toBe("https://tyba.ramajudicial.gov.co/consulta/12345");
  });
  it("rejects non-allowlisted hosts", () => {
    expect(
      extractExpedienteAccessUrl(msg({ from: judicial }), "https://drive.google.com/file/d/x"),
    ).toBeNull();
  });
  it("rejects links from non-judicial senders", () => {
    expect(
      extractExpedienteAccessUrl(
        msg({ from: from("alguien@gmail.com") }),
        "https://alfresco.ramajudicial.gov.co/share/s/x",
      ),
    ).toBeNull();
  });
});

describe("4.5 weekly self-report exclusion", () => {
  it("excludes Informe semanal self-sent digest", () => {
    expect(
      isExcludedMessage(
        msg({
          subject: "Informe semanal de procesos – corte 17 de julio de 2026",
          from: from("gr@lexetlit.com"),
          toRecipients: [from("gr@lexetlit.com")],
        }),
        "gr@lexetlit.com",
      ),
    ).toBe(true);
  });
  it("keeps a normal self-sent note with one radicado", () => {
    expect(
      isExcludedMessage(
        msg({
          subject: "Nota 05001333301520260011300",
          from: from("gr@lexetlit.com"),
          toRecipients: [from("gr@lexetlit.com")],
        }),
        "gr@lexetlit.com",
      ),
    ).toBe(false);
  });
});
