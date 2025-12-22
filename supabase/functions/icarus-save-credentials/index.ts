import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ============= AES-256-GCM ENCRYPTION =============

function validateAndGetEncryptionKey(): { valid: boolean; keyBytes?: Uint8Array; error?: string } {
  const keyB64 = Deno.env.get('ICARUS_ENCRYPTION_KEY') || '';
  
  if (!keyB64) {
    return { valid: false, error: 'ICARUS_ENCRYPTION_KEY not configured in secrets' };
  }
  
  try {
    const decoded = atob(keyB64);
    const keyBytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      keyBytes[i] = decoded.charCodeAt(i);
    }
    
    if (keyBytes.length !== 32) {
      return { valid: false, error: `ICARUS_ENCRYPTION_KEY is ${keyBytes.length} bytes, must be exactly 32 bytes (base64 encoded)` };
    }
    
    return { valid: true, keyBytes };
  } catch (err) {
    return { valid: false, error: `ICARUS_ENCRYPTION_KEY is not valid base64: ${err instanceof Error ? err.message : 'decode failed'}` };
  }
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const validation = validateAndGetEncryptionKey();
  if (!validation.valid || !validation.keyBytes) {
    throw new Error(validation.error || 'Encryption key validation failed');
  }
  
  return await crypto.subtle.importKey(
    'raw',
    validation.keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

// ============= ERROR RESPONSE HELPER =============

function errorResponse(
  code: string, 
  message: string, 
  status: number = 500
): Response {
  console.error(`[icarus-save-credentials] Error ${code}: ${message}`);
  return new Response(
    JSON.stringify({ 
      ok: false, 
      code, 
      message,
      timestamp: new Date().toISOString(),
    }),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse('FUNCTION_MISCONFIG', 'Missing Supabase configuration', 500);
  }

  try {
    // Validate encryption key FIRST before doing anything else
    const keyValidation = validateAndGetEncryptionKey();
    if (!keyValidation.valid) {
      return errorResponse('MISSING_SECRET', keyValidation.error || 'Encryption key invalid', 500);
    }

    // Parse request body
    let body: { username?: string; password?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400);
    }

    const { username, password } = body;

    if (!username || !password) {
      return errorResponse('INVALID_REQUEST', 'Username and password are required', 400);
    }

    // Get user from auth header - MANDATORY
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    // Create Supabase client with user's JWT
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.error('[icarus-save-credentials] Auth error:', authError?.message);
      return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
    }

    const userId = user.id;
    console.log(`[icarus-save-credentials] Saving credentials for user ${userId.substring(0, 8)}...`);

    // Encrypt the password
    let encryptedPassword: string;
    try {
      encryptedPassword = await encryptSecret(password);
      console.log(`[icarus-save-credentials] Password encrypted successfully`);
    } catch (encryptError) {
      console.error('[icarus-save-credentials] Encryption error:', encryptError);
      return errorResponse(
        'ENCRYPTION_ERROR', 
        encryptError instanceof Error ? encryptError.message : 'Failed to encrypt password',
        500
      );
    }

    // Check if integration already exists
    const { data: existing, error: selectError } = await supabase
      .from('integrations')
      .select('id')
      .eq('owner_id', userId)
      .eq('provider', 'ICARUS')
      .maybeSingle();

    if (selectError) {
      console.error('[icarus-save-credentials] Select error:', selectError);
      return errorResponse('DB_ERROR', `Failed to check existing integration: ${selectError.message}`, 500);
    }

    let integrationId: string;

    if (existing) {
      // Update existing
      console.log(`[icarus-save-credentials] Updating existing integration ${existing.id.substring(0, 8)}...`);
      const { error: updateError } = await supabase
        .from('integrations')
        .update({
          username,
          password_encrypted: encryptedPassword,
          status: 'PENDING',
          last_error: null,
          session_encrypted: null, // Clear old session
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error('[icarus-save-credentials] Update error:', updateError);
        return errorResponse('DB_ERROR', `Failed to update credentials: ${updateError.message}`, 500);
      }
      integrationId = existing.id;
    } else {
      // Insert new
      console.log(`[icarus-save-credentials] Creating new integration for user ${userId.substring(0, 8)}...`);
      const { data: newIntegration, error: insertError } = await supabase
        .from('integrations')
        .insert({
          owner_id: userId,
          provider: 'ICARUS',
          username,
          password_encrypted: encryptedPassword,
          status: 'PENDING',
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[icarus-save-credentials] Insert error:', insertError);
        // Check for RLS denial
        if (insertError.message?.includes('row-level security')) {
          return errorResponse('RLS_DENIED', 'Row-level security policy denied access', 403);
        }
        return errorResponse('DB_ERROR', `Failed to save credentials: ${insertError.message}`, 500);
      }
      integrationId = newIntegration.id;
    }

    console.log(`[icarus-save-credentials] Success, integration ID: ${integrationId.substring(0, 8)}...`);

    return new Response(
      JSON.stringify({ 
        ok: true, 
        message: 'Credentials saved successfully',
        integration_id: integrationId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[icarus-save-credentials] Unexpected error:', err);
    return errorResponse(
      'UNKNOWN_ERROR',
      err instanceof Error ? err.message : 'Unknown error occurred',
      500
    );
  }
});
