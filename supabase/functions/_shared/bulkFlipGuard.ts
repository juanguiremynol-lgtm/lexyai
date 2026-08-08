/**
 * bulk-flip-guard.ts — ITERATION 47.
 *
 * The near-miss this exists to prevent: `/reserva/estado` looks like a per-item
 * lookup and is actually a REGISTRY of private matters. Probed with one
 * radicado it answered with a different one. Had we queried it per item and
 * read each answer as being about the item we asked for, EVERY matter in the
 * portfolio would have been flipped to PROCESO_PRIVADO in a single pass —
 * silently suppressing coverage alerts across the whole book.
 *
 * The general rule, which is not specific to that endpoint: a single provider
 * read that would move a large fraction of many rows into the same state is a
 * CONTRACT MISUNDERSTANDING until proven otherwise. Real-world state does not
 * change in lockstep; our reading of it does. So the guard refuses the write
 * and raises the refusal, rather than trusting an unusually confident read.
 *
 * Deliberately NOT symmetric with row count: flipping 3 of 4 rows in a tiny
 * portfolio is normal, so the guard only engages once the batch is big enough
 * for a fraction to mean anything.
 */

export interface BulkFlipInput {
  /** Which upstream read is claiming this. */
  endpointKey: string;
  /** Column being written, e.g. `provider_detail_exposure`. */
  field: string;
  /** State the read wants to move rows INTO. */
  targetState: string;
  /** Rows this single read would move into `targetState`. */
  affectedRows: number;
  /** Rows considered in the pass. */
  totalRows: number;
  /** Fraction above which the write is refused. */
  threshold?: number;
  /** Below this many rows a fraction is not meaningful. */
  minRowsForFraction?: number;
}

export interface BulkFlipVerdict {
  allowed: boolean;
  fraction: number;
  threshold: number;
  /** Spanish, user-facing. Explains WHY, never just WHAT. */
  reason: string;
  /** True when the refusal should raise a platform alert. */
  raisesAlert: boolean;
}

export const DEFAULT_BULK_FLIP_THRESHOLD = 0.3;
export const DEFAULT_MIN_ROWS_FOR_FRACTION = 10;

export function evaluateBulkFlip(input: BulkFlipInput): BulkFlipVerdict {
  const threshold = input.threshold ?? DEFAULT_BULK_FLIP_THRESHOLD;
  const minRows = input.minRowsForFraction ?? DEFAULT_MIN_ROWS_FOR_FRACTION;
  const total = Math.max(input.totalRows, 0);
  const affected = Math.max(input.affectedRows, 0);
  const fraction = total > 0 ? affected / total : 0;

  if (affected === 0) {
    return {
      allowed: true, fraction: 0, threshold, raisesAlert: false,
      reason: "La lectura no cambia el estado de ningún expediente.",
    };
  }

  if (total < minRows) {
    return {
      allowed: true, fraction, threshold, raisesAlert: false,
      reason:
        `Cartera de ${total} expedientes: demasiado pequeña para que una proporción signifique algo, ` +
        "así que se aplica la lectura tal cual.",
    };
  }

  if (fraction > threshold) {
    return {
      allowed: false, fraction, threshold, raisesAlert: true,
      reason:
        `Una sola lectura de «${input.endpointKey}» pretende pasar ${affected} de ${total} expedientes ` +
        `(${Math.round(fraction * 100)} %) al estado «${input.targetState}». Un cambio masivo desde una única ` +
        "lectura se interpreta como un malentendido del contrato del proveedor, no como un hecho: " +
        "no se escribió nada y queda registrado para revisión.",
    };
  }

  return {
    allowed: true, fraction, threshold, raisesAlert: false,
    reason:
      `${affected} de ${total} expedientes (${Math.round(fraction * 100)} %) pasan a «${input.targetState}», ` +
      `por debajo del umbral del ${Math.round(threshold * 100)} %.`,
  };
}
