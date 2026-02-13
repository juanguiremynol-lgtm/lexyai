/**
 * internal-bootstrap-secret — Self-contained bootstrap for provider instance secrets.
 * Generates its own AES key, encrypts the secret, and stores both.
 * DELETE THIS FUNCTION after initial setup.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bootstrap-token",
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const bootstrapKey = req.headers.get("x-bootstrap-token") || "";
    if (bootstrapKey !== "BOOTSTRAP_SAMAI_2026") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { instance_id, secret_value: bodySecret, secret_env, enable = true } = body;
    
    // Allow reading secret from env variable name
    const secret_value = bodySecret || (secret_env ? Deno.env.get(secret_env) : null);

    if (!instance_id || !secret_value) {
      return new Response(
        JSON.stringify({ error: "instance_id and (secret_value or secret_env) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Deactivate existing secrets
    await adminClient
      .from("provider_instance_secrets")
      .update({ is_active: false })
      .eq("provider_instance_id", instance_id)
      .eq("is_active", true);

    // Get next version
    const { data: lastSecret } = await adminClient
      .from("provider_instance_secrets")
      .select("key_version")
      .eq("provider_instance_id", instance_id)
      .order("key_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (lastSecret?.key_version || 0) + 1;

    // Try using the shared crypto module first
    let cipher: Uint8Array;
    let nonce: Uint8Array;
    
    try {
      // Try the env-based approach
      const keyB64 = Deno.env.get("ATENIA_SECRETS_KEY_B64") || "";
      console.log("Attempting encryption with key length:", keyB64.length);
      
      // Manual base64 decode
      const bin = atob(keyB64);
      const keyRaw = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) keyRaw[i] = bin.charCodeAt(i);
      
      if (keyRaw.byteLength !== 32) {
        throw new Error(`Key is ${keyRaw.byteLength} bytes, need 32`);
      }
      
      const aesKey = await crypto.subtle.importKey("raw", keyRaw, "AES-GCM", false, ["encrypt", "decrypt"]);
      nonce = crypto.getRandomValues(new Uint8Array(12));
      const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, new TextEncoder().encode(secret_value));
      cipher = new Uint8Array(cipherBuf);
    } catch (e) {
      // Fallback: generate a new key, store it, and encrypt
      console.log("Shared key failed, generating new key:", e instanceof Error ? e.message : String(e));
      
      const newKeyRaw = crypto.getRandomValues(new Uint8Array(32));
      let binary = '';
      for (let i = 0; i < newKeyRaw.length; i++) binary += String.fromCharCode(newKeyRaw[i]);
      const newKeyB64 = btoa(binary);
      
      console.log("Generated new AES key, length:", newKeyB64.length, "Store this as ATENIA_SECRETS_KEY_B64:", newKeyB64);
      
      const aesKey = await crypto.subtle.importKey("raw", newKeyRaw, "AES-GCM", false, ["encrypt", "decrypt"]);
      nonce = crypto.getRandomValues(new Uint8Array(12));
      const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, new TextEncoder().encode(secret_value));
      cipher = new Uint8Array(cipherBuf);
      
      // Return with the key so it can be saved
      const { data: newSecret, error: secErr } = await adminClient
        .from("provider_instance_secrets")
        .insert({
          provider_instance_id: instance_id,
          organization_id: null,
          key_version: nextVersion,
          is_active: enable,
          cipher_text: "\\x" + bytesToHex(cipher),
          nonce: "\\x" + bytesToHex(nonce),
          created_by: null,
          scope: "PLATFORM",
        })
        .select("id, key_version, is_active")
        .single();

      if (secErr) {
        return new Response(
          JSON.stringify({ error: "Failed to store", detail: secErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ 
          ok: true, 
          secret: newSecret, 
          instance_id,
          IMPORTANT_save_this_key: newKeyB64,
          message: "Secret encrypted with a NEW key. You MUST update ATENIA_SECRETS_KEY_B64 to this exact value for decryption to work."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Insert with existing key
    const { data: newSecret, error: secErr } = await adminClient
      .from("provider_instance_secrets")
      .insert({
        provider_instance_id: instance_id,
        organization_id: null,
        key_version: nextVersion,
        is_active: enable,
        cipher_text: "\\x" + bytesToHex(cipher),
        nonce: "\\x" + bytesToHex(nonce),
        created_by: null,
        scope: "PLATFORM",
      })
      .select("id, key_version, is_active")
      .single();

    if (secErr) {
      return new Response(
        JSON.stringify({ error: "Failed to store", detail: secErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, secret: newSecret, instance_id, used_existing_key: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
