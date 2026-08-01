/**
 * Iteration 5 — universal body reading + AI semantic layer.
 *
 * Privacy invariant under test: nothing body-derived is persisted except
 * identifiers, subtype, a <=200-char summary and timestamps.
 */
import { describe, expect, it } from "vitest";
import {
  bodyToText,
  extractBodyRadicadoCandidates,
  extractNij,
  isJudicialCounterpart,
  isJudicialAddress,
  BODY_TEXT_CAP,
} from "../../supabase/functions/_shared/emailMatcher.ts";
import {
  parseAiClassification,
  aiClassifyEmail,
  newAiGatewayState,
  AI_CALLS_PER_RUN,
  AI_CONFIDENCE_CAP,
} from "../../supabase/functions/_shared/aiClassifyEmail.ts";

/** Cuerpo real del mensaje insignia (citación a audiencia de preclusión). */
const FLAGSHIP_BODY = `
<html><body><p>Buenas tardes,</p>
<p>REF.: 08001600125720253122600-</p>
<p>NIJ: 2026-034</p>
<p>Citaci&oacute;n a audiencia de PRECLUSI&Oacute;N para el d&iacute;a 20 de agosto de 2026 a las 9:00 a.m.</p>
</body></html>`;

describe("Parte A — lectura universal del cuerpo", () => {
  it("convierte HTML a texto plano acotado", () => {
    const text = bodyToText(FLAGSHIP_BODY);
    expect(text).toContain("REF.: 08001600125720253122600");
    expect(text).toContain("PRECLUSIÓN");
    expect(text).not.toContain("<p>");
    expect(text.length).toBeLessThanOrEqual(BODY_TEXT_CAP);
  });

  it("respeta el tope de 20KB", () => {
    expect(bodyToText("x".repeat(50_000)).length).toBe(BODY_TEXT_CAP);
  });

  it("extrae el radicado de la línea REF del mensaje insignia", () => {
    const candidates = extractBodyRadicadoCandidates(FLAGSHIP_BODY);
    const canonicals = candidates.map((c) => c.canonical);
    expect(canonicals).toContain("08001600125720253122600");
    expect(candidates[0].base).toBe("080016001257202531226");
  });

  it("reconoce el ancla EXPEDIENTE", () => {
    const c = extractBodyRadicadoCandidates("EXPEDIENTE: 05001-31-03-006-2026-00280-00");
    expect(c.map((x) => x.canonical)).toContain("05001310300620260028000");
  });

  it("captura el NIJ como metadato secundario", () => {
    expect(extractNij(FLAGSHIP_BODY)).toBe("2026-034");
    expect(extractNij("sin identificadores")).toBeNull();
  });

  it("detecta contraparte judicial en ambas direcciones", () => {
    expect(
      isJudicialCounterpart({
        id: "1",
        from: { emailAddress: { address: "j04pctoconbqlla@cendoj.ramajudicial.gov.co" } },
      }),
    ).toBe(true);
    expect(
      isJudicialCounterpart({
        id: "2",
        from: { emailAddress: { address: "abogado@lexetlit.com" } },
        toRecipients: [{ emailAddress: { address: "j01civil@cendoj.ramajudicial.gov.co" } }],
      }),
    ).toBe(true);
    expect(
      isJudicialCounterpart({
        id: "3",
        from: { emailAddress: { address: "cliente@gmail.com" } },
        toRecipients: [{ emailAddress: { address: "abogado@lexetlit.com" } }],
      }),
    ).toBe(false);
    expect(isJudicialAddress(null)).toBe(false);
  });
});

describe("Parte B — validación estricta de la salida del modelo", () => {
  it("acepta un JSON válido y normaliza los campos", () => {
    const out = parseAiClassification(JSON.stringify({
      subtype: "CITACION_AUDIENCIA",
      radicados: ["08001-6001257-2025-31226-00", "basura"],
      instancia: "1",
      audiencia_fecha: "2026-08-20T09:00:00-05:00",
      termino_dias: 5,
      resumen: "Citación a audiencia de preclusión.",
    }));
    expect(out?.subtype).toBe("CITACION_AUDIENCIA");
    expect(out?.radicados).toEqual(["08001600125720253122600"]);
    expect(out?.instancia).toBe("01");
    expect(out?.audiencia_fecha).toBe("2026-08-20T09:00:00-05:00");
    expect(out?.termino_dias).toBe(5);
  });

  it("tolera cercas de markdown", () => {
    const out = parseAiClassification('```json\n{"subtype":"TRASLADO","resumen":"x"}\n```');
    expect(out?.subtype).toBe("TRASLADO");
  });

  it("degrada a null ante subtipo fuera del enum, JSON roto o vacío", () => {
    expect(parseAiClassification('{"subtype":"INVENTADO"}')).toBeNull();
    expect(parseAiClassification("no soy json")).toBeNull();
    expect(parseAiClassification(null)).toBeNull();
  });

  it("recorta el resumen a 200 caracteres", () => {
    const out = parseAiClassification(JSON.stringify({
      subtype: "OTRO_JUDICIAL",
      resumen: "a".repeat(500),
    }));
    expect(out?.resumen.length).toBe(200);
  });

  it("descarta fechas de audiencia no parseables y términos absurdos", () => {
    const out = parseAiClassification(JSON.stringify({
      subtype: "CITACION_AUDIENCIA",
      audiencia_fecha: "el jueves",
      termino_dias: 9999,
      resumen: "x",
    }));
    expect(out?.audiencia_fecha).toBeNull();
    expect(out?.termino_dias).toBeNull();
  });
});

describe("Guardas de costo y degradación", () => {
  it("no llama al gateway sin API key", async () => {
    const state = newAiGatewayState();
    expect(await aiClassifyEmail({ subject: "x", bodyText: "y" }, state, undefined)).toBeNull();
    expect(state.calls).toBe(0);
  });

  it("respeta el tope de llamadas por corrida", async () => {
    const state = newAiGatewayState();
    state.calls = AI_CALLS_PER_RUN;
    expect(await aiClassifyEmail({ subject: "x", bodyText: "y" }, state, "k")).toBeNull();
    expect(state.calls).toBe(AI_CALLS_PER_RUN);
  });

  it("no vuelve a llamar tras quedarse sin crédito", async () => {
    const state = newAiGatewayState();
    state.disabled = true;
    expect(await aiClassifyEmail({ subject: "x", bodyText: "y" }, state, "k")).toBeNull();
    expect(state.calls).toBe(0);
  });

  it("la confianza de la IA nunca supera el tope ratificado", () => {
    expect(AI_CONFIDENCE_CAP).toBeLessThanOrEqual(0.75);
  });
});

describe("Privacidad — el cuerpo nunca se persiste", () => {
  it("la salida validada no contiene el texto del cuerpo", () => {
    const body = bodyToText(FLAGSHIP_BODY);
    const out = parseAiClassification(JSON.stringify({
      subtype: "CITACION_AUDIENCIA",
      radicados: ["08001600125720253122600"],
      instancia: null,
      audiencia_fecha: "2026-08-20T09:00:00-05:00",
      termino_dias: null,
      resumen: "Citación a audiencia de preclusión.",
    }))!;
    const persisted = Object.keys(out).sort();
    expect(persisted).toEqual([
      "audiencia_fecha",
      "instancia",
      "radicados",
      "resumen",
      "subtype",
      "termino_dias",
    ]);
    expect(JSON.stringify(out)).not.toContain(body.slice(0, 60));
    expect(out.resumen.length).toBeLessThanOrEqual(200);
  });
});
