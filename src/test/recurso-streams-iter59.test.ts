/**
 * ITER59 — one work item, two provider streams.
 *
 * The 21-digit base is the process (iteration 4.2). The last two digits of the
 * 23-digit radicación are the consecutivo del recurso. Both streams must land
 * in the SAME work item, distinguishable but never split.
 */
import { describe, expect, it } from "vitest";
import {
  PROBED_RECURSO_SUFFIXES,
  instanciaGradoForRadicado,
  radicadoBase21,
  recursoConsecutivo,
  recursoSubscriptionKeys,
  resolveProviderLinkage,
  sameProcess,
} from "../../supabase/functions/_shared/recursoStreams.ts";
import {
  canonicalActFingerprint,
  canonicalPubFingerprint,
} from "../../supabase/functions/_shared/canonicalFingerprint.ts";
import { evaluatePreclusion } from "@/lib/workflows/preclusion-guard";

const ORIGEN = "05001400302820260052100";
const RECURSO = "05001400302820260052101";
const WI = "3f0a1c22-0000-4000-8000-000000000001";

describe("ITER59 — base-21 identity across recurso streams", () => {
  it("keeps ONE process identity for …00 and …01", () => {
    expect(radicadoBase21(ORIGEN)).toBe("050014003028202600521");
    expect(radicadoBase21(RECURSO)).toBe("050014003028202600521");
    expect(sameProcess(ORIGEN, RECURSO)).toBe(true);
  });

  it("reads the consecutivo del recurso and its instancia", () => {
    expect(recursoConsecutivo(ORIGEN)).toBe("00");
    expect(recursoConsecutivo(RECURSO)).toBe("01");
    expect(instanciaGradoForRadicado(ORIGEN)).toBe("PRIMERA");
    expect(instanciaGradoForRadicado(RECURSO)).toBe("SEGUNDA");
  });

  // ITER60 — GCP's probe became adaptive with a cap of "09"; legacy "03"
  // instances exist, so the old 00–02 window is no longer the contract.
  it("mirrors GCP's adaptive probe window 00–09", () => {
    const keys = recursoSubscriptionKeys(ORIGEN);
    expect(keys).toHaveLength(10);
    expect(keys[0]).toBe("05001400302820260052100");
    expect(keys.at(-1)).toBe("05001400302820260052109");
    expect(PROBED_RECURSO_SUFFIXES).toContain("03");
  });
});

describe("ITER59 — provider linkage contract", () => {
  it("prefers the explicit base-21 GCP will emit", () => {
    const l = resolveProviderLinkage({
      radicacion: RECURSO,
      radicacion_base: "050014003028202600521",
      consecutivo_recurso: "01",
      instancia: "SEGUNDA",
      idProceso: 3284580221,
      despacho: "Juzgado 009 Civil del Circuito",
      radicacion_origen: ORIGEN,
    });
    expect(l.base21).toBe("050014003028202600521");
    expect(l.consecutivo).toBe("01");
    expect(l.instancia).toBe("SEGUNDA");
    expect(l.id_proceso).toBe("3284580221");
    expect(l.radicacion_origen).toBe(ORIGEN);
    expect(l.conflict).toBe(false);
  });

  it("falls back to decomposition when the explicit fields are absent", () => {
    const l = resolveProviderLinkage({}, RECURSO);
    expect(l.base21).toBe("050014003028202600521");
    expect(l.instancia).toBe("SEGUNDA");
  });

  it("rejects instead of guessing when declared base contradicts the key", () => {
    const l = resolveProviderLinkage({ radicacion: RECURSO, radicacion_base: "059990000000000000000" });
    expect(l.conflict).toBe(true);
    expect(l.base21).toBeNull();
  });
});

describe("ITER59 — fingerprints tolerate two streams in one work item", () => {
  const base = { work_item_id: WI, act_date: "2026-08-18", actuacion: "Fijacion Estado", party_hint: null };

  it("does not collide across instances on the same day and title", () => {
    const origen = canonicalActFingerprint({ ...base, recurso_consecutivo: "00" });
    const superior = canonicalActFingerprint({ ...base, recurso_consecutivo: "01" });
    expect(origen).not.toBe(superior);
  });

  it("leaves every stored first-instance hash byte-identical", () => {
    const legacy = canonicalActFingerprint(base);
    expect(canonicalActFingerprint({ ...base, recurso_consecutivo: "00" })).toBe(legacy);
    expect(canonicalActFingerprint({ ...base, recurso_consecutivo: null })).toBe(legacy);

    const pub = { work_item_id: WI, pub_date: "2026-08-18", tipo_publicacion: "ESTADO", title: "Auto", party_hint: null };
    expect(canonicalPubFingerprint({ ...pub, recurso_consecutivo: "00" })).toBe(canonicalPubFingerprint(pub));
    expect(canonicalPubFingerprint({ ...pub, recurso_consecutivo: "01" })).not.toBe(canonicalPubFingerprint(pub));
  });
});

describe("ITER59 — stage inference must not regress on the superior's radicación", () => {
  it("blocks 'Radicación Y Reparto' from pushing an advanced matter back", () => {
    const r = evaluatePreclusion({
      workflowType: "CGP",
      currentStage: "ALEGATOS_SENTENCIA",
      currentCgpPhase: "PROCESS",
      suggestedStage: "RADICADO_CONFIRMED",
      suggestedCgpPhase: "FILING",
      docketText: "Radicación Y Reparto — se recibe expediente del juzgado de origen",
    });
    expect(r.decision).toBe("REGRESSION_BLOCKED");
    // blocked ⇒ no stage change is emitted at all
    expect(r.finalStage).toBeNull();
  });
});
