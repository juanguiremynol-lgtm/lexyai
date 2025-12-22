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

type Classification = 
  | 'SUCCESS'
  | 'PARTIAL'
  | 'AUTH_FAILED'
  | 'NEEDS_REAUTH'
  | 'CAPTCHA_REQUIRED'
  | 'RATE_LIMITED'
  | 'BLOCKED'
  | 'PARSE_BROKE'
  | 'JSF_AJAX_NOT_REPLAYED'
  | 'ENDPOINT_CHANGED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

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

// ============= UTILITIES =============

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

function computeFingerprint(
  source: string,
  radicado: string,
  eventDate: string | null,
  description: string
): string {
  const data = `${source}|${radicado}|${eventDate || ''}|${description}`;
  let hash1 = 0, hash2 = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash1 = ((hash1 << 5) - hash1) + char;
    hash1 = hash1 & hash1;
    hash2 = ((hash2 << 7) + hash2) ^ char;
    hash2 = hash2 & hash2;
  }
  return `icarus_${Math.abs(hash1).toString(16).padStart(8, '0')}${Math.abs(hash2).toString(16).padStart(8, '0')}`;
}

function parseIcarusDate(dateStr: string): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    try { return new Date(dateStr).toISOString(); } catch { return null; }
  }
  const match = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!match) return null;
  let [, day, month, year] = match;
  if (year.length === 2) {
    year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
  }
  try {
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toISOString();
  } catch { return null; }
}

// ============= LOGIN FLOW =============

const ICARUS_BASE_URL = 'https://icarus.com.co';
const LOGIN_URL = `${ICARUS_BASE_URL}/login.xhtml`;
const PROCESS_LIST_URL = `${ICARUS_BASE_URL}/main/process/list.xhtml`;

interface CookieJar {
  cookies: { name: string; value: string; domain: string; path: string }[];
  viewState?: string;
}

function parseCookies(setCookieHeaders: string[]): CookieJar['cookies'] {
  const cookies: CookieJar['cookies'] = [];
  for (const header of setCookieHeaders) {
    const parts = header.split(';').map(p => p.trim());
    const [nameValue] = parts;
    const [name, value] = nameValue.split('=');
    if (!name || !value) continue;
    cookies.push({
      name: name.trim(),
      value: value.trim(),
      domain: 'icarus.com.co',
      path: '/',
    });
  }
  return cookies;
}

