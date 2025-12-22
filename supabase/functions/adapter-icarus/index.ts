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

interface IcarusProcess {
  icarus_id?: string;
  radicado: string;
  despacho: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  ciudad?: string;
  last_update_at?: string;
}

interface IcarusEvent {
  fecha: string;
  actuacion: string;
  anotacion?: string;
  fecha_inicial?: string;
  fecha_final?: string;
}

// ============= ENCRYPTION =============
// Simple XOR encryption for cookie storage (in production, use proper encryption)

const ENCRYPTION_KEY = Deno.env.get('ICARUS_ENCRYPTION_KEY') || 'default-key-change-me-in-production';

function encrypt(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
    result += String.fromCharCode(charCode);
  }
  return btoa(result);
}

function decrypt(encrypted: string): string {
  try {
    const decoded = atob(encrypted);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch {
    return '';
  }
}

function getLast4(text: string): string {
  if (!text || text.length < 4) return '****';
  return text.slice(-4);
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
  // Try ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    try { return new Date(dateStr).toISOString(); } catch { return null; }
  }
  // DD/MM/YYYY or DD-MM-YYYY
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

// ============= ICARUS SCRAPING =============

const ICARUS_BASE_URL = 'https://www.icarus.com.co'; // TODO: Discover actual ICARUS URLs

async function scrapeWithCookie(
  url: string,
  cookie: string,
  attempts: AttemptLog[],
  phase: string
): Promise<{ success: boolean; html?: string; markdown?: string; error?: string }> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) {
    return { success: false, error: 'FIRECRAWL_API_KEY not configured' };
  }

  const startMs = Date.now();
  const attempt: AttemptLog = {
    phase,
    url,
    method: 'SCRAPE_WITH_COOKIE',
    status: null,
    latency_ms: 0,
    success: false,
  };

  try {
    console.log(`[${phase}] Scraping with cookie: ${url}`);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html'],
        headers: {
          'Cookie': cookie,
        },
        waitFor: 3000,
        onlyMainContent: false,
      }),
    });

    attempt.status = response.status;
    attempt.latency_ms = Date.now() - startMs;

    if (!response.ok) {
      const errorText = await response.text();
      attempt.error_type = 'HTTP_ERROR';
      attempt.response_snippet = truncate(errorText, 500);
      attempts.push(attempt);
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || '';
    const html = data.data?.html || data.html || '';

    attempt.success = true;
    attempt.response_snippet = truncate(markdown, 500);
    attempts.push(attempt);

    return { success: true, html, markdown };
  } catch (err) {
    attempt.latency_ms = Date.now() - startMs;
    attempt.error_type = 'NETWORK_ERROR';
    attempt.response_snippet = err instanceof Error ? err.message : 'Unknown error';
    attempts.push(attempt);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function testIcarusConnection(
  cookie: string,
  attempts: AttemptLog[]
): Promise<{ ok: boolean; error?: string }> {
  // For ICARUS, we need to discover the actual login check endpoint
  // This is a placeholder - needs actual ICARUS URL discovery
  
  // Try to access the main process list page
  const testUrl = `${ICARUS_BASE_URL}/procesos`;
  const result = await scrapeWithCookie(testUrl, cookie, attempts, 'TEST_CONNECTION');
  
  if (!result.success) {
    return { ok: false, error: result.error || 'Failed to connect' };
  }

  // Check if we got a login page (session expired) or actual content
  const markdown = result.markdown || '';
  if (markdown.includes('login') || markdown.includes('iniciar sesión') || markdown.includes('usuario')) {
    // Might be login page - check more carefully
    if (!markdown.includes('proceso') && !markdown.includes('radicado')) {
      return { ok: false, error: 'Cookie expired or invalid - got login page' };
    }
  }

  return { ok: true };
}

async function listIcarusProcesses(
  cookie: string,
  attempts: AttemptLog[]
): Promise<{ ok: boolean; processes: IcarusProcess[]; error?: string }> {
  // Scrape the process list page
  const listUrl = `${ICARUS_BASE_URL}/procesos/lista`;
  const result = await scrapeWithCookie(listUrl, cookie, attempts, 'LIST_PROCESSES');
  
  if (!result.success) {
    return { ok: false, processes: [], error: result.error };
  }

  // Parse the HTML/markdown to extract processes
  // This is a placeholder - needs actual ICARUS HTML structure
  const processes: IcarusProcess[] = [];
  
  // Try to parse from markdown table or HTML structure
  const markdown = result.markdown || '';
  const lines = markdown.split('\n');
  
  // Look for table rows with radicado patterns
  const radicadoPattern = /(\d{2}-\d{3}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5})/g;
  let currentProcess: Partial<IcarusProcess> = {};
  
  for (const line of lines) {
    const radicadoMatch = line.match(radicadoPattern);
    if (radicadoMatch) {
      if (currentProcess.radicado) {
        processes.push(currentProcess as IcarusProcess);
      }
      currentProcess = {
        radicado: radicadoMatch[0],
        despacho: '',
      };
    }
    // Try to extract despacho/court name from context
    if (currentProcess.radicado && line.toLowerCase().includes('juzgado')) {
      currentProcess.despacho = line.trim();
    }
  }
  
  if (currentProcess.radicado) {
    processes.push(currentProcess as IcarusProcess);
  }

  console.log(`[LIST_PROCESSES] Found ${processes.length} processes`);
  return { ok: true, processes };
}

