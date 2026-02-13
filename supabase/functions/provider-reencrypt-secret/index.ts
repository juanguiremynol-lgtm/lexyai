/**
 * provider-reencrypt-secret — Internal admin endpoint that re-encrypts
 * a provider instance secret using the SAME plaintext value but under
 * the current ATENIA_SECRETS_KEY_B64 derived key.
 *
 * POST { connector_id, scope?: "PLATFORM", env_secret_name: string }
 *
 * After re-encryption, runs a readiness probe to confirm decrypt_ok.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptSecret, decryptSecret } from "../_shared/secretsCrypto.ts";
import { getKeyDerivationMode } from "../_shared/cryptoKey.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

/** Parse bytea hex from Supabase */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: require service-role or platform admin
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminClient = createClient(supabaseUrl, serviceKey);
      const { data: pa } = await adminClient
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!pa) {
        return new Response(JSON.stringify({ error: "Platform admin required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json();
    const { connector_id, scope = "PLATFORM", env_secret_name } = body;

    if (!connector_id || !env_secret_name) {
      return new Response(
        JSON.stringify({ error: "connector_id and env_secret_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Read the plaintext secret from env
    const secretValue = Deno.env.get(env_secret_name);
    if (!secretValue) {
      return new Response(
        JSON.stringify({ error: `Environment variable ${env_secret_name} not found` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check encryption key exists
    const encKeyB64 = Deno.env.get("ATENIA_SECRETS_KEY_B64");
    if (!encKeyB64) {
      return new Response(
        JSON.stringify({
          error: "ATENIA_SECRETS_KEY_B64 not configured in environment",
          code: "MISSING_PLATFORM_SECRETS_KEY",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const platformKeyMode = getKeyDerivationMode();

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Find the PLATFORM instance
    const { data: instances } = await adminClient
      .from("provider_instances")
      .select("id, name, scope, connector_id, organization_id, is_enabled")
      .eq("connector_id", connector_id)
      .eq("scope", scope)
      .eq("is_enabled", true)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!instances || instances.length === 0) {
      return new Response(
        JSON.stringify({ error: `No enabled ${scope} instance for connector ${connector_id}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const instance = instances[0];

    // Encrypt the secret with current platform key
    let encResult: Awaited<ReturnType<typeof encryptSecret>>;
    try {
      encResult = await encryptSecret(secretValue);
    } catch (encErr: unknown) {
      const msg = encErr instanceof Error ? encErr.message : String(encErr);
      return new Response(
        JSON.stringify({ error: `Encryption failed: ${msg}`, code: "ENCRYPTION_ERROR", platform_key_mode: platformKeyMode }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get current active secrets to disable them BEFORE inserting new one
    const { data: oldSecrets } = await adminClient
      .from("provider_instance_secrets")
      .select("id, key_version, is_active")
      .eq("provider_instance_id", instance.id)
      .order("key_version", { ascending: false });

    // Get next version
    const maxVersion = oldSecrets && oldSecrets.length > 0 
      ? Math.max(...oldSecrets.map(s => s.key_version || 0))
      : 0;
    const nextVersion = maxVersion + 1;

    // Disable old secrets FIRST
    const oldActiveIds = (oldSecrets || []).filter(s => s.is_active).map(s => s.id);
    if (oldActiveIds.length > 0) {
      await adminClient
        .from("provider_instance_secrets")
        .update({ is_active: false })
        .in("id", oldActiveIds);
    }

    // Insert new secret row
    const { data: newSecret, error: secErr } = await adminClient
      .from("provider_instance_secrets")
      .insert({
        provider_instance_id: instance.id,
        organization_id: instance.scope === "PLATFORM" ? null : instance.organization_id,
        key_version: nextVersion,
        is_active: true,
        cipher_text: encResult.cipherHex,
        nonce: encResult.nonceHex,
        created_by: "00000000-0000-0000-0000-000000000000",
        scope: instance.scope || "PLATFORM",
      })
      .select("id, key_version, is_active, scope")
      .single();

    if (secErr) {
      return new Response(
        JSON.stringify({ error: "Failed to store re-encrypted secret", detail: secErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Verify round-trip: read back and decrypt to prove it works ──
    let decrypt_ok = false;
    let verifyError: string | null = null;
    try {
      const { data: verifyRow } = await adminClient
        .from("provider_instance_secrets")
        .select("cipher_text, nonce")
        .eq("id", newSecret.id)
        .single();
      
      if (verifyRow) {
        const cipherBytes = parseBytea(verifyRow.cipher_text);
        const nonceBytes = parseBytea(verifyRow.nonce);
        const decrypted = await decryptSecret(cipherBytes, nonceBytes);
        decrypt_ok = decrypted === secretValue;
        if (!decrypt_ok) verifyError = "Decrypted value mismatch";
      }
    } catch (err: unknown) {
      verifyError = err instanceof Error ? err.message : String(err);
    }

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id: instance.organization_id || "a0000000-0000-0000-0000-000000000001",
      action_type: "PROVIDER_SECRET_REENCRYPT",
      autonomy_tier: "USER",
      reasoning: `Re-encrypted secret for instance "${instance.name}" (v${nextVersion}) using env var ${env_secret_name}. Plaintext unchanged. decrypt_ok=${decrypt_ok}. platform_key_mode=${platformKeyMode}`,
      target_entity_type: "provider_instance_secret",
      target_entity_id: newSecret.id,
      evidence: {
        instance_id: instance.id,
        instance_name: instance.name,
        scope: instance.scope,
        key_version: nextVersion,
        mode: "REENCRYPT",
        env_source: env_secret_name,
        plaintext_changed: false,
        old_secrets_disabled: oldActiveIds.length,
        decrypt_ok,
        verify_error: verifyError,
        platform_key_mode: platformKeyMode,
      },
    });

    // Resolve any DECRYPT_FAILED alerts
    await adminClient
      .from("alert_instances")
      .update({ status: "RESOLVED", resolved_at: new Date().toISOString() })
      .eq("entity_type", "provider_instance")
      .eq("entity_id", instance.id)
      .eq("alert_type", "PROVIDER_SECRET_DECRYPT_FAILED")
      .in("status", ["PENDING", "ACKNOWLEDGED"]);

    return new Response(
      JSON.stringify({
        ok: decrypt_ok,
        mode: "REENCRYPT",
        was_reencrypted: true,
        plaintext_changed: false,
        decrypt_ok,
        verify_error: verifyError,
        platform_key_mode: platformKeyMode,
        secret: {
          id: newSecret.id,
          key_version: newSecret.key_version,
          is_active: newSecret.is_active,
          scope: newSecret.scope,
        },
        old_secrets_disabled: oldActiveIds.length,
        instance_id: instance.id,
        instance_name: instance.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