function cookieJarToHeader(cookieJar: CookieJar): string {
  return cookieJar.cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function extractViewState(html: string): string | null {
  const patterns = [
    /name="javax\.faces\.ViewState"\s+value="([^"]+)"/i,
    /<input[^>]*name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function performLogin(
  username: string,
  password: string,
  attempts: AttemptLog[],
  steps: Step[]
): Promise<{ ok: boolean; cookieJar?: CookieJar; status: string; error?: string }> {
  
  // Step: GET login page
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
  let cookieJar: CookieJar = { cookies: [] };
  
  try {
    const getResponse = await fetch(LOGIN_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
    });
    
    getAttempt.status = getResponse.status;
    getAttempt.latency_ms = Date.now() - startGet;
    const getHtml = await getResponse.text();
    getAttempt.response_snippet = truncate(getHtml, 300);
    
    const setCookies = getResponse.headers.getSetCookie?.() || [];
    cookieJar.cookies = parseCookies(setCookies);
    
    // Check for CAPTCHA
    if (getHtml.toLowerCase().includes('captcha') || getHtml.toLowerCase().includes('recaptcha')) {
      getAttempt.error_type = 'CAPTCHA_DETECTED';
      attempts.push(getAttempt);
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].detail = 'CAPTCHA detected';
      steps[steps.length - 1].finished_at = new Date().toISOString();
      return { ok: false, status: 'CAPTCHA_REQUIRED', error: 'CAPTCHA detected' };
    }
    
    const viewState = extractViewState(getHtml);
    cookieJar.viewState = viewState || undefined;
    
    getAttempt.success = true;
    attempts.push(getAttempt);
    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].detail = `Cookies: ${cookieJar.cookies.length}`;
    steps[steps.length - 1].finished_at = new Date().toISOString();
    
  } catch (err) {
    getAttempt.latency_ms = Date.now() - startGet;
    getAttempt.error_type = 'NETWORK_ERROR';
    getAttempt.response_snippet = err instanceof Error ? err.message : 'Unknown';
    attempts.push(getAttempt);
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, status: 'ERROR', error: 'Failed to reach login page' };
  }
  
  // Step: POST login
  steps.push({ name: 'POST_LOGIN', started_at: new Date().toISOString(), status: 'running' });
  
  const postAttempt: AttemptLog = {
    phase: 'POST_LOGIN',
    url: LOGIN_URL,
    method: 'POST',
    status: null,
    latency_ms: 0,
    success: false,
  };
  
  const formData = new URLSearchParams();
  if (cookieJar.viewState) {
    formData.append('javax.faces.ViewState', cookieJar.viewState);
  }
  formData.append('loginForm:username', username);
  formData.append('loginForm:password', password);
  formData.append('loginForm', 'loginForm');
  formData.append('loginForm:btnIngresar', '');
  
  const startPost = Date.now();
  
  try {
    const postResponse = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieJarToHeader(cookieJar),
        'Referer': LOGIN_URL,
      },
      body: formData.toString(),
      redirect: 'manual',
    });
    
    postAttempt.status = postResponse.status;
    postAttempt.latency_ms = Date.now() - startPost;
    
    // Capture new cookies
    const newCookies = postResponse.headers.getSetCookie?.() || [];
    for (const c of parseCookies(newCookies)) {
      const idx = cookieJar.cookies.findIndex(x => x.name === c.name);
      if (idx >= 0) cookieJar.cookies[idx] = c;
      else cookieJar.cookies.push(c);
    }
    
    if (postResponse.status === 302 || postResponse.status === 303) {
      const location = postResponse.headers.get('location');
      postAttempt.response_snippet = `Redirect: ${location}`;
      
      if (location?.includes('login')) {
        postAttempt.error_type = 'AUTH_FAILED';
        attempts.push(postAttempt);
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = 'Invalid credentials';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, status: 'AUTH_FAILED', error: 'Invalid credentials' };
      }
      
      // Follow redirect
      if (location) {
        const redirectUrl = location.startsWith('http') ? location : `${ICARUS_BASE_URL}${location}`;
        const redirectResponse = await fetch(redirectUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Cookie': cookieJarToHeader(cookieJar),
          },
          redirect: 'manual',
        });
        for (const c of parseCookies(redirectResponse.headers.getSetCookie?.() || [])) {
          const idx = cookieJar.cookies.findIndex(x => x.name === c.name);
          if (idx >= 0) cookieJar.cookies[idx] = c;
          else cookieJar.cookies.push(c);
        }
      }
    }
    
    postAttempt.success = true;
    attempts.push(postAttempt);
    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    
  } catch (err) {
    postAttempt.latency_ms = Date.now() - startPost;
    postAttempt.error_type = 'NETWORK_ERROR';
    attempts.push(postAttempt);
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, status: 'ERROR', error: 'Login network error' };
  }
  
  // Step: Verify auth
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
        'User-Agent': 'Mozilla/5.0',
        'Cookie': cookieJarToHeader(cookieJar),
      },
      redirect: 'manual',
    });
    
    verifyAttempt.status = verifyResponse.status;
    verifyAttempt.latency_ms = Date.now() - startVerify;
    
    if (verifyResponse.status === 302) {
      const location = verifyResponse.headers.get('location');
      if (location?.includes('login')) {
        verifyAttempt.error_type = 'AUTH_FAILED';
        attempts.push(verifyAttempt);
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, status: 'AUTH_FAILED', error: 'Session not valid' };
      }
    }
    
    const verifyHtml = await verifyResponse.text();
    verifyAttempt.response_snippet = truncate(verifyHtml, 300);
    
    const authIndicators = ['salir', 'cerrar sesión', 'logout'];
    const isAuth = authIndicators.some(i => verifyHtml.toLowerCase().includes(i));
    
    if (!isAuth) {
      verifyAttempt.error_type = 'AUTH_FAILED';
      attempts.push(verifyAttempt);
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].finished_at = new Date().toISOString();
      return { ok: false, status: 'AUTH_FAILED', error: 'Not authenticated' };
    }
    
    const newViewState = extractViewState(verifyHtml);
    if (newViewState) cookieJar.viewState = newViewState;
    
    verifyAttempt.success = true;
    attempts.push(verifyAttempt);
    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].detail = 'Authenticated';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    
    return { ok: true, cookieJar, status: 'CONNECTED' };
    
  } catch (err) {
    verifyAttempt.latency_ms = Date.now() - startVerify;
    verifyAttempt.error_type = 'NETWORK_ERROR';
    attempts.push(verifyAttempt);
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, status: 'ERROR', error: 'Verify failed' };
  }
}

