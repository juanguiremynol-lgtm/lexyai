import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
};

// ============= TYPES =============

interface Step {
  name: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
  meta?: Record<string, unknown>;
}

interface ConnectivityResult {
  method: 'FIRECRAWL' | 'EDGE_DIRECT';
  edge_blocked: boolean;
  firecrawl_available: boolean;
  reason?: string;
}

type AuthStatus = 'CONNECTED' | 'AUTH_FAILED' | 'CAPTCHA_REQUIRED' | 'NEEDS_REAUTH' | 'ERROR' | 'EDGE_TLS_BLOCKED';

// ============= AES-256-GCM ENCRYPTION =============

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyB64 = Deno.env.get('ICARUS_ENCRYPTION_KEY') || '';
  if (!keyB64) {
    throw new Error('ICARUS_ENCRYPTION_KEY not configured');
  }
  const keyBytes = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  if (keyBytes.length !== 32) {
    throw new Error('ICARUS_ENCRYPTION_KEY must be 32 bytes');
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
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptSecret(encrypted: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error('[DECRYPT] Error:', err);
    return '';
  }
}

// ============= REQUEST ID & RESPONSE HELPERS =============

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonError(status: number, code: string, message: string, meta?: Record<string, unknown>): Response {
  const request_id = generateRequestId();
  const body = {
    ok: false,
    code,
    message,
    request_id,
    ...(meta || {}),
    timestamp: new Date().toISOString(),
  };
  console.error(`[icarus-auth] Error ${code}: ${message}`);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonSuccess(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ ok: true, request_id: generateRequestId(), ...data, timestamp: new Date().toISOString() }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============= CONNECTIVITY CHECK =============

async function checkConnectivity(steps: Step[]): Promise<ConnectivityResult> {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  // We always use Firecrawl now - Edge cannot reach ICARUS
  steps.push({
    name: 'CONNECTIVITY_CHECK',
    started_at: new Date().toISOString(),
    status: 'running',
    detail: 'Checking connectivity method',
  });

  // Quick test: try to reach ICARUS from Edge (will fail)
  let edgeBlocked = true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch('https://icarus.com.co/', {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timeoutId);
    
    // If we get here without error, Edge can reach it
    if (response.status < 500) {
      edgeBlocked = false;
    }
  } catch (err) {
    // Expected: TLS handshake failure
    edgeBlocked = true;
    console.log('[CONNECTIVITY] Edge blocked:', err instanceof Error ? err.message : 'unknown');
  }

  const step = steps[steps.length - 1];
  step.finished_at = new Date().toISOString();

  if (!firecrawlKey) {
    step.status = 'error';
    step.detail = 'FIRECRAWL_API_KEY not configured';
    step.meta = { edge_blocked: edgeBlocked };
    return {
      method: 'EDGE_DIRECT',
      edge_blocked: edgeBlocked,
      firecrawl_available: false,
      reason: 'FIRECRAWL_API_KEY not configured',
    };
  }

  step.status = 'success';
  step.detail = edgeBlocked 
    ? 'Edge blocked (TLS); using Firecrawl browser worker'
    : 'Using Firecrawl for reliability';
  step.meta = { edge_blocked: edgeBlocked, firecrawl_available: true };

  return {
    method: 'FIRECRAWL',
    edge_blocked: edgeBlocked,
    firecrawl_available: true,
  };
}

// ============= FIRECRAWL LOGIN =============

interface FirecrawlLoginResult {
  ok: boolean;
  authenticated: boolean;
  session_html?: string;
  processes_count?: number;
  error?: string;
  raw_response?: unknown;
}

async function performFirecrawlLogin(
  username: string,
  password: string,
  steps: Step[]
): Promise<FirecrawlLoginResult> {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  if (!firecrawlKey) {
    return { ok: false, authenticated: false, error: 'FIRECRAWL_API_KEY not configured' };
  }

  steps.push({
    name: 'FIRECRAWL_LOGIN',
    started_at: new Date().toISOString(),
    status: 'running',
    detail: 'Performing browser-based login via Firecrawl',
  });

  try {
    // Step 1: Login with Firecrawl Actions
    const loginPayload = {
      url: 'https://icarus.com.co/',
      actions: [
        // Wait for page to load
        { type: 'wait', milliseconds: 2000 },
        // Wait for login form
        { type: 'wait', selector: 'input[type="text"], input[type="email"], input[name*="username"], input[name*="usuario"], input[id*="username"], input[id*="usuario"]', timeout: 15000 },
        // Fill username (try multiple selectors)
        { type: 'input', selector: 'input[type="text"], input[type="email"], input[name*="username"], input[name*="usuario"]', text: username },
        // Fill password
        { type: 'input', selector: 'input[type="password"]', text: password },
        // Wait a moment
        { type: 'wait', milliseconds: 500 },
        // Click login button
        { type: 'click', selector: 'button[type="submit"], input[type="submit"], button[name*="login"], button[name*="Ingresar"], button[id*="btnIngresar"], .btn-primary' },
        // Wait for navigation
        { type: 'wait', milliseconds: 3000 },
        // Wait for authenticated content
        { type: 'wait', selector: 'a[href*="Salir"], a[href*="logout"], a[onclick*="logout"], .logout-link, .user-menu, .nav-user', timeout: 10000 },
      ],
      formats: ['html', 'markdown'],
      waitFor: 3000,
    };

    console.log('[Firecrawl] Sending login actions...');
    
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(loginPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      const step = steps[steps.length - 1];
      step.status = 'error';
      step.detail = `Firecrawl API error: ${data.error || response.status}`;
      step.finished_at = new Date().toISOString();
      step.meta = { http_status: response.status };
      return { ok: false, authenticated: false, error: `Firecrawl API error: ${data.error || response.status}`, raw_response: data };
    }

    // Check response for authentication markers
    const html = data.data?.html || data.html || '';
    const markdown = data.data?.markdown || data.markdown || '';
    const screenshot = data.data?.screenshot || data.screenshot;
    
    // Authentication check
    const authMarkers = ['salir', 'cerrar sesión', 'logout', 'bienvenido', 'mi cuenta', 'process/list'];
    const loginMarkers = ['iniciar sesión', 'ingresar', 'login', 'contraseña', 'password'];
    
    const lowerHtml = html.toLowerCase();
    const lowerMarkdown = markdown.toLowerCase();
    
    const hasAuthMarker = authMarkers.some(m => lowerHtml.includes(m) || lowerMarkdown.includes(m));
    const hasLoginMarker = loginMarkers.some(m => lowerHtml.includes(m) || lowerMarkdown.includes(m));
    
    // If we see auth markers and NOT login markers, we're authenticated
    const isAuthenticated = hasAuthMarker && !hasLoginMarker;

    const step = steps[steps.length - 1];
    step.finished_at = new Date().toISOString();
    step.meta = {
      has_auth_markers: hasAuthMarker,
      has_login_markers: hasLoginMarker,
      html_length: html.length,
      has_screenshot: !!screenshot,
    };

    if (isAuthenticated) {
      step.status = 'success';
      step.detail = 'Login successful - authenticated markers found';

      // Now fetch the process list page
      steps.push({
        name: 'FIRECRAWL_LIST',
        started_at: new Date().toISOString(),
        status: 'running',
        detail: 'Fetching process list after login',
      });

      const listPayload = {
        url: 'https://icarus.com.co/main/process/list.xhtml',
        formats: ['html'],
        waitFor: 2000,
      };

      try {
        const listResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(listPayload),
        });

        const listData = await listResponse.json();
        const listHtml = listData.data?.html || listData.html || '';

        // Count processes in the table
        const radicadoPattern = /\d{2}-\d{3}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5}/g;
        const matches = listHtml.match(radicadoPattern) || [];
        const uniqueRadicados = [...new Set(matches)];

        const listStep = steps[steps.length - 1];
        listStep.finished_at = new Date().toISOString();
        listStep.status = 'success';
        listStep.detail = `Found ${uniqueRadicados.length} processes`;
        listStep.meta = { processes_count: uniqueRadicados.length };

        return {
          ok: true,
          authenticated: true,
          session_html: listHtml,
          processes_count: uniqueRadicados.length,
        };
      } catch (listErr) {
        const listStep = steps[steps.length - 1];
        listStep.finished_at = new Date().toISOString();
        listStep.status = 'error';
        listStep.detail = listErr instanceof Error ? listErr.message : 'List fetch failed';

        // Still return success for login, just couldn't get list
        return {
          ok: true,
          authenticated: true,
          processes_count: 0,
          error: 'Login OK but failed to fetch list',
        };
      }
    }

    // Not authenticated
    step.status = 'error';
    
    // Check for CAPTCHA
    if (lowerHtml.includes('captcha') || lowerHtml.includes('recaptcha') || lowerHtml.includes('hcaptcha')) {
      step.detail = 'CAPTCHA detected on login page';
      return { ok: false, authenticated: false, error: 'CAPTCHA required', raw_response: data };
    }

    // Invalid credentials
    if (lowerHtml.includes('error') || lowerHtml.includes('incorrecto') || lowerHtml.includes('inválido')) {
      step.detail = 'Invalid credentials error shown';
      return { ok: false, authenticated: false, error: 'Invalid credentials', raw_response: data };
    }

    step.detail = 'Login did not authenticate - no auth markers found';
    return { 
      ok: false, 
      authenticated: false, 
      error: 'Login failed - authentication not successful',
      raw_response: { html_snippet: html.substring(0, 1000) },
    };

  } catch (err) {
    const step = steps[steps.length - 1];
    step.status = 'error';
    step.detail = err instanceof Error ? err.message : 'Unknown error';
    step.finished_at = new Date().toISOString();
    return { ok: false, authenticated: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============= ENCRYPTION KEY VALIDATION =============

function validateEncryptionKey(): { valid: boolean; error?: string } {
  const keyB64 = Deno.env.get('ICARUS_ENCRYPTION_KEY') || '';
  if (!keyB64) {
    return { valid: false, error: 'ICARUS_ENCRYPTION_KEY not configured' };
  }
  try {
    const decoded = atob(keyB64);
    if (decoded.length !== 32) {
      return { valid: false, error: `Key is ${decoded.length} bytes, must be 32` };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Key is not valid base64' };
  }
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const steps: Step[] = [];

  const addStep = (name: string, status: 'success' | 'error', detail?: string, meta?: Record<string, unknown>) => {
    steps.push({
      name,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status,
      detail,
      meta,
    });
  };

  try {
    // Step 1: Validate environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      addStep('ENV_CHECK', 'error', 'Missing SUPABASE_URL or SERVICE_ROLE_KEY');
      return jsonError(500, 'FUNCTION_MISCONFIG', 'Missing Supabase configuration', { steps });
    }
    addStep('ENV_CHECK', 'success', 'Supabase config present');

    // Step 2: Validate encryption key
    const keyCheck = validateEncryptionKey();
    if (!keyCheck.valid) {
      addStep('KEY_CHECK', 'error', keyCheck.error);
      return jsonError(500, 'MISSING_OR_INVALID_SECRET', keyCheck.error || 'Invalid encryption key', { steps });
    }
    addStep('KEY_CHECK', 'success', 'Encryption key valid');

    // Step 3: Check Firecrawl availability
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      addStep('FIRECRAWL_CHECK', 'error', 'FIRECRAWL_API_KEY not configured');
      return jsonError(500, 'FIRECRAWL_NOT_CONFIGURED', 'Firecrawl API key is required for ICARUS integration', { steps });
    }
    addStep('FIRECRAWL_CHECK', 'success', 'Firecrawl configured');

    // Step 4: Parse request body safely
    let payload: { action?: string; username?: string; password?: string } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        payload = JSON.parse(text);
      }
    } catch {
      // Empty or invalid JSON is OK
    }
    
    const action = payload.action || 'refresh';
    addStep('PARSE_BODY', 'success', `Action: ${action}`);

    // Step 5: Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      addStep('AUTH_CHECK', 'error', 'Missing Authorization header');
      return jsonError(401, 'UNAUTHORIZED', 'Missing Authorization header', { steps });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      addStep('AUTH_CHECK', 'error', authError?.message || 'Invalid token');
      return jsonError(401, 'UNAUTHORIZED', authError?.message || 'Invalid token', { steps });
    }
    
    const userId = user.id;
    addStep('AUTH_CHECK', 'success', `User: ${userId.substring(0, 8)}...`);

    // Step 6: Check connectivity
    const connectivity = await checkConnectivity(steps);

    // ============= ACTION: LOGIN =============
    if (action === 'login') {
      const { username, password } = payload;
      
      if (!username || !password) {
        addStep('VALIDATE_INPUT', 'error', 'Missing username or password');
        return jsonError(400, 'MISSING_CREDENTIALS', 'Username and password are required', { steps });
      }
      addStep('VALIDATE_INPUT', 'success', `Username: ${username}`);

      console.log(`[icarus-auth] Starting Firecrawl login for user ${userId.substring(0, 8)}...`);

      const result = await performFirecrawlLogin(username, password, steps);

      if (!result.ok || !result.authenticated) {
        // Log the failed attempt
        await supabase.from('icarus_sync_runs').insert({
          owner_id: userId,
          status: 'ERROR',
          mode: 'auth',
          classification: result.error?.includes('CAPTCHA') ? 'CAPTCHA_REQUIRED' : 'AUTH_FAILED',
          steps,
          error_message: result.error,
          finished_at: new Date().toISOString(),
        });

        return jsonError(400, 'AUTH_FAILED', result.error || 'Authentication failed', { 
          steps,
          connectivity,
          worker_method: 'FIRECRAWL',
        });
      }

      // Save credentials
      const encryptedPassword = await encryptSecret(password);

      const { error: upsertError } = await supabase
        .from('integrations')
        .upsert({
          owner_id: userId,
          provider: 'ICARUS',
          status: 'CONNECTED',
          username,
          password_encrypted: encryptedPassword,
          session_encrypted: null, // Firecrawl manages sessions differently
          session_last_ok_at: new Date().toISOString(),
          last_error: null,
          metadata: { worker_method: 'FIRECRAWL', processes_count: result.processes_count },
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'owner_id,provider',
        });

      if (upsertError) {
        console.error('[icarus-auth] Failed to save integration:', upsertError);
        addStep('SAVE_INTEGRATION', 'error', upsertError.message);
        return jsonError(500, 'DB_ERROR', 'Failed to save integration', { steps, db_error: upsertError.message });
      }
      addStep('SAVE_INTEGRATION', 'success', 'Integration saved');

      // Log successful run
      await supabase.from('icarus_sync_runs').insert({
        owner_id: userId,
        status: 'SUCCESS',
        mode: 'auth',
        classification: 'SUCCESS',
        steps,
        processes_found: result.processes_count || 0,
        finished_at: new Date().toISOString(),
      });

      console.log(`[icarus-auth] Login successful for user ${userId.substring(0, 8)}...`);

      return jsonSuccess({ 
        message: 'Login successful via Firecrawl browser worker',
        status: 'CONNECTED',
        session_stored: true,
        processes_count: result.processes_count || 0,
        worker_method: 'FIRECRAWL',
        connectivity,
        steps,
      });
    }

    // ============= ACTION: REFRESH =============
    if (action === 'refresh') {
      const { data: integration, error: loadError } = await supabase
        .from('integrations')
        .select('*')
        .eq('owner_id', userId)
        .eq('provider', 'ICARUS')
        .maybeSingle();

      if (loadError) {
        addStep('LOAD_INTEGRATION', 'error', loadError.message);
        return jsonError(500, 'DB_ERROR', 'Failed to load integration', { steps });
      }

      if (!integration) {
        addStep('LOAD_INTEGRATION', 'error', 'No ICARUS integration found');
        return jsonError(404, 'INTEGRATION_NOT_FOUND', 'No ICARUS integration found', { steps });
      }
      addStep('LOAD_INTEGRATION', 'success', `Found integration: ${integration.id.substring(0, 8)}...`);

      if (!integration.username || !integration.password_encrypted) {
        addStep('CHECK_CREDENTIALS', 'error', 'Missing stored credentials');
        return jsonError(400, 'MISSING_CREDENTIALS', 'No stored credentials', { steps });
      }
      addStep('CHECK_CREDENTIALS', 'success', `Username: ${integration.username}`);

      let decryptedPassword: string;
      try {
        decryptedPassword = await decryptSecret(integration.password_encrypted);
        if (!decryptedPassword) {
          throw new Error('Decryption returned empty');
        }
        addStep('DECRYPT', 'success', 'Password decrypted');
      } catch (err) {
        addStep('DECRYPT', 'error', err instanceof Error ? err.message : 'Decrypt failed');
        return jsonError(500, 'DECRYPT_FAILED', 'Failed to decrypt password', { steps });
      }

      console.log(`[icarus-auth] Refreshing via Firecrawl for user ${userId.substring(0, 8)}...`);
      const result = await performFirecrawlLogin(integration.username, decryptedPassword, steps);

      if (!result.ok || !result.authenticated) {
        await supabase.from('integrations').update({
          status: 'NEEDS_REAUTH',
          last_error: result.error,
          updated_at: new Date().toISOString(),
        }).eq('id', integration.id);

        return jsonError(400, 'AUTH_FAILED', result.error || 'Authentication failed', { 
          steps,
          connectivity,
          worker_method: 'FIRECRAWL',
        });
      }

      // Update integration status
      await supabase.from('integrations').update({
        status: 'CONNECTED',
        session_last_ok_at: new Date().toISOString(),
        last_error: null,
        metadata: { worker_method: 'FIRECRAWL', processes_count: result.processes_count },
        updated_at: new Date().toISOString(),
      }).eq('id', integration.id);
      addStep('UPDATE_INTEGRATION', 'success', 'Status updated');

      console.log(`[icarus-auth] Session refreshed for user ${userId.substring(0, 8)}...`);

      return jsonSuccess({ 
        message: 'Session refreshed via Firecrawl',
        status: 'CONNECTED',
        session_stored: true,
        processes_count: result.processes_count || 0,
        worker_method: 'FIRECRAWL',
        connectivity,
        steps,
      });
    }

    return jsonError(400, 'UNKNOWN_ACTION', `Unknown action: ${action}`, { steps });

  } catch (err) {
    console.error('[icarus-auth] Unexpected error:', err);
    return jsonError(500, 'UNKNOWN_ERROR', err instanceof Error ? err.message : 'Unknown error', { steps });
  }
});
