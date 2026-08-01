import { describe, it, expect } from "vitest";
import {
  classifyRecency,
  retroGapDays,
  isSweepRunMode,
  NEWS_DISCOVERY_TYPES,
} from "../../../supabase/functions/_shared/recencyClassifier";

const NOW = new Date("2026-07-27T19:00:00Z"); // Bogotá 2026-07-27 14:00

describe("iteration 8.2 — retroactive actuaciones", () => {
  it("classifies a fresh legal date as NOVEDAD", () => {
    expect(classifyRecency({ legal_date: "2026-07-27", detected_at: NOW, now: NOW })).toBe("NOVEDAD");
  });

  it("classifies an old legal date detected in a DAILY run as ACTUACION_RETROACTIVA", () => {
    expect(classifyRecency({ legal_date: "2025-07-10", detected_at: NOW, now: NOW })).toBe(
      "ACTUACION_RETROACTIVA",
    );
  });

  it("classifies the same row as HISTORICO_DETECTADO when it comes from a sweep", () => {
    expect(
      classifyRecency({ legal_date: "2025-07-10", detected_at: NOW, is_sweep: true, now: NOW }),
    ).toBe("HISTORICO_DETECTADO");
    expect(
      classifyRecency({ legal_date: "2025-07-10", detected_at: NOW, run_mode: "IMPORT", now: NOW }),
    ).toBe("HISTORICO_DETECTADO");
  });

  it("never treats a missing legal date as news", () => {
    expect(classifyRecency({ legal_date: null, detected_at: NOW, now: NOW })).toBe(
      "HISTORICO_DETECTADO",
    );
  });

  it("counts retroactive rows as news", () => {
    expect(NEWS_DISCOVERY_TYPES).toContain("ACTUACION_RETROACTIVA");
    expect(NEWS_DISCOVERY_TYPES).not.toContain("HISTORICO_DETECTADO");
  });

  it("computes the detection gap in days", () => {
    expect(retroGapDays("2025-07-10", NOW)).toBe(382);
    expect(retroGapDays(null, NOW)).toBeNull();
  });

  it("recognises sweep run modes", () => {
    expect(isSweepRunMode("sweep")).toBe(true);
    expect(isSweepRunMode("DAILY")).toBe(false);
    expect(isSweepRunMode(undefined)).toBe(false);
  });
});
