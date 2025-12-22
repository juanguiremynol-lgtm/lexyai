import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
};

// ============= TYPES =============

interface LoginAttempt {
  url: string;
  method: string;
  started_at: string;
  latency_ms: number;
  status: number | null;
  final_url: string | null;
  classifier: string;
  headers_subset: Record<string, string>;
  body_snippet: string;
  error_name?: string;
  error_message?: string;
  error_stack?: string;
}

interface AttemptLog {
  phase: string;
  url: string;
  method: string;
  status: number | null;
  latency_ms: number;
  error_type?: string;
  response_snippet?: string;
  success: boolean;
  classifier?: string;
  login_attempts?: LoginAttempt[];
}

interface Step {
  name: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
  meta?: Record<string, unknown>;
}

interface CookieJar {
  cookies: { name: string; value: string; domain: string; path: string; expires?: string; secure?: boolean; httpOnly?: boolean }[];
  viewState?: string;
}

type AuthStatus = 'CONNECTED' | 'AUTH_FAILED' | 'CAPTCHA_REQUIRED' | 'NEEDS_REAUTH' | 'ERROR' | 'LOGIN_PAGE_UNREACHABLE';

// ============= BROWSER HEADERS =============

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

// ============= NETWORK DIAGNOSTICS =============

async function fetchWithDiag(url: string, options: RequestInit = {}): Promise<LoginAttempt> {
  const started_at = new Date().toISOString();
  const start = Date.now();
  const method = options.method || 'GET';

  const result: LoginAttempt = {
    url,
    method,
    started_at,
    latency_ms: 0,
    status: null,
    final_url: null,
    classifier: 'UNKNOWN',
    headers_subset: {},
    body_snippet: '',
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...BROWSER_HEADERS,
        ...(options.headers || {}),
      },
      redirect: 'manual',
    });

    result.latency_ms = Date.now() - start;
    result.status = response.status;
    result.final_url = response.headers.get('location') || url;

    // Extract useful headers
    result.headers_subset = {
      'content-type': response.headers.get('content-type') || '',
      'location': response.headers.get('location') || '',
      'server': response.headers.get('server') || '',
      'cf-ray': response.headers.get('cf-ray') || '',
      'x-powered-by': response.headers.get('x-powered-by') || '',
    };

    // Get body snippet
    try {
      const text = await response.text();
      result.body_snippet = text.substring(0, 2000);

      // Classify the response
      result.classifier = classifyResponse(response.status, text, result.headers_subset);
    } catch {
      result.body_snippet = '[Unable to read response body]';
      result.classifier = 'BODY_READ_ERROR';
    }

  } catch (err) {
    result.latency_ms = Date.now() - start;
    result.classifier = 'NETWORK_EXCEPTION';
    if (err instanceof Error) {
      result.error_name = err.name;
      result.error_message = err.message;
      result.error_stack = err.stack?.substring(0, 500);
    } else {
      result.error_message = String(err);
    }
  }

  return result;
}

function classifyResponse(status: number | null, body: string, headers: Record<string, string>): string {
  if (status === null) return 'NETWORK_EXCEPTION';

  const lowerBody = body.toLowerCase();
  const lowerHeaders = JSON.stringify(headers).toLowerCase();

  // Check for WAF/anti-bot indicators
  const wafIndicators = ['cf-', 'cloudflare', 'attention required', 'captcha', 'challenge', 'bot detected', 'access denied', 'security check'];
  for (const indicator of wafIndicators) {
    if (lowerBody.includes(indicator) || lowerHeaders.includes(indicator)) {
      return 'CAPTCHA_OR_CHALLENGE';
    }
  }

  // Check for specific status codes
  if (status === 403 || status === 429) return 'HTTP_403_429_BLOCKED';
  if (status >= 500) return 'HTTP_5XX_SERVER';
  if (status === 302 || status === 301 || status === 303) {
    const location = headers['location'] || '';
    if (location && location.includes(new URL(location).hostname)) {
      return 'REDIRECT';
    }
    return 'REDIRECT';
  }
  if (status === 200) {
    // Check if it looks like a login page
    if (lowerBody.includes('login') || lowerBody.includes('password') || lowerBody.includes('javax.faces.viewstate')) {
      return 'HTTP_200_OK';
    }
    return 'HTTP_200_OK';
  }
  if (status >= 400 && status < 500) return 'HTTP_4XX_CLIENT_ERROR';

  return 'UNKNOWN_STATUS';
}

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
  const formMatch = html.match(/<form[^>]*id="([^"]+)"[^>]*>/i);
  if (!formMatch) return null;
  const formId = formMatch[1];
  
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
    'cf-turnstile',
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