// ============= PROCESS LISTING =============

function parseProcessesFromHtml(html: string): { radicado: string; detailUrl?: string }[] {
  const processes: { radicado: string; detailUrl?: string }[] = [];
  const radicadoPattern = /(\d{2}-\d{3}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5})/g;
  const found = new Set<string>();
  
  let match;
  while ((match = radicadoPattern.exec(html)) !== null) {
    found.add(match[1]);
  }
  
  for (const radicado of found) {
    processes.push({ radicado });
  }
  
  return processes;
}

interface DataTableInfo {
  tableId: string;
  first: number;
  rows: number;
  totalRecords: number;
}

function extractDataTableInfo(html: string): DataTableInfo | null {
  const tableMatch = html.match(/id="([^"]*(?:process|data|list)Table[^"]*)"/i);
  if (!tableMatch) return null;
  
  const paginatorMatch = html.match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/);
  
  return {
    tableId: tableMatch[1],
    first: paginatorMatch ? parseInt(paginatorMatch[1]) - 1 : 0,
    rows: paginatorMatch ? parseInt(paginatorMatch[2]) - (parseInt(paginatorMatch[1]) - 1) : 10,
    totalRecords: paginatorMatch ? parseInt(paginatorMatch[3]) : 0,
  };
}

async function fetchWithJsfAjax(
  cookieJar: CookieJar,
  tableInfo: DataTableInfo,
  pageNumber: number,
  attempts: AttemptLog[]
): Promise<{ ok: boolean; html?: string }> {
  const attempt: AttemptLog = {
    phase: `JSF_AJAX_PAGE_${pageNumber}`,
    url: PROCESS_LIST_URL,
    method: 'POST',
    status: null,
    latency_ms: 0,
    success: false,
  };
  
  const startMs = Date.now();
  
  try {
    const formData = new URLSearchParams();
    formData.append('javax.faces.partial.ajax', 'true');
    formData.append('javax.faces.source', tableInfo.tableId);
    formData.append('javax.faces.partial.execute', tableInfo.tableId);
    formData.append('javax.faces.partial.render', tableInfo.tableId);
    formData.append(`${tableInfo.tableId}_pagination`, 'true');
    formData.append(`${tableInfo.tableId}_first`, String(pageNumber * tableInfo.rows));
    formData.append(`${tableInfo.tableId}_rows`, String(tableInfo.rows));
    
    if (cookieJar.viewState) {
      formData.append('javax.faces.ViewState', cookieJar.viewState);
    }
    
    const formId = tableInfo.tableId.split(':')[0] || 'form';
    formData.append(formId, formId);
    
    const response = await fetch(PROCESS_LIST_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cookie': cookieJarToHeader(cookieJar),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Faces-Request': 'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formData.toString(),
    });
    
    attempt.status = response.status;
    attempt.latency_ms = Date.now() - startMs;
    
    if (!response.ok) {
      attempts.push(attempt);
      return { ok: false };
    }
    
    const xml = await response.text();
    attempt.response_snippet = truncate(xml, 300);
    
    const updateMatch = xml.match(/<update[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/update>/);
    const html = updateMatch?.[1] || xml;
    
    const newViewState = extractViewState(xml);
    if (newViewState) cookieJar.viewState = newViewState;
    
    attempt.success = true;
    attempts.push(attempt);
    
    return { ok: true, html };
    
  } catch {
    attempt.latency_ms = Date.now() - startMs;
    attempts.push(attempt);
    return { ok: false };
  }
}

