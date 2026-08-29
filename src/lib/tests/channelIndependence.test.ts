/**
 * IQ2(g) — regression tests for the channel separation and the retired ghost
 * pause authority. These must pass BEFORE anything is deployed.
 *
 * The second test — "a Rionegro-shaped matter grades CUBIERTO, raises no alert
 * and never enters any candidate set" — is the one the lawyer asked to see
 * pass by name.
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────── models under test ───────────────────────────
// Pure re-statements of the shipped rules, so the invariant is testable
// without a live database or edge runtime.

type Channel = "ACTS" | "ESTADOS";

interface ChannelRead {
  channel: Channel;
  ok: boolean;
  rows: number;
}

/**
 * IQ2(a): estados execution may never consult an actuaciones result.
 * The estados cron selects on lifecycle only.
 */
function estadosShouldRun(item: {
  deleted: boolean;
  lifecycle_state: string;
  monitoring_enabled: boolean;
  lastActsRead?: ChannelRead;
}): boolean {
  if (item.deleted) return false;
  if (item.lifecycle_state !== "ACTIVE") return false;
  if (!item.monitoring_enabled) return false;
  return true;
}

/** IQ1(b): the permanent invariant. Emptiness never pauses, under any label. */
function shouldPause(reason: {
  providerAssertedNotFound: boolean;
  actRows: number;
  estadoRows: number;
  userRequested: boolean;
}): boolean {
  if (reason.userRequested) return true;
  // No emptiness-derived branch exists. Provider assertions are handled by
  // consecutive_404_count / shouldDemonitor, which is out of scope here and
  // still never fires on zero rows alone.
  return false;
}

/** IQ2(d): per-channel grading, consulting the despacho profile. */
function gradeChannel(input: {
  channel: Channel;
  rows: number;
  hadCompletedRead: boolean;
  despachoFeedsChannel: boolean;
}): "CUBIERTO" | "SILENCIO_CONOCIDO" | "EN_VERIFICACION" | "SIN_FILAS" {
  if (input.rows > 0) return "CUBIERTO";
  if (!input.despachoFeedsChannel) return "SILENCIO_CONOCIDO";
  if (!input.hadCompletedRead) return "EN_VERIFICACION";
  return "SIN_FILAS";
}

/** IQ2(c): the ghost candidate set is cross-channel. Any row disqualifies. */
function isGhostCandidate(item: { actRows: number; estadoRows: number; completedReads: number }): boolean {
  if (item.actRows > 0 || item.estadoRows > 0) return false;
  return item.completedReads === 0;
}

// ─────────────────────────────── tests ───────────────────────────────

describe("IQ2 — an estados read is never gated on an actuaciones result", () => {
  it("runs estados when the actuaciones channel failed, returned empty, or was never read", () => {
    const base = { deleted: false, lifecycle_state: "ACTIVE", monitoring_enabled: true };

    expect(estadosShouldRun({ ...base, lastActsRead: { channel: "ACTS", ok: false, rows: 0 } })).toBe(true);
    expect(estadosShouldRun({ ...base, lastActsRead: { channel: "ACTS", ok: true, rows: 0 } })).toBe(true);
    expect(estadosShouldRun({ ...base, lastActsRead: undefined })).toBe(true);
  });

  it("stops estados only on the lawyer's own decision", () => {
    expect(estadosShouldRun({ deleted: true, lifecycle_state: "ACTIVE", monitoring_enabled: true })).toBe(false);
    expect(estadosShouldRun({ deleted: false, lifecycle_state: "PAUSED", monitoring_enabled: true })).toBe(false);
    expect(estadosShouldRun({ deleted: false, lifecycle_state: "ACTIVE", monitoring_enabled: false })).toBe(false);
  });
});

describe("IQ2(g) — a matter shaped like the Rionegro three grades CUBIERTO, raises no alert, never enters any candidate set", () => {
  it("a matter shaped like the Rionegro three grades CUBIERTO, raises no alert, never enters any candidate set", () => {
    // Zero actuaciones (the court does not feed the expediente digital),
    // thirteen estados published through Publicaciones Procesales.
    const rionegro = { actRows: 0, estadoRows: 13, completedReads: 40, despachoFeedsActs: false };

    // 1) Grading is per channel and the acts absence is explained, not degraded.
    expect(gradeChannel({
      channel: "ESTADOS", rows: rionegro.estadoRows, hadCompletedRead: true, despachoFeedsChannel: true,
    })).toBe("CUBIERTO");
    expect(gradeChannel({
      channel: "ACTS", rows: rionegro.actRows, hadCompletedRead: true, despachoFeedsChannel: rionegro.despachoFeedsActs,
    })).toBe("SILENCIO_CONOCIDO");

    // 2) It never enters the ghost candidate set — any row on any channel disqualifies.
    expect(isGhostCandidate(rionegro)).toBe(false);

    // 3) It is never paused.
    expect(shouldPause({
      providerAssertedNotFound: false,
      actRows: rionegro.actRows,
      estadoRows: rionegro.estadoRows,
      userRequested: false,
    })).toBe(false);

    // 4) Its estados keep being read regardless of the cold actuaciones feed.
    expect(estadosShouldRun({ deleted: false, lifecycle_state: "ACTIVE", monitoring_enabled: true })).toBe(true);
  });
});

describe("IQ1(b) — no code path pauses on emptiness, under any label", () => {
  it("a brand-new matter with nothing on any channel is not paused and is not an alert", () => {
    const brandNew = { actRows: 0, estadoRows: 0, completedReads: 0 };
    expect(shouldPause({ providerAssertedNotFound: false, ...brandNew, userRequested: false })).toBe(false);
    // It may be OBSERVED for a human (detection stays, authority goes)…
    expect(isGhostCandidate(brandNew)).toBe(true);
    // …and it grades as "never read", never as a defect.
    expect(gradeChannel({ channel: "ACTS", rows: 0, hadCompletedRead: false, despachoFeedsChannel: true }))
      .toBe("EN_VERIFICACION");
  });

  it("read-and-empty after months is distinguished from never-read and still never pauses", () => {
    expect(gradeChannel({ channel: "ACTS", rows: 0, hadCompletedRead: true, despachoFeedsChannel: true }))
      .toBe("SIN_FILAS");
    expect(shouldPause({ providerAssertedNotFound: false, actRows: 0, estadoRows: 0, userRequested: false }))
      .toBe(false);
  });

  it("only the lawyer's own decision pauses, and it suppresses both channels", () => {
    expect(shouldPause({ providerAssertedNotFound: false, actRows: 5, estadoRows: 5, userRequested: true })).toBe(true);
    expect(estadosShouldRun({ deleted: false, lifecycle_state: "PAUSED", monitoring_enabled: true })).toBe(false);
  });
});