// ============= MULTI-URL LOGIN PROBE =============

const LOGIN_CANDIDATES = [
  'https://icarus.com.co/',
  'https://www.icarus.com.co/',
  'https://icarus.com.co/login.xhtml',
  'https://icarus.com.co/main/login.xhtml',
  'https://icarus.com.co/main/process/list.xhtml',
];

const ICARUS_BASE_URL = 'https://icarus.com.co';
const LOGIN_URL = `${ICARUS_BASE_URL}/login.xhtml`;
const PROCESS_LIST_URL = `${ICARUS_BASE_URL}/main/process/list.xhtml`;

async function probeLoginPage(steps: Step[]): Promise<{
  ok: boolean;
  loginUrl: string | null;
  html: string | null;
  cookies: CookieJar['cookies'];
  attempts: LoginAttempt[];
  error?: string;
  classifier?: string;
}> {
  const attempts: LoginAttempt[] = [];
  
  steps.push({
    name: 'GET_LOGIN',
    started_at: new Date().toISOString(),
    status: 'running',
    detail: `Probing ${LOGIN_CANDIDATES.length} URL candidates`,
  });

  let bestAttempt: LoginAttempt | null = null;
  let bestHtml: string | null = null;

  for (const url of LOGIN_CANDIDATES) {
    console.log(`[probeLoginPage] Trying: ${url}`);
    const attempt = await fetchWithDiag(url);
    attempts.push(attempt);

    // Check if this is a successful login page
    if (attempt.classifier === 'HTTP_200_OK' && attempt.body_snippet) {
      const hasLoginForm = attempt.body_snippet.toLowerCase().includes('login') ||
                           attempt.body_snippet.toLowerCase().includes('password') ||
                           attempt.body_snippet.includes('javax.faces.ViewState');
      
      if (hasLoginForm) {
        bestAttempt = attempt;
        bestHtml = attempt.body_snippet;
        console.log(`[probeLoginPage] Found login page at: ${url}`);
        break;
      }
    }

    // Track best non-error attempt
    if (!bestAttempt && attempt.status === 200) {
      bestAttempt = attempt;
      bestHtml = attempt.body_snippet;
    }
  }

  // Update step
  const step = steps[steps.length - 1];
  step.finished_at = new Date().toISOString();
  step.meta = { attempts_count: attempts.length };

  if (bestAttempt && bestAttempt.status === 200 && bestHtml) {
    step.status = 'success';
    step.detail = `Found login page at ${bestAttempt.url} (${bestAttempt.latency_ms}ms)`;
    
    // Parse cookies from all successful attempts
    const cookies: CookieJar['cookies'] = [];
    for (const attempt of attempts) {
      if (attempt.status === 200 && attempt.headers_subset['set-cookie']) {
        cookies.push(...parseCookies([attempt.headers_subset['set-cookie']]));
      }
    }

    return {
      ok: true,
      loginUrl: bestAttempt.url,
      html: bestHtml,
      cookies,
      attempts,
    };
  }

  // All failed - determine why
  step.status = 'error';
  
  // Check for common failure patterns
  const hasNetworkException = attempts.some(a => a.classifier === 'NETWORK_EXCEPTION');
  const hasBlocked = attempts.some(a => a.classifier === 'HTTP_403_429_BLOCKED');
  const hasCaptcha = attempts.some(a => a.classifier === 'CAPTCHA_OR_CHALLENGE');
  const hasServerError = attempts.some(a => a.classifier === 'HTTP_5XX_SERVER');

  let classifier = 'UNKNOWN';
  let error = 'All login page probes failed';

  if (hasCaptcha) {
    classifier = 'CAPTCHA_OR_CHALLENGE';
    error = 'WAF/CAPTCHA challenge detected - browser automation required';
  } else if (hasBlocked) {
    classifier = 'HTTP_403_429_BLOCKED';
    error = 'Access blocked (403/429) - possible rate limiting or IP block';
  } else if (hasNetworkException) {
    classifier = 'NETWORK_EXCEPTION';
    const netError = attempts.find(a => a.classifier === 'NETWORK_EXCEPTION');
    error = `Network error: ${netError?.error_message || 'Connection failed'}`;
  } else if (hasServerError) {
    classifier = 'HTTP_5XX_SERVER';
    error = 'Server error (5xx) - ICARUS may be down';
  }

  step.detail = error;

  return {
    ok: false,
    loginUrl: null,
    html: null,
    cookies: [],
    attempts,
    error,
    classifier,
  };
}

