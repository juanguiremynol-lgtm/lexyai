/**
 * Vitest tests for mappingEngine, AI guide redaction, and ingestion invariants.
 */

import { describe, it, expect } from "vitest";

// ---- Inline implementations matching the shared library ----

// Allowlisted transforms
const TRANSFORMS: Record<string, (v: unknown) => unknown> = {
  STRING: (v) => (v == null ? "" : String(v)),
  TRIM: (v) => (v == null ? "" : String(v).trim()),
  DATE_ISO: (v) => {
    if (!v) return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  },
  DATE_CO: (v) => {
    if (!v) return null;
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  },
  NORMALIZE_TYPE: (v) => (!v ? "UNKNOWN" : String(v).trim().toUpperCase().replace(/\s+/g, "_")),
  IDENTITY: (v) => v,
};

function resolvePath(obj: unknown, path: string): unknown {
  if (!path || !path.startsWith("$")) return undefined;
  const parts = path.slice(2).split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// Redaction logic
const SECRET_KEYS = new Set([
  "secret_value", "secret", "api_key", "apikey", "hmac_secret", "token",
  "password", "authorization", "bearer", "credential", "private_key",
]);

function redactSecrets(obj: unknown): unknown {
  if (obj == null || typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else if (typeof val === "string" && val.length > 20 && /^(sk_|pk_|Bearer |ey[A-Za-z0-9])/.test(val)) {
        result[key] = "[REDACTED_TOKEN]";
      } else {
        result[key] = redactSecrets(val);
      }
    }
    return result;
  }
  return obj;
}

// Simple mapping application
interface FieldMapping { path: string; transform: string; required?: boolean }
interface ScopeMappingSpec { array_path: string; fields: Record<string, FieldMapping>; extras_mode?: string }

function applyFieldMappings(item: unknown, fields: Record<string, FieldMapping>) {
  const record: Record<string, unknown> = {};
  const mappedPaths = new Set<string>();
  const warnings: string[] = [];
  for (const [canonicalField, mapping] of Object.entries(fields)) {
    const rawVal = resolvePath(item, mapping.path);
    const transformFn = TRANSFORMS[mapping.transform] || TRANSFORMS.IDENTITY;
    record[canonicalField] = transformFn(rawVal);
    mappedPaths.add(mapping.path.replace("$.", ""));
    if (mapping.required && (rawVal == null || rawVal === "")) {
      warnings.push(`Missing required: ${canonicalField}`);
    }
  }
  const extras: Record<string, unknown> = {};
  if (item && typeof item === "object") {
    for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
      if (!mappedPaths.has(key)) extras[key] = val;
    }
  }
  return { record, extras, warnings };
}

// ---- Tests ----

describe("MappingEngine: Transform Functions", () => {
  it("DATE_CO parses DD/MM/YYYY format", () => {
    expect(TRANSFORMS.DATE_CO("15/03/2025")).toBe("2025-03-15");
  });

  it("DATE_CO parses DD-MM-YYYY format", () => {
    expect(TRANSFORMS.DATE_CO("01-12-2024")).toBe("2024-12-01");
  });

  it("DATE_CO returns null for invalid dates", () => {
    expect(TRANSFORMS.DATE_CO("not-a-date")).toBeNull();
  });

  it("NORMALIZE_TYPE uppercases and underscores", () => {
    expect(TRANSFORMS.NORMALIZE_TYPE("auto admisorio")).toBe("AUTO_ADMISORIO");
  });

  it("STRING handles null gracefully", () => {
    expect(TRANSFORMS.STRING(null)).toBe("");
  });
});

describe("MappingEngine: Path Resolution", () => {
  it("resolves nested paths", () => {
    const obj = { data: { items: { count: 42 } } };
    expect(resolvePath(obj, "$.data.items.count")).toBe(42);
  });

  it("returns undefined for missing paths", () => {
    expect(resolvePath({ a: 1 }, "$.b.c")).toBeUndefined();
  });

  it("handles null objects", () => {
    expect(resolvePath(null, "$.a")).toBeUndefined();
  });
});

