/**
 * SAMAI Estados Provider Adapter
 * 
 * Configurable adapter for the SAMAI Estados external API.
 * All behavior differences are driven by connector capabilities,
 * NOT code branching in random places.
 * 
 * Controlled toggles:
 *   - header_mode: "x-api-key" | "authorization-bearer"
 *   - payload_mode: "radicado_only" | "radicado_workflow" | "radicado_include"
 *   - radicado_format: "raw_23" | "formatted_dashes" | "strip_recurso"
 *   - snapshot_endpoint: "/snapshot" | "/estados" | custom path
 *   - data_key: "estados" | "actuaciones" | "data.estados" — where the list lives in response
 */

// ── Header Modes ──

export type HeaderMode = "x-api-key" | "authorization-bearer";

export function buildProviderHeaders(
  mode: HeaderMode,
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...extraHeaders,
  };

  switch (mode) {
    case "x-api-key":
      headers["x-api-key"] = apiKey;
      break;
    case "authorization-bearer":
      headers["authorization"] = `Bearer ${apiKey}`;
      break;
  }

  return headers;
}

// ── Payload Modes ──

export type PayloadMode = "radicado_only" | "radicado_workflow" | "radicado_include";

export interface PayloadOptions {
  radicado: string;
  workflowType?: string;
  include?: string[];
  since?: string | null;
}

export function buildRequestPayload(
  mode: PayloadMode,
  options: PayloadOptions,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    provider_case_id: options.radicado,
  };

  if (options.since) {
    base.since = options.since;
  }

  switch (mode) {
    case "radicado_only":
      return base;

    case "radicado_workflow":
      return {
        ...base,
        workflow_type: options.workflowType || "CPACA",
      };

    case "radicado_include":
      return {
        ...base,
        include: options.include || ["ESTADOS"],
      };
  }
}

// ── Radicado Normalization ──

export type RadicadoFormat = "raw_23" | "formatted_dashes" | "strip_recurso";

/**
 * Normalize a radicado according to the target format.
 * Input is always the canonical 23-digit form.
 */
export function normalizeRadicadoForProvider(
  radicado: string,
  format: RadicadoFormat,
): string {
  // Strip all non-numeric
  const digits = radicado.replace(/\D/g, "");

  switch (format) {
    case "raw_23":
      return digits.padStart(23, "0").slice(0, 23);

    case "formatted_dashes":
      // Format: XXXXX-XX-XX-XXX-XXXX-XXXXX-XX
      if (digits.length >= 23) {
        return `${digits.slice(0, 5)}-${digits.slice(5, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 21)}-${digits.slice(21, 23)}`;
      }
      return digits;

    case "strip_recurso":
      // Return first 21 digits (without recurso suffix)
      return digits.slice(0, 21);
  }
}

// ── Response Parsing ──

export type DataKeyPath = "estados" | "actuaciones" | "data.estados" | "data.actuaciones";

/**
 * Extract the data list from a provider response using the configured data key path.
 */
export function extractDataFromResponse(
  response: Record<string, unknown>,
  dataKey: DataKeyPath,
): unknown[] {
  const parts = dataKey.split(".");
  let current: unknown = response;

  for (const part of parts) {
    if (current && typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return [];
    }
  }

  return Array.isArray(current) ? current : [];
}

// ── Error Parsing ──

export interface ProviderValidationError {
  field?: string;
  message: string;
  code?: string;
}

/**
 * Parse a 422 or other error response into structured validation errors.
 * Returns redacted errors (no secret values leaked).
 */
export function parseProviderErrors(
  responseBody: string,
): ProviderValidationError[] {
  try {
    const parsed = JSON.parse(responseBody);

    // Try common error response shapes
    const errors: ProviderValidationError[] = [];

    // Shape 1: { errors: [{ field, message }] }
    if (Array.isArray(parsed.errors)) {
      for (const e of parsed.errors) {
        errors.push({
          field: e.field || e.param || e.loc?.join("."),
          message: String(e.message || e.msg || e.detail || "Unknown"),
          code: e.code,
        });
      }
      return errors;
    }

    // Shape 2: { error: "string" } or { message: "string" }
    if (parsed.error || parsed.message || parsed.detail) {
      errors.push({
        message: String(parsed.error || parsed.message || parsed.detail),
        code: parsed.code || parsed.error_code,
      });
      return errors;
    }

    // Shape 3: { validation: { field: ["error1", "error2"] } }
    if (parsed.validation && typeof parsed.validation === "object") {
      for (const [field, msgs] of Object.entries(parsed.validation)) {
        const msgList = Array.isArray(msgs) ? msgs : [msgs];
        for (const msg of msgList) {
          errors.push({ field, message: String(msg) });
        }
      }
      return errors;
    }

    // Fallback: stringify the whole thing (redacted)
    errors.push({ message: JSON.stringify(parsed).slice(0, 500) });
    return errors;
  } catch {
    return [{ message: responseBody.slice(0, 500) }];
  }
}

// ── Adapter Configuration (from connector capabilities) ──

export interface SamaiEstadosAdapterConfig {
  headerMode: HeaderMode;
  payloadMode: PayloadMode;
  radicadoFormat: RadicadoFormat;
  snapshotEndpoint: string;
  dataKey: DataKeyPath;
  sourcePlatform: string;
  actType: string;
}

/**
 * Extract adapter configuration from connector capabilities array.
 * Falls back to sensible defaults for SAMAI Estados.
 */
export function resolveAdapterConfig(
  capabilities: string[] | Record<string, unknown>,
): SamaiEstadosAdapterConfig {
  // If capabilities is an array (legacy), check for known flags
  const caps = Array.isArray(capabilities)
    ? capabilitiesArrayToMap(capabilities)
    : capabilities;

  return {
    headerMode: (caps.header_mode as HeaderMode) || "x-api-key",
    payloadMode: (caps.payload_mode as PayloadMode) || "radicado_include",
    radicadoFormat: (caps.radicado_format as RadicadoFormat) || "raw_23",
    snapshotEndpoint: (caps.snapshot_endpoint as string) || "/snapshot",
    dataKey: (caps.data_key as DataKeyPath) || "estados",
    sourcePlatform: (caps.source_platform as string) || "SAMAI_ESTADOS",
    actType: (caps.act_type as string) || "ESTADO",
  };
}

function capabilitiesArrayToMap(caps: string[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const cap of caps) {
    if (cap.includes("=")) {
      const [key, ...rest] = cap.split("=");
      map[key] = rest.join("=");
    } else {
      map[cap] = true;
    }
  }
  return map;
}