// ============= FIRECRAWL FALLBACK =============

async function performLoginWithFirecrawl(
  username: string,
  password: string,
  steps: Step[]
): Promise<{ ok: boolean; processes?: any[]; error?: string; raw?: any }> {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  if (!firecrawlKey) {
    return { ok: false, error: 'FIRECRAWL_API_KEY not configured' };
  }

  steps.push({
    name: 'FIRECRAWL_LOGIN',
    started_at: new Date().toISOString(),
    status: 'running',
    detail: 'Attempting browser-based login via Firecrawl Actions',
  });

  try {
    // Use Firecrawl Actions to perform login
    const actionsPayload = {
      url: 'https://icarus.com.co/',
      actions: [
        { type: 'wait', selector: 'input[type="text"], input[name*="username"], input[name*="usuario"]', timeout: 10000 },
        { type: 'input', selector: 'input[type="text"], input[name*="username"], input[name*="usuario"]', text: username },
        { type: 'input', selector: 'input[type="password"]', text: password },
        { type: 'click', selector: 'button[type="submit"], input[type="submit"], button[name*="login"], button[name*="ingresar"]' },
        { type: 'wait', timeout: 3000 },
        { type: 'wait', selector: 'a[href*="Salir"], a[href*="logout"], .welcome-message, .process-list' },
      ],
      formats: ['markdown', 'html'],
    };

    console.log('[Firecrawl] Sending login actions...');
    
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(actionsPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].detail = `Firecrawl error: ${data.error || response.status}`;
      steps[steps.length - 1].finished_at = new Date().toISOString();
      return { ok: false, error: `Firecrawl API error: ${data.error || response.status}`, raw: data };
    }

    // Check if login was successful by looking for authenticated markers
    const html = data.data?.html || data.html || '';
    const markdown = data.data?.markdown || data.markdown || '';
    
    if (isAuthenticatedPage(html) || markdown.toLowerCase().includes('salir')) {
      steps[steps.length - 1].status = 'success';
      steps[steps.length - 1].detail = 'Login successful via Firecrawl';
      steps[steps.length - 1].finished_at = new Date().toISOString();

      // Now navigate to process list
      const listPayload = {
        url: 'https://icarus.com.co/main/process/list.xhtml',
        formats: ['html'],
        sessionId: data.sessionId, // Preserve session if available
      };

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

      // Parse process table
      const processes = parseProcessTable(listHtml);

      return { ok: true, processes, raw: listData };
    } else {
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].detail = 'Login failed - no authenticated markers found';
      steps[steps.length - 1].finished_at = new Date().toISOString();
      return { ok: false, error: 'Firecrawl login did not authenticate successfully', raw: data };
    }
  } catch (err) {
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].detail = err instanceof Error ? err.message : 'Unknown error';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

