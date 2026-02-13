/**
 * Diagnostic: check ATENIA_SECRETS_KEY_B64 byte length (no secret material exposed)
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const keyB64 = Deno.env.get("ATENIA_SECRETS_KEY_B64");
  if (!keyB64) {
    return new Response(JSON.stringify({ exists: false, error: "Not set" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const bin = atob(keyB64);
    const byteLength = bin.length;
    return new Response(JSON.stringify({
      exists: true,
      b64_string_length: keyB64.length,
      decoded_byte_length: byteLength,
      is_valid_32_bytes: byteLength === 32,
      first_4_chars: keyB64.substring(0, 4) + "...",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      exists: true,
      b64_string_length: keyB64.length,
      decode_error: e instanceof Error ? e.message : String(e),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
