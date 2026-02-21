/**
 * contractValidator_test.ts — Tests for the contract validator.
 */

import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  validateProviderResult,
  validateDynamicProviderConfig,
  validateOverrideChange,
  IMMUTABLE_BUILT_IN_KEYS,
} from "./contractValidator.ts";

// ═══════════════════════════════════════════
// Provider Result Contract Tests
// ═══════════════════════════════════════════

Deno.test("validateProviderResult: accepts valid ACTUACIONES result", () => {
  const result = {
    provider: "cpnu",
    status: "SUCCESS",
    actuaciones: [
      {
        fecha_actuacion: "2026-01-15",
        actuacion: "AUTO ADMISORIO",
        anotacion: "Test",
        hash_fingerprint: "abc123",
        source_platform: "cpnu",
        sources: ["cpnu"],
      },
    ],
    publicaciones: [],
    metadata: null,
    parties: null,
    durationMs: 500,
  };

  const v = validateProviderResult(result, "ACTUACIONES");
  assertEquals(v.valid, true);
  assertEquals(v.errors.length, 0);
});

Deno.test("validateProviderResult: rejects missing hash_fingerprint", () => {
  const result = {
    status: "SUCCESS",
    actuaciones: [
      {
        fecha_actuacion: "2026-01-15",
        actuacion: "AUTO",
        anotacion: null,
        source_platform: "cpnu",
        sources: ["cpnu"],
        // missing hash_fingerprint
      },
    ],
    durationMs: 100,
  };

  const v = validateProviderResult(result, "ACTUACIONES");
  assert(!v.valid);
  assert(v.errors.some((e) => e.includes("hash_fingerprint")));
});

Deno.test("validateProviderResult: rejects sources as scalar", () => {
  const result = {
    status: "SUCCESS",
    actuaciones: [
      {
        fecha_actuacion: "2026-01-01",
        actuacion: "TEST",
        hash_fingerprint: "abc",
        source_platform: "cpnu",
        sources: "cpnu", // scalar — must be array
      },
    ],
    durationMs: 100,
  };

  const v = validateProviderResult(result, "ACTUACIONES");
  assert(!v.valid);
  assert(v.errors.some((e) => e.includes("sources must be array")));
});

Deno.test("validateProviderResult: rejects invalid status", () => {
  const result = {
    status: "UNKNOWN_STATUS",
    actuaciones: [],
    durationMs: 0,
  };

  const v = validateProviderResult(result, "ACTUACIONES");
  assert(!v.valid);
  assert(v.errors.some((e) => e.includes("Invalid status")));
});

Deno.test("validateProviderResult: warns on missing errorMessage for ERROR", () => {
  const result = {
    status: "ERROR",
    actuaciones: [],
    durationMs: 0,
  };

  const v = validateProviderResult(result, "ACTUACIONES");
  assertEquals(v.valid, true); // warnings don't fail
  assert(v.warnings.some((w) => w.includes("errorMessage")));
});

Deno.test("validateProviderResult: validates ESTADOS publicaciones", () => {
  const result = {
    status: "SUCCESS",
    publicaciones: [
      {
        title: "Estado del 15/01/2026",
        tipo_publicacion: "Estado Electrónico",
        fecha_fijacion: "2026-01-15",
        hash_fingerprint: "xyz789",
        source_platform: "publicaciones",
        sources: ["publicaciones"],
      },
    ],
    durationMs: 200,
  };

  const v = validateProviderResult(result, "ESTADOS");
  assertEquals(v.valid, true);
});

Deno.test("validateProviderResult: rejects publicaciones missing title", () => {
  const result = {
    status: "SUCCESS",
    publicaciones: [
      {
        hash_fingerprint: "xyz",
        source_platform: "publicaciones",
        sources: ["publicaciones"],
        // missing title
      },
    ],
    durationMs: 200,
  };

  const v = validateProviderResult(result, "ESTADOS");
  assert(!v.valid);
  assert(v.errors.some((e) => e.includes("missing title")));
});

Deno.test("validateProviderResult: rejects null result", () => {
  const v = validateProviderResult(null, "ACTUACIONES");
  assert(!v.valid);
});

// ═══════════════════════════════════════════
// Dynamic Provider Config Tests
// ═══════════════════════════════════════════

Deno.test("validateDynamicProviderConfig: rejects built-in key collision", () => {
  for (const key of IMMUTABLE_BUILT_IN_KEYS) {
    const v = validateDynamicProviderConfig({
      provider_key: key,
      data_kind: "ACTUACIONES",
    });
    assert(!v.valid, `Should reject built-in key "${key}"`);
  }
});

Deno.test("validateDynamicProviderConfig: rejects bad key format", () => {
  const v = validateDynamicProviderConfig({
    provider_key: "My Provider!",
    data_kind: "ACTUACIONES",
  });
  assert(!v.valid);
});

Deno.test("validateDynamicProviderConfig: accepts valid config", () => {
  const v = validateDynamicProviderConfig({
    provider_key: "custom_api_v2",
    data_kind: "ACTUACIONES",
    target_table: "work_item_acts",
    endpoint_url: "https://api.example.com",
    workflow_types: ["CGP", "LABORAL"],
  });
  assertEquals(v.valid, true);
});

Deno.test("validateDynamicProviderConfig: rejects HTTP endpoint", () => {
  const v = validateDynamicProviderConfig({
    provider_key: "insecure_api",
    data_kind: "ACTUACIONES",
    endpoint_url: "http://api.example.com",
  });
  assert(!v.valid);
  assert(v.errors.some((e) => e.includes("HTTPS")));
});

Deno.test("validateDynamicProviderConfig: rejects invalid workflow type", () => {
  const v = validateDynamicProviderConfig({
    provider_key: "my_api",
    data_kind: "ACTUACIONES",
    workflow_types: ["INVALID_TYPE"],
  });
  assert(!v.valid);
});

Deno.test("validateDynamicProviderConfig: rejects wrong target table", () => {
  const v = validateDynamicProviderConfig({
    provider_key: "my_api",
    data_kind: "ACTUACIONES",
    target_table: "work_item_publicaciones",
  });
  assert(!v.valid);
});

// ═══════════════════════════════════════════
// Override Change Safety Tests
// ═══════════════════════════════════════════

Deno.test("validateOverrideChange: blocks global disable of built-in", () => {
  const err = validateOverrideChange({
    provider_key: "cpnu",
    enabled: false,
    organization_id: null,
  });
  assert(err !== null);
  assert(err!.includes("Cannot globally disable"));
});

Deno.test("validateOverrideChange: allows per-org disable of built-in", () => {
  const err = validateOverrideChange({
    provider_key: "cpnu",
    enabled: false,
    organization_id: "org-123",
  });
  assertEquals(err, null);
});

Deno.test("validateOverrideChange: allows global disable of dynamic provider", () => {
  const err = validateOverrideChange({
    provider_key: "custom_api",
    enabled: false,
    organization_id: null,
  });
  assertEquals(err, null);
});