async function listProcesses(
  cookieJar: CookieJar,
  attempts: AttemptLog[],
  steps: Step[]
): Promise<{ ok: boolean; processes: { radicado: string }[]; classification: Classification; evidenceSnapshot?: string }> {
  
  steps.push({ name: 'LIST_PROCESSES', started_at: new Date().toISOString(), status: 'running' });
  
  const attempt: AttemptLog = {
    phase: 'LIST_INITIAL',
    url: PROCESS_LIST_URL,
    method: 'GET',
    status: null,
    latency_ms: 0,
    success: false,
  };
  
  const startMs = Date.now();
  
  try {
    const response = await fetch(PROCESS_LIST_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cookie': cookieJarToHeader(cookieJar),
      },
      redirect: 'manual',
    });
    
    attempt.status = response.status;
    attempt.latency_ms = Date.now() - startMs;
    
    if (response.status === 302) {
      const location = response.headers.get('location');
      if (location?.includes('login')) {
        attempt.error_type = 'NEEDS_REAUTH';
        attempts.push(attempt);
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = 'Session expired';
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return { ok: false, processes: [], classification: 'NEEDS_REAUTH' };
      }
    }
    
    const html = await response.text();
    attempt.response_snippet = truncate(html, 300);
    
    if (html.toLowerCase().includes('login') && !html.toLowerCase().includes('salir')) {
      attempt.error_type = 'NEEDS_REAUTH';
      attempts.push(attempt);
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].finished_at = new Date().toISOString();
      return { ok: false, processes: [], classification: 'NEEDS_REAUTH' };
    }
    
    attempt.success = true;
    attempts.push(attempt);
    
    const viewState = extractViewState(html);
    if (viewState) cookieJar.viewState = viewState;
    
    const tableInfo = extractDataTableInfo(html);
    let allProcesses = parseProcessesFromHtml(html);
    
    console.log(`[LIST] Initial: ${allProcesses.length} processes, tableInfo:`, tableInfo);
    
    // DIAGNOSTIC RULE: Authenticated but 0 processes when total > 0
    if (tableInfo && tableInfo.totalRecords > 0 && allProcesses.length === 0) {
      console.log('[LIST] Trying JSF AJAX hydration...');
      
      if (viewState) {
        const ajaxResult = await fetchWithJsfAjax(cookieJar, tableInfo, 0, attempts);
        if (ajaxResult.ok && ajaxResult.html) {
          allProcesses = parseProcessesFromHtml(ajaxResult.html);
          console.log(`[LIST] AJAX returned ${allProcesses.length} processes`);
        }
      }
      
      if (allProcesses.length === 0) {
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].detail = `Expected ${tableInfo.totalRecords}, got 0`;
        steps[steps.length - 1].finished_at = new Date().toISOString();
        return {
          ok: false,
          processes: [],
          classification: 'JSF_AJAX_NOT_REPLAYED',
          evidenceSnapshot: html.substring(0, 3000),
        };
      }
    }
    
    // Fetch remaining pages
    if (tableInfo && tableInfo.totalRecords > allProcesses.length && cookieJar.viewState) {
      const totalPages = Math.ceil(tableInfo.totalRecords / tableInfo.rows);
      for (let page = 1; page < totalPages && page < 10; page++) {
        const pageResult = await fetchWithJsfAjax(cookieJar, tableInfo, page, attempts);
        if (pageResult.ok && pageResult.html) {
          allProcesses.push(...parseProcessesFromHtml(pageResult.html));
        }
        await new Promise(r => setTimeout(r, 300));
      }
    }
    
    // Deduplicate
    const unique = [...new Set(allProcesses.map(p => p.radicado))].map(r => ({ radicado: r }));
    
    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].detail = `Found ${unique.length} processes`;
    steps[steps.length - 1].finished_at = new Date().toISOString();
    
    return { ok: true, processes: unique, classification: 'SUCCESS' };
    
  } catch (err) {
    attempt.latency_ms = Date.now() - startMs;
    attempt.error_type = 'NETWORK_ERROR';
    attempts.push(attempt);
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].finished_at = new Date().toISOString();
    return { ok: false, processes: [], classification: 'NETWORK_ERROR' };
  }
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let runId: string | null = null;
  const steps: Step[] = [];
  const attempts: AttemptLog[] = [];
  let classification: Classification = 'UNKNOWN';
  let processesFound = 0;
  let eventsCreated = 0;

  try {
    const { mode = 'manual' } = await req.json().catch(() => ({}));

    // Get user
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create run record
    const { data: runData } = await supabase
      .from('icarus_sync_runs')
      .insert({ owner_id: userId, status: 'RUNNING', mode, steps: [], attempts: [] })
      .select('id')
      .single();
    
    runId = runData?.id;

    // Step 1: Load integration
    steps.push({ name: 'LOAD_INTEGRATION', started_at: new Date().toISOString(), status: 'running' });

    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('owner_id', userId)
      .eq('provider', 'ICARUS')
      .single();

    if (!integration) {
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].detail = 'Not configured';
      steps[steps.length - 1].finished_at = new Date().toISOString();
      classification = 'AUTH_FAILED';
      
      await updateRun(supabase, runId, 'ERROR', classification, steps, attempts, 'ICARUS not configured');
      return new Response(
        JSON.stringify({ ok: false, error: 'ICARUS not configured', classification }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].finished_at = new Date().toISOString();

    // Step 2: Get or refresh session
    steps.push({ name: 'GET_SESSION', started_at: new Date().toISOString(), status: 'running' });

    let cookieJar: CookieJar | null = null;
    let needsLogin = false;

    // Try existing session first
    if (integration.session_encrypted) {
      try {
        const sessionJson = await decryptSecret(integration.session_encrypted);
        if (sessionJson) {
          cookieJar = JSON.parse(sessionJson);
          steps[steps.length - 1].status = 'success';
          steps[steps.length - 1].detail = 'Using stored session';
          steps[steps.length - 1].finished_at = new Date().toISOString();
        }
      } catch {
        needsLogin = true;
      }
    } else {
      needsLogin = true;
    }

    if (!cookieJar) needsLogin = true;

    // Try to list with current session
    let listResult = cookieJar ? await listProcesses(cookieJar, attempts, steps) : null;

    // If session expired, re-login
    if (!listResult?.ok || listResult.classification === 'NEEDS_REAUTH') {
      console.log('[SYNC] Session expired, attempting re-login...');
      
      if (!integration.username || !integration.password_encrypted) {
        steps.push({ name: 'REAUTH', started_at: new Date().toISOString(), status: 'error', detail: 'No credentials stored', finished_at: new Date().toISOString() });
        classification = 'AUTH_FAILED';
        await updateRun(supabase, runId, 'ERROR', classification, steps, attempts, 'No credentials - reconfigure integration');
        
        await supabase.from('integrations').update({ status: 'NEEDS_REAUTH', last_error: 'Session expired' }).eq('id', integration.id);
        
        return new Response(
          JSON.stringify({ ok: false, error: 'Session expired - no credentials', classification }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const password = await decryptSecret(integration.password_encrypted);
      if (!password) {
        classification = 'AUTH_FAILED';
        await updateRun(supabase, runId, 'ERROR', classification, steps, attempts, 'Failed to decrypt password');
        return new Response(
          JSON.stringify({ ok: false, error: 'Decrypt failed', classification }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const loginResult = await performLogin(integration.username, password, attempts, steps);

      if (!loginResult.ok) {
        classification = loginResult.status as Classification;
        await supabase.from('integrations').update({ status: loginResult.status, last_error: loginResult.error }).eq('id', integration.id);
        await updateRun(supabase, runId, 'ERROR', classification, steps, attempts, loginResult.error);
        
        return new Response(
          JSON.stringify({ ok: false, error: loginResult.error, classification, attempts }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      cookieJar = loginResult.cookieJar!;
      
      // Save new session
      const encryptedSession = await encryptSecret(JSON.stringify(cookieJar));
      await supabase.from('integrations').update({
        session_encrypted: encryptedSession,
        session_last_ok_at: new Date().toISOString(),
        status: 'CONNECTED',
        last_error: null,
      }).eq('id', integration.id);

      // Retry list
      listResult = await listProcesses(cookieJar, attempts, steps);
    }

    if (!listResult?.ok) {
      classification = listResult?.classification || 'UNKNOWN';
      await updateRun(supabase, runId, 'ERROR', classification, steps, attempts, 'List failed', listResult?.evidenceSnapshot);
      
      return new Response(
        JSON.stringify({ ok: false, classification, evidenceSnapshot: listResult?.evidenceSnapshot?.substring(0, 1000), attempts }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    processesFound = listResult.processes.length;

    // Step 3: Sync processes
    steps.push({ name: 'SYNC_PROCESSES', started_at: new Date().toISOString(), status: 'running' });

    let processErrors = 0;

    for (const process of listResult.processes) {
      try {
        // Upsert monitored_process
        const { data: mp } = await supabase
          .from('monitored_processes')
          .upsert({
            owner_id: userId,
            radicado: process.radicado,
            monitoring_enabled: true,
            sources_enabled: ['ICARUS'],
            updated_at: new Date().toISOString(),
          }, { onConflict: 'owner_id,radicado' })
          .select('id')
          .single();

        // Find or create filing
        let { data: filing } = await supabase
          .from('filings')
          .select('id')
          .eq('owner_id', userId)
          .eq('radicado', process.radicado)
          .maybeSingle();

        if (!filing) {
          const { data: matters } = await supabase
            .from('matters')
            .select('id')
            .eq('owner_id', userId)
            .limit(1);

          if (matters?.length) {
            const { data: newFiling } = await supabase
              .from('filings')
              .insert({
                owner_id: userId,
                matter_id: matters[0].id,
                radicado: process.radicado,
                filing_type: 'ICARUS_IMPORT',
                status: 'MONITORING_ACTIVE',
              })
              .select('id')
              .single();
            filing = newFiling;
          }
        }

        if (filing && mp) {
          // Create a discovery event
          const fingerprint = computeFingerprint('ICARUS', process.radicado, new Date().toISOString().split('T')[0], 'Proceso sincronizado desde ICARUS');

          const { data: existing } = await supabase
            .from('process_events')
            .select('id')
            .eq('hash_fingerprint', fingerprint)
            .maybeSingle();

          if (!existing) {
            await supabase.from('process_events').insert({
              owner_id: userId,
              filing_id: filing.id,
              monitored_process_id: mp.id,
              source: 'ICARUS',
              event_type: 'ACTUACION',
              event_date: new Date().toISOString(),
              description: 'Proceso sincronizado desde ICARUS',
              hash_fingerprint: fingerprint,
            });
            eventsCreated++;
          }
        }
      } catch (err) {
        console.error(`[SYNC] Error with ${process.radicado}:`, err);
        processErrors++;
      }
    }

    steps[steps.length - 1].status = processErrors > 0 ? 'error' : 'success';
    steps[steps.length - 1].detail = `${processesFound} procesos, ${eventsCreated} eventos, ${processErrors} errores`;
    steps[steps.length - 1].finished_at = new Date().toISOString();

    classification = processErrors === 0 ? 'SUCCESS' : processErrors < processesFound ? 'PARTIAL' : 'PARSE_BROKE';

    // Update integration
    await supabase.from('integrations').update({
      last_sync_at: new Date().toISOString(),
      session_last_ok_at: new Date().toISOString(),
      status: 'CONNECTED',
      last_error: processErrors > 0 ? `${processErrors} errores` : null,
    }).eq('id', integration.id);

    await updateRun(supabase, runId, classification === 'SUCCESS' ? 'SUCCESS' : 'PARTIAL', classification, steps, attempts, null, null, processesFound, eventsCreated);

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        classification,
        processes_found: processesFound,
        events_created: eventsCreated,
        process_errors: processErrors,
        steps,
        attempts,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[icarus-sync] Error:', err);
    
    if (runId) {
      await updateRun(supabase, runId, 'ERROR', 'UNKNOWN', steps, attempts, err instanceof Error ? err.message : 'Unknown');
    }

    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Unknown', steps, attempts }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function updateRun(
  supabase: any,
  runId: string | null,
  status: string,
  classification: string,
  steps: Step[],
  attempts: AttemptLog[],
  errorMessage?: string | null,
  evidenceSnapshot?: string | null,
  processesFound?: number,
  eventsCreated?: number
) {
  if (!runId) return;
  
  await supabase.from('icarus_sync_runs').update({
    finished_at: new Date().toISOString(),
    status,
    classification,
    steps,
    attempts,
    error_message: errorMessage,
    processes_found: processesFound ?? 0,
    events_created: eventsCreated ?? 0,
  }).eq('id', runId);
}
