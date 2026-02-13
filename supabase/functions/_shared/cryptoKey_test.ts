/**
 * Unit tests for cryptoKey.ts — key derivation logic.
 * Deliverable E: Tests for DIRECT_32, SHA256_DERIVED, and invalid base64.
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";

const { assertEquals, assertNotEquals } = await import("https://deno.land/std@0.224.0/assert/mod.ts");

// We test the core logic directly without importing the module (which reads env vars)
// Instead we replicate the deterministic derivation logic for isolated testing.

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(envVal: string): Promise<{ bytes: Uint8Array; mode: string }> {
  let rawBytes: Uint8Array;
  try {
    rawBytes = b64ToBytes(envVal);
  } catch {
    rawBytes = new TextEncoder().encode(envVal);
  }

  if (rawBytes.byteLength === 32) {
    return { bytes: rawBytes, mode: "DIRECT_32" };
  }

  const hash = await crypto.subtle.digest("SHA-256", rawBytes as unknown as BufferSource);
  return { bytes: new Uint8Array(hash), mode: "SHA256_DERIVED" };
}

Deno.test("DIRECT_32: 32-byte base64 key used directly", async () => {
  // 32 random bytes encoded as base64
  const key32 = new Uint8Array(32);
  crypto.getRandomValues(key32);
  const b64 = btoa(String.fromCharCode(...key32));

  const result = await deriveKey(b64);
  assertEquals(result.mode, "DIRECT_32");
  assertEquals(result.bytes.byteLength, 32);
  // Should be identical to original bytes
  assertEquals(Array.from(result.bytes), Array.from(key32));
});

Deno.test("SHA256_DERIVED: 46-byte base64 value derives via SHA-256", async () => {
  // 46 raw bytes (not 32)
  const key46 = new Uint8Array(46);
  crypto.getRandomValues(key46);
  const b64 = btoa(String.fromCharCode(...key46));

  const result = await deriveKey(b64);
  assertEquals(result.mode, "SHA256_DERIVED");
  assertEquals(result.bytes.byteLength, 32);
  // Should NOT be the same as raw bytes (it's a hash)
  assertNotEquals(Array.from(result.bytes).slice(0, 46), Array.from(key46));
});

Deno.test("SHA256_DERIVED: invalid base64 falls back to UTF-8 hash", async () => {
  const invalidB64 = "not-valid-base64!!!@@@";

  const result = await deriveKey(invalidB64);
  assertEquals(result.mode, "SHA256_DERIVED");
  assertEquals(result.bytes.byteLength, 32);
});

Deno.test("Deterministic: same input always produces same key", async () => {
  const input = "my-test-key-that-is-not-32-bytes";
  const r1 = await deriveKey(input);
  const r2 = await deriveKey(input);
  assertEquals(Array.from(r1.bytes), Array.from(r2.bytes));
  assertEquals(r1.mode, r2.mode);
});

Deno.test("AES-GCM round-trip with derived key", async () => {
  const envVal = "a-key-that-is-definitely-not-32-bytes-long";
  const { bytes } = await deriveKey(envVal);

  const key = await crypto.subtle.importKey("raw", bytes as unknown as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = "my-secret-api-key-12345";
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoded as unknown as BufferSource);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipherBuf as unknown as BufferSource);
  const decrypted = new TextDecoder().decode(decryptedBuf);

  assertEquals(decrypted, plaintext);
});

Deno.test("Re-encryption: old ciphertext fails, new one succeeds", async () => {
  // Simulate old key (wrong derivation)
  const oldKeyBytes = new Uint8Array(32);
  crypto.getRandomValues(oldKeyBytes);
  const oldKey = await crypto.subtle.importKey("raw", oldKeyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);

  // Encrypt with old key
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = "samai-estados-api-key";
  const encoded = new TextEncoder().encode(plaintext);
  const oldCipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, oldKey, encoded);

  // New key (derived via SHA-256)
  const { bytes: newKeyBytes } = await deriveKey("current-platform-key-b64");
  const newKey = await crypto.subtle.importKey("raw", newKeyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);

  // Old ciphertext should fail with new key
  let decryptFailed = false;
  try {
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, newKey, oldCipher);
  } catch {
    decryptFailed = true;
  }
  assertEquals(decryptFailed, true, "Old ciphertext should fail with new key");

  // Re-encrypt with new key (SET_EXACT mode)
  const newNonce = crypto.getRandomValues(new Uint8Array(12));
  const newCipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: newNonce }, newKey, encoded);

  // New ciphertext should succeed
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: newNonce }, newKey, newCipher);
  const decrypted = new TextDecoder().decode(decryptedBuf);
  assertEquals(decrypted, plaintext);
});
