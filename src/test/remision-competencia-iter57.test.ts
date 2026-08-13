import { describe, it, expect } from "vitest";
import {
  classifyRemisionText,
  classifyRemisionStream,
  extractDestinoDespacho,
  resolveDespachoCodeFromName,
  relationForRemision,
  remisionOpensTerm,
} from "../../supabase/functions/_shared/remisionCompetencia.ts";
import {
  classifyCpacaTerminal,
  terminalSilencesEstados,
} from "../../supabase/functions/_shared/cpacaTerminalSentinel.ts";

describe("iteración 57 — remisión por competencia", () => {
  it("distingue la remisión horizontal de la vertical", () => {
    expect(classifyRemisionText("Auto Pone En Conocimiento - Pone en conocimiento-remite").klass)
      .toBe("REMITIDO_POR_COMPETENCIA");
    expect(classifyRemisionText("Auto declara la falta de competencia y remite el expediente").klass)
      .toBe("REMITIDO_POR_COMPETENCIA");
    expect(classifyRemisionText("Envío a superior — remisión del expediente").klass)
      .toBe("REMITIDO_AL_SUPERIOR");
    expect(classifyRemisionText("Auto que fija fecha de audiencia inicial").klass).toBe("NO_REMISION");
  });

  it("la incompetencia gana sobre el vocabulario genérico de remisión", () => {
    const v = classifyRemisionText(
      "El juzgado se declara incompetente y remite el expediente para su conocimiento",
    );
    expect(v.klass).toBe("REMITIDO_POR_COMPETENCIA");
  });

  it("prioriza la competencia en un flujo de actuaciones", () => {
    const v = classifyRemisionStream([
      "Auto de trámite",
      "Remite el expediente",
      "Conflicto negativo de competencia",
    ]);
    expect(v.klass).toBe("REMITIDO_POR_COMPETENCIA");
  });

  it("extrae el despacho destino y deriva el código sólo cuando puede", () => {
    const d = extractDestinoDespacho(
      "Remitir la presente demanda al Juzgado 09 de Pequeñas Causas y Competencia Múltiple de Medellín para su conocimiento",
    );
    expect(d.nombre).toContain("Juzgado 09");
    expect(d.codigo).toBe("050014189009");
    expect(d.codigo_status).toBe("RESUELTO");
  });

  it("nunca adivina un código: declara el motivo", () => {
    const r = resolveDespachoCodeFromName("Juzgado 03 Promiscuo de Nowhere");
    expect(r.codigo).toBeNull();
    expect(r.codigo_status).toBe("NO_RESUELTO");
    expect(r.codigo_motivo).toMatch(/No se pudo derivar/);
  });

  it("no abre ningún término (art. 139 CGP)", () => {
    expect(remisionOpensTerm("REMITIDO_POR_COMPETENCIA")).toBe(false);
    expect(remisionOpensTerm("REMITIDO_AL_SUPERIOR")).toBe(false);
  });

  it("mapea la clase a la relación de sucesión", () => {
    expect(relationForRemision("REMITIDO_POR_COMPETENCIA")).toBe("REMISION_COMPETENCIA");
    expect(relationForRemision("REMITIDO_AL_SUPERIOR")).toBe("SEGUNDA_INSTANCIA");
    expect(relationForRemision("NO_REMISION")).toBeNull();
  });

  it("el centinela CPACA delega la dirección y ambas remisiones silencian estados", () => {
    const horiz = classifyCpacaTerminal({
      etapa: "Finalizado",
      act_descriptions: ["Remite el expediente por competencia al juzgado administrativo"],
    });
    expect(horiz.klass).toBe("REMISION_COMPETENCIA");
    expect(terminalSilencesEstados(horiz)).toBe(true);

    const vert = classifyCpacaTerminal({
      etapa: "Finalizado",
      act_descriptions: ["Envío a superior — Remisión del expediente al Tribunal"],
    });
    expect(vert.klass).toBe("REMISION");
    expect(terminalSilencesEstados(vert)).toBe(true);
  });
});