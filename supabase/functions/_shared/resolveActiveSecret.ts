/**
 * resolveActiveSecret.ts — Single source of truth for provider secret resolution.
 *
 * Used by: provider-sync-external-provider, provider-secret-readiness, etc.
 *
 * Invariant: resolveProviderChain → instance_id → fetch enabled secret → decrypt → attach.
 * No secrets are logged. Failures return typed error codes.
 */

import { decryptSecret } from "./secretsCrypto.ts";

/** Typed result — never exposes raw secret in logs */
export interface SecretResolutionSuccess {
  ok: true;
  instance_id: string;
  instance_scope: string;
  instance_enabled: boolean;
  secret_id: string;
  key_version: number;
  secret_scope: string;
  last_updated_at: string;
  /** The decrypted secret value — NEVER log this */
  decrypted_value: string;
}

export interface SecretResolutionFailure {
  ok: false;
  failure_reason:
    | "MISSING_INSTANCE"
    | "INSTANCE_DISABLED"
    | "MISSING_SECRET"
    | "DECRYPT_FAILED"
    | "KEY_MISSING";
  instance_id: string | null;
  instance_scope: string | null;
  instance_enabled: boolean | null;
  detail: string;
}

export type SecretResolutionResult = SecretResolutionSuccess | SecretResolutionFailure;

/** Parse bytea value from Supabase — handles hex strings and JSON-serialized Uint8Array */
function parseBytea(val: unknown): Uint8Array {
  if (typeof val === "string") {
    const clean = val.replace(/^\\x/, "");
    return new Uint8Array(clean.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  }
  if (val && typeof val === "object" && !ArrayBuffer.isView(val)) {
    const obj = val as Record<string, number>;
    const keys = Object.keys(obj).map(Number).sort((a, b) => a - b);
    return new Uint8Array(keys.map(k => obj[String(k)]));
  }
  if (val instanceof Uint8Array) return val;
  throw new Error("Cannot parse bytea value");
}

/**
 * Resolve the active secret for a provider instance and attempt decryption.
 * 
 * @param db - Supabase admin client (service_role)
 * @param instanceId - The provider_instance ID
 */
export async function resolveActiveSecret(
  db: any,
  instanceId: string,
): Promise<SecretResolutionResult> {
  // 1. Load instance
  const { data: instance, error: instErr } = await db
    .from("provider_instances")
    .select("id, name, scope, is_enabled, connector_id")
    .eq("id", instanceId)
    .maybeSingle();

  if (instErr || !instance) {
    return {
      ok: false,
      failure_reason: "MISSING_INSTANCE",
      instance_id: instanceId,
      instance_scope: null,
      instance_enabled: null,
      detail: `Instance ${instanceId} not found`,
    };
  }

  if (!instance.is_enabled) {
    return {
      ok: false,
      failure_reason: "INSTANCE_DISABLED",
      instance_id: instance.id,
      instance_scope: instance.scope,
      instance_enabled: false,
      detail: `Instance "${instance.name}" is disabled`,
    };
  }

  // 2. Fetch active secret (latest version)
  const { data: secretRow } = await db
    .from("provider_instance_secrets")
    .select("id, cipher_text, nonce, is_active, key_version, scope, created_at")
    .eq("provider_instance_id", instance.id)
    .eq("is_active", true)
    .order("key_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!secretRow) {
    return {
      ok: false,
      failure_reason: "MISSING_SECRET",
      instance_id: instance.id,
      instance_scope: instance.scope,
      instance_enabled: true,
      detail: `No active secret for instance "${instance.name}"`,
    };
  }

  // 3. Check encryption key availability
  const keyB64 = Deno.env.get("ATENIA_SECRETS_KEY_B64");
  if (!keyB64) {
    return {
      ok: false,
      failure_reason: "KEY_MISSING",
      instance_id: instance.id,
      instance_scope: instance.scope,
      instance_enabled: true,
      detail: "ATENIA_SECRETS_KEY_B64 environment variable is not set",
    };
  }

  // 4. Attempt decryption
  try {
    const cipherBytes = parseBytea(secretRow.cipher_text);
    const nonceBytes = parseBytea(secretRow.nonce);
    const decrypted = await decryptSecret(cipherBytes, nonceBytes);

    return {
      ok: true,
      instance_id: instance.id,
      instance_scope: instance.scope,
      instance_enabled: true,
      secret_id: secretRow.id,
      key_version: secretRow.key_version,
      secret_scope: secretRow.scope,
      last_updated_at: secretRow.created_at,
      decrypted_value: decrypted,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      failure_reason: "DECRYPT_FAILED",
      instance_id: instance.id,
      instance_scope: instance.scope,
      instance_enabled: true,
      detail: `Decryption failed: ${msg}`,
    };
  }
}

/**
 * Resolve active secret for a connector+scope combination.
 * Finds the enabled PLATFORM (or ORG) instance for the connector, then resolves its secret.
 */
export async function resolveActiveSecretByConnector(
  db: any,
  connectorId: string,
  scope: "PLATFORM" | "ORG" = "PLATFORM",
  organizationId?: string,
): Promise<SecretResolutionResult> {
  // Find the instance
  const query = db
    .from("provider_instances")
    .select("id")
    .eq("connector_id", connectorId)
    .eq("scope", scope)
    .eq("is_enabled", true);

  if (scope === "PLATFORM") {
    query.is("organization_id", null);
  } else if (organizationId) {
    query.eq("organization_id", organizationId);
  }

  const { data: instances } = await query
    .order("created_at", { ascending: false })
    .limit(1);

  if (!instances || instances.length === 0) {
    return {
      ok: false,
      failure_reason: "MISSING_INSTANCE",
      instance_id: null,
      instance_scope: scope,
      instance_enabled: null,
      detail: `No enabled ${scope} instance for connector ${connectorId}`,
    };
  }

  return resolveActiveSecret(db, instances[0].id);
}
