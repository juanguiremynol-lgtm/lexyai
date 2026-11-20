/**
 * JG3 — an estados absence may be REPORTED, never ATTRIBUTED to the court.
 *
 * The lawyer's rule: every process must publish its estados, without
 * exception. Therefore "no hemos recibido estados" is an observation we may
 * state, and "el despacho no publica estados" is a conclusion we may not draw.
 * This test pins both user-facing sites that used to draw it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ESTADO_LECTURA_COPY } from "../../supabase/functions/_shared/pauseNotices.ts";
import {
  ESTADOS_SIGNAL_LABEL,
  ESTADOS_SIGNAL_EXPLANATION,
} from "@/lib/estados-coverage-signal";

const FORBIDDEN = [
  "no publicador",
  "el despacho no publica",
  "se confirma que el despacho no publica",
  "silencio es esperado",
];

describe("JG3 · estados absence is observed, not attributed", () => {
  it("SIN_COBERTURA_DECLARADA states the observation", () => {
    expect(ESTADOS_SIGNAL_LABEL.SIN_COBERTURA_DECLARADA).toBe(
      "Sin estados recibidos de este despacho",
    );
    const copy = ESTADOS_SIGNAL_EXPLANATION.SIN_COBERTURA_DECLARADA;
    expect(copy).toContain("No hemos recibido estados");
    expect(copy).toContain("apunta a nuestra lectura o al proveedor");
    for (const bad of FORBIDDEN) {
      expect(copy.toLowerCase()).not.toContain(bad);
    }
  });

  it("neither the retry drain nor the retained coverage notice attributes silence to the court", () => {
    const src = readFileSync(
      "supabase/functions/process-retry-queue/index.ts",
      "utf8",
    );
    expect(src).not.toContain("SIN_COBERTURA_ESTADOS_CONFIRMADA");
    expect(ESTADO_LECTURA_COPY.SILENCIO_CONOCIDO).toMatch(/sin estados recibidos/i);
    for (const bad of FORBIDDEN) {
      expect(src.toLowerCase()).not.toContain(bad);
      expect(ESTADO_LECTURA_COPY.SILENCIO_CONOCIDO.toLowerCase()).not.toContain(bad);
    }
  });
});
