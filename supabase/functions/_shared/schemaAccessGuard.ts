/**
 * schemaAccessGuard.ts — ITER53/D1.
 *
 * Absence of evidence is not evidence of absence — applied to our own
 * instruments. During a credit outage the database answered with an EMPTY
 * public schema while pg_catalog and auth kept responding. From the outside
 * that is indistinguishable from a dropped schema, and any job that read it as
 * a result would have written a conclusion from a blind read.
 *
 * Every tooling/health path classifies its read BEFORE interpreting it.
 */

export type SchemaAccessState = "ACCESO_NORMAL" | "ACCESO_DEGRADADO" | "SIN_RESPUESTA";

export interface SchemaAccessProbe {
  public_tables: number;
  system_tables: number;
  auth_tables: number;
}

export interface SchemaAccessVerdict {
  state: SchemaAccessState;
  /** True when NO conclusion may be derived from this read. */
  conclusionsForbidden: boolean;
  reason: string;
}

/** Minimum plausible size of this project's public schema. */
export const MIN_EXPECTED_PUBLIC_TABLES = 20;

export function classifySchemaAccess(
  probe: SchemaAccessProbe | null | undefined,
): SchemaAccessVerdict {
  if (!probe) {
    return {
      state: "SIN_RESPUESTA",
      conclusionsForbidden: true,
      reason: "La base de datos no respondió a la sonda de acceso.",
    };
  }
  const systemAlive = probe.system_tables > 0 || probe.auth_tables > 0;
  if (probe.public_tables === 0 && systemAlive) {
    return {
      state: "ACCESO_DEGRADADO",
      conclusionsForbidden: true,
      reason:
        "El esquema public respondió con cero tablas mientras los esquemas del sistema siguen respondiendo: es falta de acceso, no falta de datos.",
    };
  }
  if (probe.public_tables > 0 && probe.public_tables < MIN_EXPECTED_PUBLIC_TABLES) {
    return {
      state: "ACCESO_DEGRADADO",
      conclusionsForbidden: true,
      reason: `El esquema public expone ${probe.public_tables} tablas, por debajo del mínimo plausible (${MIN_EXPECTED_PUBLIC_TABLES}): lectura parcial.`,
    };
  }
  if (!systemAlive) {
    return {
      state: "SIN_RESPUESTA",
      conclusionsForbidden: true,
      reason: "Los esquemas del sistema no respondieron: la sonda no es concluyente.",
    };
  }
  return {
    state: "ACCESO_NORMAL",
    conclusionsForbidden: false,
    reason: "Acceso completo al esquema public.",
  };
}
