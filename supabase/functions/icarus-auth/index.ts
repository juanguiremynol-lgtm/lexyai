import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============

interface AttemptLog {
  phase: string;
  url: string;
  method: string;
  status: number | null;
  latency_ms: number;
  error_type?: string;
  response_snippet?: string;
  success: boolean;
}

interface Step {
  name: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
}

interface CookieJar {
  cookies: { name: string; value: string; domain: string; path: string; expires?: string; secure?: boolean; httpOnly?: boolean }[];
  viewState?: string;
}

type AuthStatus = 'CONNECTED' | 'AUTH_FAILED' | 'CAPTCHA_REQUIRED' | 'NEEDS_REAUTH' | 'ERROR';

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
  // Combine IV + ciphertext and base64 encode
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
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error('[DECRYPT] Error:', err);
    return '';
  }
}

// ============= UTILITIES =============

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

function parseCookies(setCookieHeaders: string[]): CookieJar['cookies'] {
  const cookies: CookieJar['cookies'] = [];
  for (const header of setCookieHeaders) {
    const parts = header.split(';').map(p => p.trim());
    const [nameValue, ...attrs] = parts;
    const [name, value] = nameValue.split('=');
    if (!name || !value) continue;
    
    const cookie: CookieJar['cookies'][0] = {
      name: name.trim(),
      value: value.trim(),
      domain: 'icarus.com.co',
      path: '/',
    };
    
    for (const attr of attrs) {
      const [attrName, attrValue] = attr.split('=');
      const lowerName = attrName.toLowerCase().trim();
      if (lowerName === 'path') cookie.path = attrValue?.trim() || '/';
      if (lowerName === 'domain') cookie.domain = attrValue?.trim() || cookie.domain;
      if (lowerName === 'expires') cookie.expires = attrValue?.trim();
      if (lowerName === 'secure') cookie.secure = true;
      if (lowerName === 'httponly') cookie.httpOnly = true;
    }
    cookies.push(cookie);
  }
  return cookies;
}

function cookieJarToHeader(cookieJar: CookieJar): string {
  return cookieJar.cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function extractViewState(html: string): string | null {
  // Multiple patterns for JSF ViewState
  const patterns = [
    /name="javax\.faces\.ViewState"\s+value="([^"]+)"/i,
    /id="javax\.faces\.ViewState"\s+value="([^"]+)"/i,
    /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/i,
    /<input[^>]*name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractFormFields(html: string): { formId: string; usernameField: string; passwordField: string; submitButton: string } | null {
  // Look for login form
  const formMatch = html.match(/<form[^>]*id="([^"]+)"[^>]*>/i);
  if (!formMatch) return null;
  const formId = formMatch[1];
  
  // Look for username input (various patterns)
  const usernamePatterns = [
    /name="([^"]*(?:username|usuario|email|login|user)[^"]*)"/i,
    /id="([^"]*(?:username|usuario|email|login|user)[^"]*)"/i,
    /<input[^>]*type="(?:text|email)"[^>]*name="([^"]+)"/i,
  ];
  let usernameField = '';
  for (const pattern of usernamePatterns) {
    const match = html.match(pattern);
    if (match) { usernameField = match[1]; break; }
  }
  
  // Look for password input
  const passwordPatterns = [
    /name="([^"]*(?:password|clave|contrasena)[^"]*)"/i,
    /id="([^"]*(?:password|clave|contrasena)[^"]*)"/i,
    /<input[^>]*type="password"[^>]*name="([^"]+)"/i,
  ];
  let passwordField = '';
  for (const pattern of passwordPatterns) {
    const match = html.match(pattern);
    if (match) { passwordField = match[1]; break; }
  }
  
  // Look for submit button
  const submitPatterns = [
    /<button[^>]*type="submit"[^>]*name="([^"]+)"/i,
    /<input[^>]*type="submit"[^>]*name="([^"]+)"/i,
    /id="([^"]*(?:btnLogin|submit|ingresar|entrar)[^"]*)"/i,
  ];
  let submitButton = '';
  for (const pattern of submitPatterns) {
    const match = html.match(pattern);
    if (match) { submitButton = match[1]; break; }
  }
  
  return { formId, usernameField, passwordField, submitButton };
}

