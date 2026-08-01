import { describe, it, expect } from "vitest";
import { messageRadicadoBases } from "../../supabase/functions/_shared/emailMatcher.ts";

describe("iteración 7.2 — unión de radicados asunto + cuerpo", () => {
  it("extrae el radicado espaciado del asunto del curador", () => {
    const bases = messageRadicadoBases(
      "NOTIFICACIÓN CURADOR AD LITEM DIVORCIO 110013110013 2024 00752 00",
    );
    expect(bases).toContain("110013110013202400752");
  });

  it("une los radicados del asunto con los del cuerpo (REF.:)", () => {
    const bases = messageRadicadoBases(
      "Respuesta automática: 11001311001320240075200",
      "REF.: 05376311200120230031400 - memorial",
    );
    expect(bases).toContain("110013110013202400752");
    expect(bases).toContain("053763112001202300314");
  });

  it("no inventa bases cuando el correo no nombra proceso", () => {
    expect(messageRadicadoBases("Boletín semanal", "sin identificadores")).toEqual([]);
  });
});