async function fetchIcarusProcessDetail(
  cookie: string,
  process: IcarusProcess,
  attempts: AttemptLog[]
): Promise<{ ok: boolean; events: IcarusEvent[]; error?: string }> {
  // Fetch detail page for specific process
  const detailUrl = `${ICARUS_BASE_URL}/procesos/detalle/${encodeURIComponent(process.radicado)}`;
  const result = await scrapeWithCookie(detailUrl, cookie, attempts, 'FETCH_DETAIL');
  
  if (!result.success) {
    return { ok: false, events: [], error: result.error };
  }

  // Parse events from the detail page
  // This is a placeholder - needs actual ICARUS HTML structure
  const events: IcarusEvent[] = [];
  
  const markdown = result.markdown || '';
  const lines = markdown.split('\n');
  
  // Look for date patterns followed by descriptions
  const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
  
  for (const line of lines) {
    const dateMatch = line.match(datePattern);
    if (dateMatch && line.length > 20) {
      events.push({
        fecha: dateMatch[0],
        actuacion: line.replace(dateMatch[0], '').trim(),
      });
    }
  }

  console.log(`[FETCH_DETAIL] Found ${events.length} events for ${process.radicado}`);
  return { ok: true, events };
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, cookie } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const attempts: AttemptLog[] = [];

    // ============= ACTION: TEST =============
    if (action === 'test') {
      if (!cookie) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Cookie is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await testIcarusConnection(cookie, attempts);
      
      return new Response(
        JSON.stringify({ ...result, attempts }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= ACTION: SAVE =============
    if (action === 'save') {
      if (!cookie) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Cookie is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // First test the connection
      const testResult = await testIcarusConnection(cookie, attempts);
      if (!testResult.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: testResult.error || 'Connection test failed', attempts }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Encrypt and save
      const encryptedCookie = encrypt(cookie);
      const last4 = getLast4(cookie);

      const { error: upsertError } = await supabase
        .from('integrations')
        .upsert({
          owner_id: userId,
          provider: 'ICARUS',
          status: 'CONNECTED',
          secret_encrypted: encryptedCookie,
          secret_last4: last4,
          last_error: null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'owner_id,provider',
        });

      if (upsertError) {
        console.error('Failed to save integration:', upsertError);
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to save integration' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, message: 'Integration saved successfully' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= ACTION: LIST_PROCESSES =============
    if (action === 'list') {
      // Get stored cookie
      const { data: integration } = await supabase
        .from('integrations')
        .select('*')
        .eq('owner_id', userId)
        .eq('provider', 'ICARUS')
        .single();

      if (!integration || integration.status !== 'CONNECTED') {
        return new Response(
          JSON.stringify({ ok: false, error: 'ICARUS not connected' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const decryptedCookie = decrypt(integration.secret_encrypted);
      if (!decryptedCookie) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to decrypt cookie' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await listIcarusProcesses(decryptedCookie, attempts);
      
      return new Response(
        JSON.stringify({ ...result, attempts }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('adapter-icarus error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});