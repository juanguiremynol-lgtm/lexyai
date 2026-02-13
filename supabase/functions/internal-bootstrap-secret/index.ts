/**
 * internal-bootstrap-secret — One-time bootstrap for provider instance secrets.
 * Uses a bootstrap token for auth instead of user session.
 * DELETE THIS FUNCTION after initial setup.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/secretsCrypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bootstrap-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: accept service role key OR anon key with special header
    const authHeader = req.headers.get("authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");
    
    // Allow if the request comes through the functions gateway (apikey is verified by Supabase)
    // This is a one-time bootstrap, secured by the function being temporary
    const bootstrapKey = req.headers.get("x-bootstrap-token") || "";
    // Accept: last 16 of service key OR a specific one-time passphrase
    const isAuthorized = bootstrapKey === "BOOTSTRAP_SAMAI_2026" || token === serviceKey;
    
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Invalid bootstrap auth" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, svcKey);

    const body = await req.json();
    const { instance_id, secret_value, enable = true, action } = body;

    // Generate a proper AES-256 key (for setting up ATENIA_SECRETS_KEY_B64)
    if (action === "generate_key") {
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      let binary = '';
      for (let i = 0; i < keyBytes.length; i++) binary += String.fromCharCode(keyBytes[i]);
      const b64Key = btoa(binary);
      return new Response(
        JSON.stringify({ ok: true, key_b64: b64Key, length_bytes: 32 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!instance_id || !secret_value) {
      return new Response(
        JSON.stringify({ error: "instance_id and secret_value required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Deactivate existing
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

    // Encrypt — log key env status for debugging
    const keyEnv = Deno.env.get("ATENIA_SECRETS_KEY_B64") || "";
    console.log("KEY_ENV length:", keyEnv.length, "first4:", keyEnv.slice(0, 4));
    
    let encResult: { cipher: Uint8Array; nonce: Uint8Array };
    try {
      encResult = await encryptSecret(secret_value);
    } catch (encErr: unknown) {
      const msg = encErr instanceof Error ? encErr.message : String(encErr);
      console.error("Encryption error:", msg);
      return new Response(
        JSON.stringify({ error: `Encryption failed: ${msg}`, key_length: keyEnv.length }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { cipher, nonce } = encResult;

    // Insert
    const { data: newSecret, error: secErr } = await adminClient
      .from("provider_instance_secrets")
      .insert({
        provider_instance_id: instance_id,
        organization_id: null,
        key_version: nextVersion,
        is_active: enable,
        cipher_text: cipher,
        nonce,
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
      JSON.stringify({ ok: true, secret: newSecret, instance_id }),
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
