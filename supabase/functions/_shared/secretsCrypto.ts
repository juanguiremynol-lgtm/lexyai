/**
 * secretsCrypto.ts — AES-256-GCM encrypt/decrypt for provider instance secrets.
 *
 * The encryption key is sourced from the ATENIA_SECRETS_KEY_B64 environment
 * variable, which must contain exactly 32 bytes encoded as standard base-64.
 *
 * Only edge functions running with service_role can call these helpers because
 * the provider_instance_secrets table has deny-all RLS for authenticated users.
 */

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function getAesKey(): Promise<CryptoKey> {
  const raw = b64ToBytes(requireEnv("ATENIA_SECRETS_KEY_B64"));
  if (raw.byteLength !== 32) throw new Error("ATENIA_SECRETS_KEY_B64 must be 32 bytes (base64-encoded)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string): Promise<{ cipher: Uint8Array; nonce: Uint8Array }> {
  const key = await getAesKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plain);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoded);
  return { cipher: new Uint8Array(cipherBuf), nonce };
}

export async function decryptSecret(cipher: Uint8Array, nonce: Uint8Array): Promise<string> {
  const key = await getAesKey();
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher);
  return new TextDecoder().decode(new Uint8Array(plainBuf));
}
