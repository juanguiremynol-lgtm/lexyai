import { describe, expect, it } from "vitest";
import { canonicalActFingerprint, extractPartyDiscriminator } from "../../supabase/functions/_shared/canonicalFingerprint.ts";
import { canonicalActIdentityFromRow } from "../../supabase/functions/_shared/canonicalActMapper.ts";

const WI = "1f90d2e7-2222-4333-8444-555555555555";
const DIVERGENT_PAIRS = [
  ["2023-03-03", "Auto Requiere", "APODERADO JUDICIAL DECRETA MEDIDA CAUTELAR  REQUIERE PARTE ACCIONANTE"],
  ["2023-03-17", "Auto Requiere", "PARTE ACCIONANTE"],
  ["2023-04-26", "Auto Requiere", "PARTE ACCIONANTE"],
  ["2023-05-24", "Auto Requiere", "APODERADO  INFORMA SOBRE TRÁMITE DE RECURSO"],
  ["2023-06-22", "Auto Pone En Conocimiento", "INADMITE REFORMA DEMANDA  REQUIERE DEMANDANTE"],
  ["2023-07-12", "Auto Requiere", "parte demandante"],
  ["2023-08-09", "Auto Requiere", "demandante"],
  ["2023-09-07", "Auto Pone En Conocimiento", "ADMITE REFORMA DEMANDA  DISPONE INTEGRAR CONTRADICTORIO  REQUIERE DEMANDANTE - ORDENA EMPLAZAMIENTO"],
  ["2023-10-11", "Auto Requiere", "demandante"],
  ["2023-10-24", "Auto Requiere", "DEMANDANTE"],
  ["2023-11-16", "Auto Pone En Conocimiento", "TIENE POR NOTIFICADOS ALGUNOS DEMANDADOS  REQUIERE DEMANDANTE  INTEGRA CONTRADICTORIO"],
  ["2024-01-24", "Auto Pone En Conocimiento", "TIENE POR NOTIFICADOS ALGUNOS DEMANDADOS  REQUIERE DEMANDANTE"],
  ["2024-02-08", "Auto Pone En Conocimiento", "TIENE POR NOTIFICADOS ALGUNOSDEMANDADOS  REQUIERE DEMANDANTE"],
  ["2024-05-02", "Auto Pone En Conocimiento", "NOMBRA CURADOR AD-LITEM  REQUIERE DEMANDANTE"],
  ["2024-06-17", "Auto Requiere", "DEMANDANTE"],
] as const;

describe("iteration 25 — legal identity parity", () => {
  it.each(DIVERGENT_PAIRS)("matches provider and stored paths on %s", (date, title, annotation) => {
    const provider = canonicalActFingerprint({ work_item_id: WI, act_date: date, actuacion: title, party_hint: null });
    const stored = canonicalActIdentityFromRow({ act_date: date, description: `${title} - ${annotation}`, raw_data: {} }, WI);
    expect(stored).toBe(provider);
  });

  it("never mines a party discriminator from annotation prose", () => {
    expect(extractPartyDiscriminator("Auto Requiere - REQUIERE PARTE DEMANDANTE", null)).toBe("");
    expect(extractPartyDiscriminator("Auto Requiere", "parte demandante")).toBe("demandante");
  });
});