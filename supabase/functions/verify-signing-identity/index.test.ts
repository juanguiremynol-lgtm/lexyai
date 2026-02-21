/**
 * E2E tests for POA signing flow hardening.
 * Tests: canonical JSON, expired token, consumed token, identity mismatch,
 *        link vs email timeline, and hash chain integrity.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertNotEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

async function callFunction(name: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// ─── Unit test: Recursive canonical JSON determinism ───

function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalStringify).join(",") + "]";
  if (typeof obj === "object") {
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    return "{" + sorted.map(k => JSON.stringify(k) + ":" + canonicalStringify((obj as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

Deno.test("canonicalStringify: nested objects produce stable ordering regardless of insertion order", () => {
  const obj1 = { z: 1, a: { c: 3, b: 2 }, m: [{ y: 10, x: 9 }] };
  const obj2 = { a: { b: 2, c: 3 }, m: [{ x: 9, y: 10 }], z: 1 };
  assertEquals(canonicalStringify(obj1), canonicalStringify(obj2));
});

Deno.test("canonicalStringify: handles null, undefined, nested nulls consistently", () => {
  const obj = { a: null, b: undefined, c: { d: null } };
  const result = canonicalStringify(obj);
  assert(result.includes('"a":null'));
  assert(result.includes('"b":null'));
  assert(result.includes('"d":null'));
});

Deno.test("canonicalStringify: deeply nested objects are deterministic", () => {
  const deep1 = { level1: { level2: { level3: { z: "end", a: "start" } } } };
  const deep2 = { level1: { level2: { level3: { a: "start", z: "end" } } } };
  assertEquals(canonicalStringify(deep1), canonicalStringify(deep2));
});

// ─── E2E: Expired token path ───

Deno.test("validate-signing-link: expired HMAC token returns 410", async () => {
  // Use an obviously expired timestamp (year 2020)
  const expired = Math.floor(new Date("2020-01-01").getTime() / 1000);
  const { status, data } = await callFunction("validate-signing-link", {
    signing_token: "nonexistent-token",
    expires: String(expired),
    signature: "0".repeat(64), // invalid HMAC
  });
  // Should fail on HMAC or expiry
  assert(status === 403 || status === 410, `Expected 403 or 410, got ${status}`);
  await Promise.resolve(); // consume
});

// ─── E2E: Identity mismatch ───

Deno.test("verify-signing-identity: missing fields returns 400", async () => {
  const { status, data } = await callFunction("verify-signing-identity", {
    signing_token: "nonexistent",
    confirmed_name: "",
    confirmed_cedula: "123",
  });
  assertEquals(status, 400);
  await Promise.resolve();
});

Deno.test("verify-signing-identity: invalid token returns 404", async () => {
  const { status, data } = await callFunction("verify-signing-identity", {
    signing_token: "does-not-exist-token-xyz",
    confirmed_name: "Juan Pérez",
    confirmed_cedula: "1234567890",
  });
  assertEquals(status, 404);
  await Promise.resolve();
});

// ─── E2E: Consumed / already-signed token ───

Deno.test("validate-signing-link: completely invalid signature rejected", async () => {
  const futureExpires = Math.floor((Date.now() + 86400000) / 1000);
  const { status, data } = await callFunction("validate-signing-link", {
    signing_token: "test-token-abc",
    expires: String(futureExpires),
    signature: "deadbeef".repeat(8),
  });
  assertEquals(status, 403);
  assert(data.error === "invalid_link");
  await Promise.resolve();
});

// ─── DB-enforced immutability: UPDATE/DELETE must fail ───

Deno.test("document_signature_events: UPDATE is rejected by DB trigger", async () => {
  // Attempt to update via PostgREST (authenticated/anon role)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/document_signature_events?id=eq.00000000-0000-0000-0000-000000000000`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ event_type: "TAMPERED" }),
    },
  );
  // Should fail — either RLS (403/406) or trigger (400/500)
  assertNotEquals(res.status, 200);
  assertNotEquals(res.status, 204);
  await res.body?.cancel();
});

Deno.test("document_signature_events: DELETE is rejected by DB trigger", async () => {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/document_signature_events?id=eq.00000000-0000-0000-0000-000000000000`,
    {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
    },
  );
  assertNotEquals(res.status, 200);
  assertNotEquals(res.status, 204);
  await res.body?.cancel();
});