function parseProcessTable(html: string): any[] {
  const processes: any[] = [];
  
  // Simple regex-based table parsing
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  
  let match;
  let isHeader = true;
  
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1];
    
    // Skip header row
    if (isHeader && rowHtml.includes('<th')) {
      isHeader = false;
      continue;
    }
    isHeader = false;

    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      // Strip HTML tags
      let cellText = cellMatch[1].replace(/<[^>]+>/g, ' ').trim().replace(/\s+/g, ' ');
      cells.push(cellText);
    }

    if (cells.length >= 4) {
      // Try to extract link
      const linkMatch = rowHtml.match(linkRegex);
      
      processes.push({
        radicado: cells[0] || '',
        despacho: cells[1] || '',
        demandante: cells[2] || '',
        demandado: cells[3] || '',
        ultima_actuacion: cells[4] || '',
        detail_url: linkMatch ? linkMatch[1] : null,
      });
    }
  }

  return processes;
}

// ============= LOGIN FLOW =============

async function performLogin(
  username: string,
  password: string,
  attempts: AttemptLog[],
  steps: Step[]
): Promise<{ ok: boolean; cookieJar?: CookieJar; status: AuthStatus; error?: string; loginAttempts?: LoginAttempt[] }> {
  
  // Step 1: Probe login page with multi-URL approach
  const probeResult = await probeLoginPage(steps);
  
  // Create attempt log for the probe
  const probeAttempt: AttemptLog = {
    phase: 'GET_LOGIN',
    url: probeResult.loginUrl || 'multiple',
    method: 'GET',
    status: probeResult.ok ? 200 : null,
    latency_ms: probeResult.attempts.reduce((sum, a) => sum + a.latency_ms, 0),
    success: probeResult.ok,
    classifier: probeResult.classifier,
    login_attempts: probeResult.attempts,
  };
  attempts.push(probeAttempt);

  if (!probeResult.ok) {
    // Check if we should try Firecrawl fallback
    const shouldTryFirecrawl = probeResult.classifier === 'CAPTCHA_OR_CHALLENGE' ||
                                probeResult.classifier === 'HTTP_403_429_BLOCKED' ||
                                probeResult.classifier === 'NETWORK_EXCEPTION';

    if (shouldTryFirecrawl) {
      console.log('[performLogin] Server-side fetch blocked, trying Firecrawl fallback...');
      const firecrawlResult = await performLoginWithFirecrawl(username, password, steps);
      
      if (firecrawlResult.ok) {
        // Create a synthetic cookie jar for session tracking
        return {
          ok: true,
          cookieJar: { cookies: [], viewState: 'firecrawl-session' },
          status: 'CONNECTED',
        };
      }
    }

    return { 
      ok: false, 
      status: 'LOGIN_PAGE_UNREACHABLE', 
      error: probeResult.error,
      loginAttempts: probeResult.attempts,
    };
  }

  const loginUrl = probeResult.loginUrl!;
  const getHtml = probeResult.html!;
  let cookieJar: CookieJar = { cookies: probeResult.cookies };
  
  // Check for CAPTCHA
  if (detectCaptcha(getHtml)) {
    steps.push({
      name: 'CAPTCHA_CHECK',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: 'error',
      detail: 'CAPTCHA detected on login page',
    });
    return { ok: false, status: 'CAPTCHA_REQUIRED', error: 'CAPTCHA detected - manual login required' };
  }
  
  // Extract ViewState and form fields
  const viewState = extractViewState(getHtml);
  const formFields = extractFormFields(getHtml);
  
  steps.push({
    name: 'EXTRACT_FORM',
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: 'success',
    detail: `ViewState: ${viewState ? 'found' : 'not found'}, Form: ${formFields?.formId || 'not found'}`,
  });
  
  cookieJar.viewState = viewState || undefined;
  
  // Step 2: POST login credentials
  steps.push({ name: 'POST_LOGIN', started_at: new Date().toISOString(), status: 'running' });
  
  const postAttempt: AttemptLog = {
    phase: 'POST_LOGIN',
    url: loginUrl,
    method: 'POST',
    status: null,
    latency_ms: 0,
    success: false,
  };
  
  // Build form data
  const formData = new URLSearchParams();
  
  if (viewState) {
    formData.append('javax.faces.ViewState', viewState);
  }
  
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
  
  formData.append(usernameFieldNames[0] || 'loginForm:username', username);
  formData.append(passwordFieldNames[0] || 'loginForm:password', password);
  formData.append('loginForm', 'loginForm');
  
  if (formFields?.submitButton) {
    formData.append(formFields.submitButton, '');
  } else {
    formData.append('loginForm:btnIngresar', '');
    formData.append('loginForm:submit', '');
  }
  
  const startPost = Date.now();
  
  try {
    const postResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieJarToHeader(cookieJar),
        'Referer': loginUrl,
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
      
      if (location?.includes('login')) {
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = 'Redirected back to login - invalid credentials';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, status: 'AUTH_FAILED', error: 'Invalid credentials' };
      }
      
      if (location) {
        const redirectUrl = location.startsWith('http') ? location : `${ICARUS_BASE_URL}${location}`;
        const redirectResponse = await fetch(redirectUrl, {
          method: 'GET',
          headers: {
            ...BROWSER_HEADERS,
            'Cookie': cookieJarToHeader(cookieJar),
          },
          redirect: 'manual',
        });
        
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
        ...BROWSER_HEADERS,
        'Cookie': cookieJarToHeader(cookieJar),
      },
      redirect: 'manual',
    });
    
    verifyAttempt.status = verifyResponse.status;
    verifyAttempt.latency_ms = Date.now() - startVerify;
    
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
    
    if (!isAuthenticatedPage(verifyHtml)) {
      if (verifyHtml.toLowerCase().includes('login') || verifyHtml.toLowerCase().includes('iniciar sesión')) {
        verifyAttempt.error_type = 'AUTH_FAILED';
        attempts.push(verifyAttempt);
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = 'Got login page instead of process list';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, status: 'AUTH_FAILED', error: 'Authentication failed' };
      }
    }
    
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

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonError(
  status: number,
  code: string,
  message: string,
  meta?: Record<string, unknown>
): Response {
  const request_id = generateRequestId();
  const body = {
    ok: false,
    code,
    message,
    request_id,
    ...(meta || {}),
    timestamp: new Date().toISOString(),
  };
  console.error(`[icarus-auth] Error ${code}: ${message}`, meta ? JSON.stringify(meta).substring(0, 500) : '');
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonSuccess(data: Record<string, unknown>): Response {
  const request_id = generateRequestId();
  return new Response(
    JSON.stringify({ ok: true, request_id, ...data, timestamp: new Date().toISOString() }),
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
    addStep('KEY_CHECK', 'success', 'Encryption key valid (32 bytes)');

    // Step 3: Parse request body safely
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

    // ============= ACTION: LOGIN =============
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

        const httpStatus = result.status === 'CAPTCHA_REQUIRED' ? 403 :
                           result.status === 'LOGIN_PAGE_UNREACHABLE' ? 502 : 400;

        return jsonError(httpStatus, result.status, result.error || 'Authentication failed', { 
          status: result.status, 
          steps, 
          attempts,
          login_attempts: result.loginAttempts,
        });
      }

      const encryptedPassword = await encryptSecret(password);
      const encryptedSession = await encryptSecret(JSON.stringify(result.cookieJar));

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

      console.log(`[icarus-auth] Refreshing session for user ${userId.substring(0, 8)}...`);
      const result = await performLogin(integration.username, decryptedPassword, attempts, steps);

      if (!result.ok) {
        await supabase.from('integrations').update({
          status: result.status === 'CAPTCHA_REQUIRED' ? 'ERROR' : result.status,
          last_error: result.error,
          updated_at: new Date().toISOString(),
        }).eq('id', integration.id);

        const httpStatus = result.status === 'CAPTCHA_REQUIRED' ? 403 :
                           result.status === 'LOGIN_PAGE_UNREACHABLE' ? 502 : 400;

        return jsonError(httpStatus, result.status, result.error || 'Authentication failed', { 
          status: result.status, 
          steps, 
          attempts,
          login_attempts: result.loginAttempts,
        });
      }

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

    return jsonError(400, 'UNKNOWN_ACTION', `Unknown action: ${action}`, { steps });

  } catch (err) {
    console.error('[icarus-auth] Unexpected error:', err);
    return jsonError(500, 'UNKNOWN_ERROR', err instanceof Error ? err.message : 'Unknown error', { steps, attempts });
  }
});
