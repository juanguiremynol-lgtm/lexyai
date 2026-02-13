/**
 * secretsCrypto.ts — AES-256-GCM encrypt/decrypt for provider instance secrets.
 *
 * Uses the canonical key derivation from cryptoKey.ts which handles
 * non-32-byte env values by deriving via SHA-256 deterministically.
 *
 * Only edge functions running with service_role can call these helpers because
 * the provider_instance_secrets table has deny-all RLS for authenticated users.
 */

// Re-export key derivation utilities for callers that need diagnostics
export { getKeyDerivationMode, getAes256KeyBytesFromEnv } from "./cryptoKey.ts";
// Re-export the canonical getAesKey from cryptoKey.ts
export { getAesKey } from "./cryptoKey.ts";

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Convert Uint8Array to \\x hex string for Supabase bytea columns */
export function uint8ToHex(bytes: Uint8Array): string {
  return '\\x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function encryptSecret(plain: string): Promise<{ cipher: Uint8Array; nonce: Uint8Array; cipherHex: string; nonceHex: string }> {
  const key = await (await import("./cryptoKey.ts")).getAesKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plain);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoded);
  const cipher = new Uint8Array(cipherBuf);
  return { cipher, nonce, cipherHex: uint8ToHex(cipher), nonceHex: uint8ToHex(nonce) };
}

export async function decryptSecret(cipher: Uint8Array, nonce: Uint8Array): Promise<string> {
  const key = await (await import("./cryptoKey.ts")).getAesKey();
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher);
  return new TextDecoder().decode(new Uint8Array(plainBuf));
}
