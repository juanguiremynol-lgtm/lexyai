/**
 * ITER43 — the enrolment allow-list lives upstream; we only mirror it.
 *
 * These tests fail the moment our mirror and the upstream source disagree, so
 * the guard cannot rot into a stale hardcoded list. The fixtures are verbatim
 * transcriptions of the upstream lines; refreshing them is the release ritual.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UPSTREAM_LIFECYCLE_WORKFLOWS,
  UPSTREAM_TERM_DETECTION_WORKFLOWS,
  isUpstreamEnrollable,
  hasUpstreamTermDetection,
  fallbackCapabilities,
} from "@/lib/upstream-capability";

const read = (f: string) =>
  readFileSync(resolve(__dirname, "../__fixtures__/upstream", f), "utf8");

describe("upstream lifecycle allow-list parity", () => {
  it("matches andromeda-read-api LIFECYCLE_WORKFLOWS verbatim", () => {
    const src = read("lifecycle-workflows.js.txt");
    const inner = src.match(/new Set\(\[([^\]]+)\]\)/)?.[1] ?? "";
    const upstream = [...inner.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
    expect(upstream.length).toBeGreaterThan(0);
    expect([...UPSTREAM_LIFECYCLE_WORKFLOWS].sort()).toEqual([...upstream].sort());
  });

  it("matches andromeda-sync-job detectar_termino filter verbatim", () => {
    const src = read("term-detection-workflows.sql.txt");
    const inner = src.match(/IN \(([^)]+)\)/)?.[1] ?? "";
    const upstream = [...inner.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
    expect([...UPSTREAM_TERM_DETECTION_WORKFLOWS].sort()).toEqual([...upstream].sort());
  });
});

describe("capability gate fails closed", () => {
  it("admits EJECUTIVO now that upstream enrols it (ITER44)", () => {
    expect(isUpstreamEnrollable("EJECUTIVO")).toBe(true);
  });

  it("allows the áreas upstream accepts", () => {
    for (const wf of UPSTREAM_LIFECYCLE_WORKFLOWS) {
      expect(isUpstreamEnrollable(wf)).toBe(true);
    }
  });

  it("treats unknown or empty áreas as not enrollable", () => {
    expect(isUpstreamEnrollable(null)).toBe(false);
    expect(isUpstreamEnrollable("")).toBe(false);
    expect(isUpstreamEnrollable("NUEVA_AREA")).toBe(false);
  });

  it("honours a live register that widens the set", () => {
    const live = [
      { workflow_type: "NUEVA_AREA", lifecycle_enrollable: true, term_detection: false },
    ];
    expect(isUpstreamEnrollable("NUEVA_AREA", live)).toBe(true);
  });

  it("reports upstream term detection as a permanent absence for every área", () => {
    for (const wf of ["CGP", "CPACA", "EJECUTIVO", "PENAL_906", "LABORAL", "TUTELA"]) {
      expect(hasUpstreamTermDetection(wf)).toBe(false);
    }
  });

  it("covers every mirrored área in the fallback register", () => {
    const rows = fallbackCapabilities();
    expect(rows.find((r) => r.workflow_type === "EJECUTIVO")?.lifecycle_enrollable).toBe(true);
    expect(rows.every((r) => typeof r.term_detection === "boolean")).toBe(true);
  });
});
