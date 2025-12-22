const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function validateEncryptionKey(): { valid: boolean; error?: string } {
  const keyB64 = Deno.env.get('ICARUS_ENCRYPTION_KEY') || '';
  
  if (!keyB64) {
    return { valid: false, error: 'ICARUS_ENCRYPTION_KEY not set' };
  }
  
  try {
    // Try to decode base64
    const decoded = atob(keyB64);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    
    if (bytes.length !== 32) {
      return { valid: false, error: `Key length is ${bytes.length} bytes, expected 32` };
    }
    
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Invalid base64: ${err instanceof Error ? err.message : 'decode failed'}` };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const keyValidation = validateEncryptionKey();
    
    const response = {
      ok: true,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      hasKey: !!Deno.env.get('ICARUS_ENCRYPTION_KEY'),
      keyValid: keyValidation.valid,
      keyError: keyValidation.error,
      functions: [
        'icarus-health',
        'icarus-save-credentials',
        'icarus-auth',
        'adapter-icarus',
        'icarus-sync',
      ],
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (err) {
    console.error('[icarus-health] Error:', err);
    return new Response(
      JSON.stringify({ 
        ok: false, 
        code: 'HEALTH_CHECK_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error'
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