function detectCaptcha(html: string): boolean {
  const captchaIndicators = [
    'recaptcha',
    'g-recaptcha',
    'hcaptcha',
    'captcha',
    'data-sitekey',
    'grecaptcha',
  ];
  const lowerHtml = html.toLowerCase();
  return captchaIndicators.some(indicator => lowerHtml.includes(indicator));
}

function isAuthenticatedPage(html: string): boolean {
  const authIndicators = [
    'salir',
    'cerrar sesión',
    'logout',
    'mi cuenta',
    'bienvenido',
  ];
  const lowerHtml = html.toLowerCase();
  return authIndicators.some(indicator => lowerHtml.includes(indicator));
}

const ICARUS_BASE_URL = 'https://icarus.com.co';
const LOGIN_URL = `${ICARUS_BASE_URL}/login.xhtml`;
const PROCESS_LIST_URL = `${ICARUS_BASE_URL}/main/process/list.xhtml`;

// ============= LOGIN FLOW =============

async function performLogin(
  username: string,
  password: string,
  attempts: AttemptLog[],
  steps: Step[]
): Promise<{ ok: boolean; cookieJar?: CookieJar; status: AuthStatus; error?: string }> {
  
  // Step 1: GET login page
  steps.push({ name: 'GET_LOGIN', started_at: new Date().toISOString(), status: 'running' });
  
  const getAttempt: AttemptLog = {
    phase: 'GET_LOGIN',
    url: LOGIN_URL,
    method: 'GET',
    status: null,
    latency_ms: 0,
    success: false,
  };
  
  const startGet = Date.now();
  let getResponse: Response;
  let getHtml: string;
  let cookieJar: CookieJar = { cookies: [] };
  
  try {
    getResponse = await fetch(LOGIN_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
      },
      redirect: 'manual',
    });
    
    getAttempt.status = getResponse.status;
    getAttempt.latency_ms = Date.now() - startGet;
    getHtml = await getResponse.text();
    getAttempt.response_snippet = truncate(getHtml, 500);
    
    // Parse cookies from response
    const setCookies = getResponse.headers.getSetCookie?.() || [];
    cookieJar.cookies = parseCookies(setCookies);
    
    // Also check for Set-Cookie in headers (fallback)
    const setCookieHeader = getResponse.headers.get('set-cookie');
    if (setCookieHeader && cookieJar.cookies.length === 0) {
      cookieJar.cookies = parseCookies([setCookieHeader]);
    }
    
    getAttempt.success = true;
    attempts.push(getAttempt);
    
  } catch (err) {
    getAttempt.latency_ms = Date.now() - startGet;
    getAttempt.error_type = 'NETWORK_ERROR';
    getAttempt.response_snippet = err instanceof Error ? err.message : 'Unknown error';
    attempts.push(getAttempt);
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].detail = 'Failed to reach login page';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, status: 'ERROR', error: 'Failed to reach login page' };
  }
  
  // Check for CAPTCHA
  if (detectCaptcha(getHtml)) {
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].detail = 'CAPTCHA detected on login page';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, status: 'CAPTCHA_REQUIRED', error: 'CAPTCHA detected - manual login required' };
  }
  
  // Extract ViewState and form fields
  const viewState = extractViewState(getHtml);
  const formFields = extractFormFields(getHtml);
  
  if (!viewState) {
    console.log('[GET_LOGIN] ViewState not found in HTML, trying alternate patterns...');
    // Continue anyway - some forms might not have ViewState visible
  }
  
  steps[steps.length - 1].status = 'success';
  steps[steps.length - 1].detail = `Cookies: ${cookieJar.cookies.length}, ViewState: ${viewState ? 'found' : 'not found'}`;
  steps[steps.length - 1].finished_at = new Date().toISOString();
  
  cookieJar.viewState = viewState || undefined;
  
  // Step 2: POST login credentials
  steps.push({ name: 'POST_LOGIN', started_at: new Date().toISOString(), status: 'running' });
  
  const postAttempt: AttemptLog = {
    phase: 'POST_LOGIN',
    url: LOGIN_URL,
    method: 'POST',
    status: null,
    latency_ms: 0,
    success: false,
  };
  
  // Build form data - try common JSF field names
  const formData = new URLSearchParams();
  
  // Standard JSF fields
  if (viewState) {
    formData.append('javax.faces.ViewState', viewState);
  }
  
  // Try different field name patterns
  const usernameFieldNames = [
    formFields?.usernameField,
    'loginForm:username',
    'loginForm:j_username',
    'j_username',
    'username',
    'email',
    'loginForm:email',
  ].filter(Boolean) as string[];
  
  const passwordFieldNames = [
    formFields?.passwordField,
    'loginForm:password',
    'loginForm:j_password',
    'j_password',
    'password',
    'loginForm:clave',
  ].filter(Boolean) as string[];
  
  // Use first found or default
  formData.append(usernameFieldNames[0] || 'loginForm:username', username);
  formData.append(passwordFieldNames[0] || 'loginForm:password', password);
  
  // Add form and submit identifiers
  formData.append('loginForm', 'loginForm');
  if (formFields?.submitButton) {
    formData.append(formFields.submitButton, '');
  } else {
    formData.append('loginForm:btnIngresar', '');
    formData.append('loginForm:submit', '');
  }
  
  const startPost = Date.now();
  
  try {
    const postResponse = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieJarToHeader(cookieJar),
        'Referer': LOGIN_URL,
        'Origin': ICARUS_BASE_URL,
      },
      body: formData.toString(),
      redirect: 'manual',
    });
    
    postAttempt.status = postResponse.status;
    postAttempt.latency_ms = Date.now() - startPost;
    
    // Capture new cookies
    const newCookies = postResponse.headers.getSetCookie?.() || [];
    const parsedNew = parseCookies(newCookies);
    for (const newCookie of parsedNew) {
      const existingIdx = cookieJar.cookies.findIndex(c => c.name === newCookie.name);
      if (existingIdx >= 0) {
        cookieJar.cookies[existingIdx] = newCookie;
      } else {
        cookieJar.cookies.push(newCookie);
      }
    }
    
    // Handle redirect (302/303)
    if (postResponse.status === 302 || postResponse.status === 303) {
      const location = postResponse.headers.get('location');
      postAttempt.response_snippet = `Redirect to: ${location}`;
      postAttempt.success = true;
      attempts.push(postAttempt);
      
      // If redirected back to login, auth failed
      if (location?.includes('login')) {
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = 'Redirected back to login - invalid credentials';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, status: 'AUTH_FAILED', error: 'Invalid credentials' };
      }
      
      // Follow redirect to get final state
      if (location) {
        const redirectUrl = location.startsWith('http') ? location : `${ICARUS_BASE_URL}${location}`;
        const redirectResponse = await fetch(redirectUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cookie': cookieJarToHeader(cookieJar),
          },
          redirect: 'manual',
        });
        
        // Capture any new cookies from redirect
        const redirectCookies = redirectResponse.headers.getSetCookie?.() || [];
        for (const c of parseCookies(redirectCookies)) {
          const idx = cookieJar.cookies.findIndex(x => x.name === c.name);
          if (idx >= 0) cookieJar.cookies[idx] = c;
          else cookieJar.cookies.push(c);
        }
      }
    } else {
      const postHtml = await postResponse.text();
      postAttempt.response_snippet = truncate(postHtml, 500);
      
      // Check if we got an error message
      if (postHtml.includes('error') || postHtml.includes('incorrecto') || postHtml.includes('inválido')) {
        postAttempt.error_type = 'AUTH_FAILED';
        attempts.push(postAttempt);
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = 'Login error response';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, status: 'AUTH_FAILED', error: 'Invalid credentials' };
      }
      
      postAttempt.success = true;
      attempts.push(postAttempt);
    }
    
    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].detail = `Status: ${postAttempt.status}, Cookies: ${cookieJar.cookies.length}`;
    steps[steps.length - 1].finished_at = new Date().toISOString();
    
  } catch (err) {
    postAttempt.latency_ms = Date.now() - startPost;
    postAttempt.error_type = 'NETWORK_ERROR';
    postAttempt.response_snippet = err instanceof Error ? err.message : 'Unknown error';
    attempts.push(postAttempt);
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].detail = 'Network error during login';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, status: 'ERROR', error: 'Network error during login' };
  }
  
  // Step 3: Verify authentication
  steps.push({ name: 'VERIFY_AUTH', started_at: new Date().toISOString(), status: 'running' });
  
  const verifyAttempt: AttemptLog = {
    phase: 'VERIFY_AUTH',
    url: PROCESS_LIST_URL,
    method: 'GET',
    status: null,
    latency_ms: 0,
    success: false,
  };
  
  const startVerify = Date.now();
  
  try {
    const verifyResponse = await fetch(PROCESS_LIST_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieJarToHeader(cookieJar),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'manual',
    });
    
    verifyAttempt.status = verifyResponse.status;
    verifyAttempt.latency_ms = Date.now() - startVerify;
    
    // If redirected to login, auth failed
    if (verifyResponse.status === 302 || verifyResponse.status === 303) {
      const location = verifyResponse.headers.get('location');
      if (location?.includes('login')) {
        verifyAttempt.error_type = 'AUTH_FAILED';
        verifyAttempt.response_snippet = `Redirected to: ${location}`;
        attempts.push(verifyAttempt);
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = 'Session not valid - redirected to login';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, status: 'AUTH_FAILED', error: 'Session not established' };
      }
    }
    
    const verifyHtml = await verifyResponse.text();
    verifyAttempt.response_snippet = truncate(verifyHtml, 500);
    
    // Check for authenticated markers
    if (!isAuthenticatedPage(verifyHtml)) {
      // Check if it's a login page
      if (verifyHtml.toLowerCase().includes('login') || verifyHtml.toLowerCase().includes('iniciar sesión')) {
        verifyAttempt.error_type = 'AUTH_FAILED';
        attempts.push(verifyAttempt);
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = 'Got login page instead of process list';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, status: 'AUTH_FAILED', error: 'Authentication failed' };
      }
    }
    
    // Extract new ViewState for future requests
    const newViewState = extractViewState(verifyHtml);
    if (newViewState) {
      cookieJar.viewState = newViewState;
    }
    
    verifyAttempt.success = true;
    attempts.push(verifyAttempt);
    
    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].detail = 'Authenticated markers found';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    
    return { ok: true, cookieJar, status: 'CONNECTED' };
    
  } catch (err) {
    verifyAttempt.latency_ms = Date.now() - startVerify;
    verifyAttempt.error_type = 'NETWORK_ERROR';
    verifyAttempt.response_snippet = err instanceof Error ? err.message : 'Unknown error';
    attempts.push(verifyAttempt);
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].detail = 'Failed to verify authentication';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, status: 'ERROR', error: 'Failed to verify authentication' };
  }
}

