/**
 * ghostParking.ts — ITERATION 46 (D3). Edge mirror of src/lib/ghost-parking.ts.
 *
 * The ghost detector was parking matters on ABSENCE. Absence is produced by at
 * least three different things: a genuine provider "not found", a transport
 * failure, and a scraping outage upstream (SAMAI has been frozen since 27 July,
 * so every CPACA matter looks absent right now). Only the first is a statement
 * about the matter; the other two are statements about us.
 *
 * Parking is therefore gated on a CONFIRMED determination. Everything else is
 * INCONCLUSIVE and the matter keeps being monitored — the cost of monitoring a
 * dead matter is a wasted read; the cost of parking a live one is a missed term.
 */

export type RecheckStatus = "FOUND_COMPLETE" | "FOUND_PARTIAL" | "NOT_FOUND" | "ERROR";

export interface ParkingDecision {
  mayPark: boolean;
  /** Spanish, user-facing. Always says WHY. */
  reason: string;
  classification: "ITEM_SPECIFIC" | "INCONCLUSIVE";
}

/** A source whose scraping is frozen cannot testify to absence at all. */
export interface SourceHealthLike {
  source: string;
  status?: string | null;
  last_success_at?: string | null;
}

const DEGRADED = new Set(["DEGRADED", "FROZEN", "STALE", "ERROR", "DOWN", "OUTAGE"]);

export function sourceCanTestifyToAbsence(health: SourceHealthLike | null | undefined): boolean {
  if (!health) return false; // no health reading is not a clean bill of health
  return !DEGRADED.has((health.status ?? "").toUpperCase());
}

export function decideParking(input: {
  recheckStatus: RecheckStatus;
  controlSucceeded: boolean;
  /** Health of the estados/acts source the matter depends on. */
  sourceHealth?: SourceHealthLike | null;
}): ParkingDecision {
  if (input.recheckStatus !== "NOT_FOUND") {
    return {
      mayPark: false,
      classification: "INCONCLUSIVE",
      reason:
        "La reconsulta no devolvió un «no encontrado» confirmado por el proveedor, sino una falla de lectura. Una falla no es una respuesta: el expediente sigue monitoreándose.",
    };
  }

  if (!input.controlSucceeded) {
    return {
      mayPark: false,
      classification: "INCONCLUSIVE",
      reason:
        "El radicado de control tampoco resolvió, de modo que la ausencia puede ser nuestra y no del expediente. El expediente sigue monitoreándose.",
    };
  }

  if (!sourceCanTestifyToAbsence(input.sourceHealth)) {
    return {
      mayPark: false,
      classification: "INCONCLUSIVE",
      reason:
        "La fuente de la que depende este expediente está degradada o congelada, así que su silencio no prueba nada sobre el expediente. Se mantiene el monitoreo hasta que la fuente vuelva a leer.",
    };
  }

  return {
    mayPark: true,
    classification: "ITEM_SPECIFIC",
    reason:
      "El proveedor confirmó «no encontrado» para este radicado mientras el radicado de control sí resolvió y la fuente está sana. La ausencia es del expediente, no del sistema.",
  };
}