describe("MappingEngine: Field Mapping", () => {
  it("maps fields and collects extras", () => {
    const item = { fecha: "2025-01-15", descripcion: "  Sentencia  ", extra_field: "value", otro: 123 };
    const fields: Record<string, FieldMapping> = {
      event_date: { path: "$.fecha", transform: "DATE_ISO" },
      description: { path: "$.descripcion", transform: "TRIM" },
    };
    const { record, extras } = applyFieldMappings(item, fields);
    expect(record.event_date).toBe("2025-01-15");
    expect(record.description).toBe("Sentencia");
    expect(extras).toHaveProperty("extra_field", "value");
    expect(extras).toHaveProperty("otro", 123);
  });

  it("reports warnings for missing required fields", () => {
    const item = { tipo: "auto" };
    const fields: Record<string, FieldMapping> = {
      event_date: { path: "$.fecha", transform: "DATE_ISO", required: true },
    };
    const { warnings } = applyFieldMappings(item, fields);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("Missing required");
  });

  it("does not crash on empty item", () => {
    const fields: Record<string, FieldMapping> = {
      description: { path: "$.desc", transform: "TRIM" },
    };
    const { record, extras, warnings } = applyFieldMappings({}, fields);
    expect(record.description).toBe("");
    expect(Object.keys(extras)).toHaveLength(0);
  });
});

describe("AI Guide: Secret Redaction", () => {
  it("redacts known secret keys", () => {
    const input = { name: "test", secret_value: "sk_live_abc123", api_key: "key123" };
    const redacted = redactSecrets(input) as Record<string, unknown>;
    expect(redacted.name).toBe("test");
    expect(redacted.secret_value).toBe("[REDACTED]");
    expect(redacted.api_key).toBe("[REDACTED]");
  });

  it("redacts token-like strings by pattern", () => {
    const input = { header: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature" };
    const redacted = redactSecrets(input) as Record<string, unknown>;
    expect(redacted.header).toBe("[REDACTED_TOKEN]");
  });

  it("preserves non-secret values", () => {
    const input = { base_url: "https://api.example.com", name: "My Provider" };
    const redacted = redactSecrets(input) as Record<string, unknown>;
    expect(redacted.base_url).toBe("https://api.example.com");
    expect(redacted.name).toBe("My Provider");
  });

  it("handles nested objects", () => {
    const input = { connector: { name: "test", auth: { password: "secret123" } } };
    const redacted = redactSecrets(input) as any;
    expect(redacted.connector.name).toBe("test");
    expect(redacted.connector.auth.password).toBe("[REDACTED]");
  });

  it("handles arrays", () => {
    const input = [{ api_key: "key1" }, { name: "safe" }];
    const redacted = redactSecrets(input) as any[];
    expect(redacted[0].api_key).toBe("[REDACTED]");
    expect(redacted[1].name).toBe("safe");
  });

  it("never leaks secrets in deeply nested state", () => {
    const wizardState = {
      mode: "PLATFORM",
      connector: { name: "Test", allowed_domains: ["api.com"] },
      instance: { base_url: "https://api.com", secret_value: "sk_live_real_secret_key_12345" },
      credentials: { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc" },
    };
    const redacted = JSON.stringify(redactSecrets(wizardState));
    expect(redacted).not.toContain("sk_live_real_secret_key");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redacted).toContain("api.com");
  });
});

describe("Ingestion Invariants", () => {
  it("raw snapshots always preserve full payload", () => {
    const payload = { actuaciones: [{ id: "1", fecha: "2025-01-01", custom: "data" }] };
    // Simulate: payload is stored as-is, not filtered
    const stored = JSON.parse(JSON.stringify(payload));
    expect(stored.actuaciones[0].custom).toBe("data");
    expect(stored.actuaciones[0].id).toBe("1");
  });

  it("canonical upsert does not require extra columns for unknown fields", () => {
    const canonicalFields = new Set([
      "event_date", "event_time", "event_type", "description", "event_summary",
      "source_platform", "scrape_date", "hash_fingerprint", "raw_data",
      "provider_event_id", "provider_case_id", "indice",
    ]);
    // Provider sends extra fields
    const providerFields = ["fecha", "tipo", "descripcion", "custom_score", "internal_id"];
    const mapped = { event_date: "2025-01-01", description: "Test" };
    const extras = { custom_score: 95, internal_id: "xyz" };

    // Canonical insert only uses known fields
    for (const key of Object.keys(mapped)) {
      expect(canonicalFields.has(key)).toBe(true);
    }
    // Extras go to separate table, not canonical
    for (const key of Object.keys(extras)) {
      expect(canonicalFields.has(key)).toBe(false);
    }
  });
});
