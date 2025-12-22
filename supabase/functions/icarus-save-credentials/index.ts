import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= AES-256-GCM ENCRYPTION =============

const ENCRYPTION_KEY_B64 = Deno.env.get('ICARUS_ENCRYPTION_KEY') || '';

async function getEncryptionKey(): Promise<CryptoKey> {
  if (!ENCRYPTION_KEY_B64) {
    throw new Error('ICARUS_ENCRYPTION_KEY not configured');
  }
  const keyBytes = Uint8Array.from(atob(ENCRYPTION_KEY_B64), c => c.charCodeAt(0));
  if (keyBytes.length !== 32) {
    throw new Error('ICARUS_ENCRYPTION_KEY must be 32 bytes (base64 encoded)');
  }
  return await crypto.subtle.importKey(
    'raw',
    keyBytes,
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

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Username and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user from auth header - MANDATORY
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Not authenticated - missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('[icarus-save-credentials] Auth error:', authError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Not authenticated - invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log(`[icarus-save-credentials] Saving credentials for user ${userId}`);

    // Encrypt the password
    const encryptedPassword = await encryptSecret(password);
    console.log(`[icarus-save-credentials] Password encrypted successfully`);

    // Check if integration already exists
    const { data: existing } = await supabase
      .from('integrations')
      .select('id')
      .eq('owner_id', userId)
      .eq('provider', 'ICARUS')
      .maybeSingle();

    let integrationId: string;

    if (existing) {
      // Update existing
      console.log(`[icarus-save-credentials] Updating existing integration ${existing.id}`);
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
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to update credentials: ' + updateError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      integrationId = existing.id;
    } else {
      // Insert new
      console.log(`[icarus-save-credentials] Creating new integration for user ${userId}`);
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
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to save credentials: ' + insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      integrationId = newIntegration.id;
    }

    console.log(`[icarus-save-credentials] Credentials saved, integration ID: ${integrationId}`);

    return new Response(
      JSON.stringify({ 
        ok: true, 
        message: 'Credentials saved successfully',
        integration_id: integrationId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[icarus-save-credentials] Error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
