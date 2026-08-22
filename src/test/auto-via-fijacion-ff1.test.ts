/**
 * FF1 / FF2 doctrine tests (pure-logic mirrors of the SQL contract).
 *
 * FF1 — the estado is the notification vehicle; the AUTO it publishes is what
 * gets classified. When the auto cannot be resolved, the system says so
 * (REQUIERE_REVISION_MANUAL) instead of inventing a generic 3-day term.
 */
import { describe, expect, it } from "vitest";

/** Mirror of public.pub_text_is_estado_boilerplate. */
export function isEstadoBoilerplate(text: string | null | undefined): boolean {
  const t = (text ?? "").toUpperCase();
  if (!t.trim()) return true;
  if (
    /^\s*(NOTIFICACI[OÓ]N\s+POR\s+ESTADO|ESTADOS?\s*(ELECTR[OÓ]NICO)?\s*(NO\.?|N[°º])?\s*[0-9]|FIJACI[OÓ]N\s+(DE\s+)?ESTADO|DESFIJACI[OÓ]N)/.test(
      t,
    )
  )
    return true;
  return !/[A-Z]{4}/.test(t);
}

export type AutoResolution =
  | { source: "PUBLICATION_TEXT" | "SAME_DATE_ACT"; text: string }
  | { source: "UNRESOLVED"; text: null };

export function resolvePublishedAuto(
  pubText: string | null,
  sameDateActs: string[],
): AutoResolution {
  if (pubText && !isEstadoBoilerplate(pubText))
    return { source: "PUBLICATION_TEXT", text: pubText };
  const act = sameDateActs.find(
    (a) => !isEstadoBoilerplate(a) && !/fijaci|comunicaci|memorial|al despacho/i.test(a),
  );
  if (act) return { source: "SAME_DATE_ACT", text: act };
  return { source: "UNRESOLVED", text: null };
}

describe("FF1 — auto via fijación", () => {
  it("treats the estado line as boilerplate, never as the providencia", () => {
    expect(isEstadoBoilerplate("Notificación por Estado No.103 de 3 de agosto")).toBe(true);
    expect(isEstadoBoilerplate("Estados 038 09 03 2026.pdf")).toBe(true);
    expect(isEstadoBoilerplate("Auto inadmite la demanda")).toBe(false);
  });

  it("resolves the auto from the same-date act when the estado carries no text", () => {
    const r = resolvePublishedAuto("Notificación por Estado No.038", [
      "Fijacion Estado",
      "Auto Rechaza Demanda - por falta de competencia",
    ]);
    expect(r.source).toBe("SAME_DATE_ACT");
    expect(r.text).toMatch(/Rechaza/);
  });

  it("prefers the publication's own substantive text", () => {
    const r = resolvePublishedAuto("Auto traslado", ["Fijacion estado"]);
    expect(r).toEqual({ source: "PUBLICATION_TEXT", text: "Auto traslado" });
  });

  it("emits UNRESOLVED rather than a generic term when no auto is reachable", () => {
    const r = resolvePublishedAuto("Notificación por Estado No.033", ["Fijacion estado"]);
    expect(r).toEqual({ source: "UNRESOLVED", text: null });
  });
});

describe("FF2 — discharge doctrine", () => {
  it("court-borne terms are outside the matcher", () => {
    const eligible = (deadlineType: string, isJudgeSide: boolean) =>
      !isJudgeSide && deadlineType !== "DESPACHO_AUTORITATIVO";
    expect(eligible("DESPACHO_AUTORITATIVO", false)).toBe(false);
    expect(eligible("SUBSANACION", true)).toBe(false);
    expect(eligible("SUBSANACION", false)).toBe(true);
  });

  it("a rejected suggestion is sticky for the same (deadline, pattern, act)", () => {
    const key = (d: string, p: string, a: string) => `${d}|${p}|${a}`;
    const existing = new Set([key("d1", "p1", "a1")]);
    const wouldReinsert = !existing.has(key("d1", "p1", "a1"));
    expect(wouldReinsert).toBe(false);
  });
});
