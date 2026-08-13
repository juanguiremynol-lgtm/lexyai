/**
 * censusControl.ts — Iteration 55 (C2).
 *
 * A census that reports zero publications is only a fact when a control
 * despacho of the same circuit was measured and did return volume: that proves
 * the instrument reaches the circuit, so the zeros belong to the despacho and
 * not to the measurement. Without the control the report stays "not measured".
 */

/** A sibling despacho of the same circuit (first 8 digits) that we already measured. */
export function controlDespachoFor(code: string, measuredSiblings: string[]): string | null {
  const circuit = code.slice(0, 8);
  return measuredSiblings.find((s) => s !== code && s.slice(0, 8) === circuit) ?? null;
}

export function annualVolumesTotal(v: Record<string, unknown> | null | undefined): number {
  if (!v) return 0;
  return Object.values(v).reduce<number>((a, n) => a + (Number(n) || 0), 0);
}
