/**
 * cryptoKey.ts — Deterministic AES-256-GCM key derivation from ATENIA_SECRETS_KEY_B64.
 *
 * Rules:
 *   1. Read ATENIA_SECRETS_KEY_B64 env var.
 *   2. Base64-decode to bytes.
 *   3. If decoded length === 32 → use directly (DIRECT_32).
 *   4. If decoded length !== 32 → SHA-256(decodedBytes) → 32 bytes (SHA256_DERIVED).
 *   5. If base64 decode fails → SHA-256(rawStringBytes) → 32 bytes (SHA256_DERIVED).
 *   6. No randomness, no rotation, no multi-key fallback. Deterministic only.
 *
 * NEVER logs key material. Only logs derivation mode for diagnostics.
 */

export type KeyDerivationMode = "DIRECT_32" | "SHA256_DERIVED";

let _cachedMode: KeyDerivationMode | null = null;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Returns the derivation mode without exposing key material.
 * Safe to include in logs, traces, readiness responses.
 */
export function getKeyDerivationMode(): KeyDerivationMode {
  if (_cachedMode) return _cachedMode;

  const envVal = Deno.env.get("ATENIA_SECRETS_KEY_B64");
  if (!envVal) return "SHA256_DERIVED"; // will throw in getAes256KeyBytesFromEnv

  try {
    const decoded = b64ToBytes(envVal);
    _cachedMode = decoded.byteLength === 32 ? "DIRECT_32" : "SHA256_DERIVED";
  } catch {
    _cachedMode = "SHA256_DERIVED";
  }
  return _cachedMode;
}

/**
 * Deterministically produce exactly 32 bytes suitable for AES-256-GCM
 * from the ATENIA_SECRETS_KEY_B64 environment variable.
 *
 * Throws if the env var is missing.
 */
export async function getAes256KeyBytesFromEnv(): Promise<Uint8Array> {
  const envVal = Deno.env.get("ATENIA_SECRETS_KEY_B64");
  if (!envVal) throw new Error("Missing env ATENIA_SECRETS_KEY_B64");

  let rawBytes: Uint8Array;
  try {
    rawBytes = b64ToBytes(envVal);
  } catch {
    // Base64 decode failed — hash raw string bytes instead
    rawBytes = new TextEncoder().encode(envVal);
  }

  if (rawBytes.byteLength === 32) {
    return rawBytes; // DIRECT_32
  }

  // Derive 32 bytes via SHA-256 (deterministic, no salt needed for this use case)
  const hash = await crypto.subtle.digest("SHA-256", rawBytes);
  return new Uint8Array(hash); // Always exactly 32 bytes
}

/**
 * Import the derived 32-byte key as a CryptoKey for AES-GCM.
 */
export async function getAesKey(): Promise<CryptoKey> {
  const keyBytes = await getAes256KeyBytesFromEnv();
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