// ============= ERROR HELPER =============

function jsonError(
  status: number,
  code: string,
  message: string,
  meta?: Record<string, unknown>
): Response {
  const body = {
    ok: false,
    code,
    message,
    ...(meta || {}),
    timestamp: new Date().toISOString(),
  };
  console.error(`[icarus-auth] Error ${code}: ${message}`, meta ? JSON.stringify(meta) : '');
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonSuccess(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ ok: true, ...data, timestamp: new Date().toISOString() }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
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
  const attempts: AttemptLog[] = [];

  // Add diagnostic step
  const addStep = (name: string, status: 'success' | 'error', detail?: string) => {
    steps.push({
      name,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status,
      detail,
    });
  };

  try {
    // Step 1: Validate environment
    addStep('ENV_CHECK', 'success', 'Supabase config present');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      addStep('ENV_CHECK', 'error', 'Missing SUPABASE_URL or SERVICE_ROLE_KEY');
      return jsonError(500, 'FUNCTION_MISCONFIG', 'Missing Supabase configuration', { steps });
    }

    // Step 2: Validate encryption key
    const keyCheck = validateEncryptionKey();
    if (!keyCheck.valid) {
      addStep('KEY_CHECK', 'error', keyCheck.error);
      return jsonError(500, 'MISSING_OR_INVALID_SECRET', keyCheck.error || 'Invalid encryption key', { steps });
    }
    addStep('KEY_CHECK', 'success', 'Encryption key valid (32 bytes)');

    // Step 3: Parse request body safely (handle empty body)
    let payload: { action?: string; username?: string; password?: string } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        payload = JSON.parse(text);
      }
    } catch {
      // Empty or invalid JSON is OK - we'll use defaults
    }
    
    const action = payload.action || 'refresh'; // Default to refresh
    addStep('PARSE_BODY', 'success', `Action: ${action}`);

    // Step 4: Authenticate user
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
      return jsonError(401, 'UNAUTHORIZED', authError?.message || 'Invalid or expired token', { steps });
    }
    
    const userId = user.id;
    addStep('AUTH_CHECK', 'success', `User: ${userId.substring(0, 8)}...`);

    // ============= ACTION: LOGIN (with provided credentials) =============
    if (action === 'login') {
      const { username, password } = payload;
      
      if (!username || !password) {
        addStep('VALIDATE_INPUT', 'error', 'Missing username or password');
        return jsonError(400, 'MISSING_CREDENTIALS', 'Username and password are required', { steps });
      }
      addStep('VALIDATE_INPUT', 'success', `Username: ${username}`);

      console.log(`[icarus-auth] Starting login for user ${userId.substring(0, 8)}...`);

      const result = await performLogin(username, password, attempts, steps);

      if (!result.ok) {
        // Record failed attempt
        await supabase.from('icarus_sync_runs').insert({
          owner_id: userId,
          status: 'ERROR',
          mode: 'auth',
          classification: result.status,
          steps,
          attempts,
          error_message: result.error,
          finished_at: new Date().toISOString(),
        });

        // Map result.status to appropriate HTTP code
        const httpStatus = result.status === 'CAPTCHA_REQUIRED' ? 403 : 400;
        const code = result.status === 'CAPTCHA_REQUIRED' ? 'CAPTCHA_REQUIRED' : 'AUTH_FAILED';

        return jsonError(httpStatus, code, result.error || 'Authentication failed', { 
          status: result.status, 
          steps, 
          attempts 
        });
      }

      // Encrypt credentials and session
      const encryptedPassword = await encryptSecret(password);
      const encryptedSession = await encryptSecret(JSON.stringify(result.cookieJar));

      // Save to integrations
      const { error: upsertError } = await supabase
        .from('integrations')
        .upsert({
          owner_id: userId,
          provider: 'ICARUS',
          status: 'CONNECTED',
          username,
          password_encrypted: encryptedPassword,
          session_encrypted: encryptedSession,
          session_last_ok_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'owner_id,provider',
        });

      if (upsertError) {
        console.error('[icarus-auth] Failed to save integration:', upsertError);
        addStep('SAVE_INTEGRATION', 'error', upsertError.message);
        return jsonError(500, 'DB_ERROR', 'Failed to save integration', { 
          steps, 
          attempts,
          db_error: upsertError.message 
        });
      }
      addStep('SAVE_INTEGRATION', 'success', 'Session stored');

      // Create success sync run record
      await supabase.from('icarus_sync_runs').insert({
        owner_id: userId,
        status: 'SUCCESS',
        mode: 'auth',
        classification: 'SUCCESS',
        steps,
        attempts,
        finished_at: new Date().toISOString(),
      });

      console.log(`[icarus-auth] Login successful for user ${userId.substring(0, 8)}...`);

      return jsonSuccess({ 
        message: 'Login successful',
        status: 'CONNECTED',
        session_stored: true,
        steps,
        attempts 
      });
    }

    // ============= ACTION: REFRESH SESSION (using stored credentials) =============
    if (action === 'refresh') {
      // Step 5: Load stored integration
      const { data: integration, error: loadError } = await supabase
        .from('integrations')
        .select('*')
        .eq('owner_id', userId)
        .eq('provider', 'ICARUS')
        .maybeSingle();

      if (loadError) {
        addStep('LOAD_INTEGRATION', 'error', loadError.message);
        return jsonError(500, 'DB_ERROR', 'Failed to load integration', { steps, db_error: loadError.message });
      }

      if (!integration) {
        addStep('LOAD_INTEGRATION', 'error', 'No ICARUS integration found');
        return jsonError(404, 'INTEGRATION_NOT_FOUND', 'No ICARUS integration found for this user', { steps });
      }
      addStep('LOAD_INTEGRATION', 'success', `Found integration: ${integration.id.substring(0, 8)}...`);

      if (!integration.username || !integration.password_encrypted) {
        addStep('CHECK_CREDENTIALS', 'error', 'Missing stored credentials');
        return jsonError(400, 'MISSING_CREDENTIALS', 'No stored credentials - please save credentials first', { steps });
      }
      addStep('CHECK_CREDENTIALS', 'success', `Username: ${integration.username}`);

      // Step 6: Decrypt password
      let decryptedPassword: string;
      try {
        decryptedPassword = await decryptSecret(integration.password_encrypted);
        if (!decryptedPassword) {
          throw new Error('Decryption returned empty string');
        }
        addStep('DECRYPT', 'success', 'Password decrypted');
      } catch (decryptErr) {
        addStep('DECRYPT', 'error', decryptErr instanceof Error ? decryptErr.message : 'Decrypt failed');
        return jsonError(500, 'DECRYPT_FAILED', 'Failed to decrypt stored password', { steps });
      }

      // Step 7: Perform login
      console.log(`[icarus-auth] Refreshing session for user ${userId.substring(0, 8)}...`);
      const result = await performLogin(integration.username, decryptedPassword, attempts, steps);

      if (!result.ok) {
        // Update integration with error status
        await supabase.from('integrations').update({
          status: result.status === 'CAPTCHA_REQUIRED' ? 'ERROR' : result.status,
          last_error: result.error,
          updated_at: new Date().toISOString(),
        }).eq('id', integration.id);

        const httpStatus = result.status === 'CAPTCHA_REQUIRED' ? 403 : 400;
        const code = result.status === 'CAPTCHA_REQUIRED' ? 'CAPTCHA_REQUIRED' : 'AUTH_FAILED';

        return jsonError(httpStatus, code, result.error || 'Authentication failed', { 
          status: result.status, 
          steps, 
          attempts 
        });
      }

      // Step 8: Save new session
      const encryptedSession = await encryptSecret(JSON.stringify(result.cookieJar));

      const { error: updateError } = await supabase.from('integrations').update({
        status: 'CONNECTED',
        session_encrypted: encryptedSession,
        session_last_ok_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', integration.id);

      if (updateError) {
        addStep('SAVE_SESSION', 'error', updateError.message);
        return jsonError(500, 'DB_ERROR', 'Failed to save session', { steps, db_error: updateError.message });
      }
      addStep('SAVE_SESSION', 'success', 'Session refreshed and stored');

      console.log(`[icarus-auth] Session refreshed for user ${userId.substring(0, 8)}...`);

      return jsonSuccess({ 
        message: 'Session refreshed',
        status: 'CONNECTED',
        session_stored: true,
        steps,
        attempts 
      });
    }

    // Unknown action
    return jsonError(400, 'UNKNOWN_ACTION', `Unknown action: ${action}`, { steps });

  } catch (err) {
    console.error('[icarus-auth] Unexpected error:', err);
    return jsonError(500, 'UNKNOWN_ERROR', err instanceof Error ? err.message : 'Unknown error', { steps, attempts });
  }
});
