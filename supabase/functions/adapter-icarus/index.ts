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

interface CookieJar {
  cookies: { name: string; value: string; domain: string; path: string }[];
  viewState?: string;
}

interface IcarusProcess {
  icarus_id?: string;
  radicado: string;
  despacho?: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  detail_url?: string;
}

interface IcarusEvent {
  fecha: string;
  actuacion: string;
  anotacion?: string;
  fecha_inicial?: string;
  fecha_final?: string;
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

// ============= UTILITIES =============

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

function cookieJarToHeader(cookieJar: CookieJar): string {
  return cookieJar.cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function extractViewState(html: string): string | null {
  const patterns = [
    /name="javax\.faces\.ViewState"\s+value="([^"]+)"/i,
    /id="javax\.faces\.ViewState"\s+value="([^"]+)"/i,
    /<input[^>]*name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/i,
    /name="javax\.faces\.ViewState"[^>]*value='([^']+)'/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
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

const ICARUS_BASE_URL = 'https://icarus.com.co';
const PROCESS_LIST_URL = `${ICARUS_BASE_URL}/main/process/list.xhtml`;

// ============= JSF/PRIMEFACES DATATABLE HANDLING =============

interface DataTableInfo {
  tableId: string;
  paginatorId?: string;
  first: number;
  rows: number;
  totalRecords: number;
}

function extractDataTableInfo(html: string): DataTableInfo | null {
  // Look for PrimeFaces DataTable patterns
  const tableIdMatch = html.match(/id="([^"]*:?processTable[^"]*)"/) || 
                       html.match(/id="([^"]*:?dataTable[^"]*)"/) ||
                       html.match(/id="([^"]*:?listTable[^"]*)"/) ||
                       html.match(/class="[^"]*ui-datatable[^"]*"[^>]*id="([^"]+)"/);
  
  if (!tableIdMatch) return null;
  
  const tableId = tableIdMatch[1];
  
  // Look for paginator info "1-10 de 25"
  const paginatorMatch = html.match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/);
  let first = 0;
  let rows = 10;
  let totalRecords = 0;
  
  if (paginatorMatch) {
    first = parseInt(paginatorMatch[1]) - 1;
    rows = parseInt(paginatorMatch[2]) - first;
    totalRecords = parseInt(paginatorMatch[3]);
  }
  
  // Look for paginator component ID
  const paginatorIdMatch = html.match(/id="([^"]*paginator[^"]*)"/i);
  
  return {
    tableId,
    paginatorId: paginatorIdMatch?.[1],
    first,
    rows,
    totalRecords,
  };
}

function parseProcessesFromHtml(html: string): IcarusProcess[] {
  const processes: IcarusProcess[] = [];
  
  // Pattern 1: Look for radicado patterns in table rows
  const radicadoPattern = /(\d{2}-\d{3}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5})/g;
  const foundRadicados = new Set<string>();
  
  let match;
  while ((match = radicadoPattern.exec(html)) !== null) {
    foundRadicados.add(match[1]);
  }
  
  // Pattern 2: Look for table rows with process data
  const rowPattern = /<tr[^>]*class="[^"]*ui-widget-content[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows: string[] = [];
  while ((match = rowPattern.exec(html)) !== null) {
    rows.push(match[1]);
  }
  
  // Pattern 3: Try to extract from each row
  for (const row of rows) {
    const radicadoMatch = row.match(/(\d{2}-\d{3}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5})/);
    if (radicadoMatch) {
      const radicado = radicadoMatch[1];
      
      // Try to extract detail link
      const linkMatch = row.match(/href="([^"]*(?:detail|detalle)[^"]*)"/i) ||
                       row.match(/onclick="[^"]*window\.location\s*=\s*'([^']+)'/i);
      
      // Try to extract despacho
      const despachoMatch = row.match(/(?:juzgado|tribunal|corte)[^<]*/i);
      
      processes.push({
        radicado,
        detail_url: linkMatch?.[1],
        despacho: despachoMatch?.[0]?.trim(),
      });
    }
  }
  
  // If no rows found but we have radicados, add them
  if (processes.length === 0) {
    for (const radicado of foundRadicados) {
      processes.push({ radicado });
    }
  }
  
  return processes;
}

async function fetchWithJsfAjax(
  cookieJar: CookieJar,
  tableInfo: DataTableInfo,
  pageNumber: number,
  attempts: AttemptLog[]
): Promise<{ ok: boolean; html?: string; error?: string; classification?: Classification }> {
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
    
    // Add form ID (usually the parent form)
    const formId = tableInfo.tableId.split(':')[0] || 'form';
    formData.append(formId, formId);
    
    const response = await fetch(PROCESS_LIST_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieJarToHeader(cookieJar),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Faces-Request': 'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/xml, text/xml, */*; q=0.01',
        'Referer': PROCESS_LIST_URL,
      },
      body: formData.toString(),
    });
    
    attempt.status = response.status;
    attempt.latency_ms = Date.now() - startMs;
    
    if (!response.ok) {
      attempt.error_type = 'HTTP_ERROR';
      attempts.push(attempt);
      return { ok: false, error: `HTTP ${response.status}`, classification: 'NETWORK_ERROR' };
    }
    
    const xml = await response.text();
    attempt.response_snippet = truncate(xml, 500);
    
    // Parse partial-response XML
    // Extract content from <update> blocks
    const updateMatch = xml.match(/<update[^>]*id="[^"]*"[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/update>/);
    const html = updateMatch?.[1] || xml;
    
    // Update ViewState if present in response
    const newViewState = extractViewState(xml);
    if (newViewState) {
      cookieJar.viewState = newViewState;
    }
    
    attempt.success = true;
    attempts.push(attempt);
    
    return { ok: true, html };
    
  } catch (err) {
    attempt.latency_ms = Date.now() - startMs;
    attempt.error_type = 'NETWORK_ERROR';
    attempt.response_snippet = err instanceof Error ? err.message : 'Unknown error';
    attempts.push(attempt);
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error', classification: 'NETWORK_ERROR' };
  }
}

async function listProcesses(
  cookieJar: CookieJar,
  attempts: AttemptLog[]
): Promise<{ ok: boolean; processes: IcarusProcess[]; classification: Classification; evidenceSnapshot?: string }> {
  
  // Step 1: Fetch initial list page
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieJarToHeader(cookieJar),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'manual',
    });
    
    attempt.status = response.status;
    attempt.latency_ms = Date.now() - startMs;
    
    // Check for redirect to login
    if (response.status === 302 || response.status === 303) {
      const location = response.headers.get('location');
      if (location?.includes('login')) {
        attempt.error_type = 'AUTH_FAILED';
        attempt.response_snippet = `Redirected to: ${location}`;
        attempts.push(attempt);
        return { ok: false, processes: [], classification: 'NEEDS_REAUTH' };
      }
    }
    
    const html = await response.text();
    attempt.response_snippet = truncate(html, 500);
    
    // Check if we're on login page
    if (html.toLowerCase().includes('login') && !html.toLowerCase().includes('salir')) {
      attempt.error_type = 'AUTH_FAILED';
      attempts.push(attempt);
      return { ok: false, processes: [], classification: 'NEEDS_REAUTH' };
    }
    
    attempt.success = true;
    attempts.push(attempt);
    
    // Extract ViewState for future requests
    const viewState = extractViewState(html);
    if (viewState) {
      cookieJar.viewState = viewState;
    }
    
    // Extract DataTable info
    const tableInfo = extractDataTableInfo(html);
    console.log('[LIST] DataTable info:', tableInfo);
    
    // Parse processes from initial page
    let allProcesses = parseProcessesFromHtml(html);
    console.log(`[LIST] Found ${allProcesses.length} processes on initial page`);
    
    // DIAGNOSTIC RULE: If authenticated but 0 processes and total > 0, this is PARSE_BROKE
    if (tableInfo && tableInfo.totalRecords > 0 && allProcesses.length === 0) {
      console.log('[LIST] Authenticated but found 0 processes when expecting', tableInfo.totalRecords);
      
      // Try JSF AJAX pagination
      if (tableInfo.tableId && viewState) {
        console.log('[LIST] Attempting JSF AJAX to hydrate table...');
        const ajaxResult = await fetchWithJsfAjax(cookieJar, tableInfo, 0, attempts);
        
        if (ajaxResult.ok && ajaxResult.html) {
          const ajaxProcesses = parseProcessesFromHtml(ajaxResult.html);
          if (ajaxProcesses.length > 0) {
            allProcesses = ajaxProcesses;
            console.log(`[LIST] JSF AJAX returned ${ajaxProcesses.length} processes`);
          }
        }
      }
      
      // Still 0? Return PARSE_BROKE with evidence
      if (allProcesses.length === 0) {
        return {
          ok: false,
          processes: [],
          classification: 'JSF_AJAX_NOT_REPLAYED',
          evidenceSnapshot: html.substring(0, 5000),
        };
      }
    }
    
    // If we have processes and there are more pages, fetch them
    if (tableInfo && tableInfo.totalRecords > allProcesses.length && viewState) {
      const totalPages = Math.ceil(tableInfo.totalRecords / tableInfo.rows);
      console.log(`[LIST] Total pages: ${totalPages}, fetching remaining...`);
      
      for (let page = 1; page < totalPages && page < 10; page++) { // Cap at 10 pages for safety
        const pageResult = await fetchWithJsfAjax(cookieJar, tableInfo, page, attempts);
        if (pageResult.ok && pageResult.html) {
          const pageProcesses = parseProcessesFromHtml(pageResult.html);
          allProcesses.push(...pageProcesses);
          console.log(`[LIST] Page ${page + 1}: found ${pageProcesses.length} more processes`);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    // Deduplicate by radicado
    const uniqueProcesses = new Map<string, IcarusProcess>();
    for (const process of allProcesses) {
      if (!uniqueProcesses.has(process.radicado)) {
        uniqueProcesses.set(process.radicado, process);
      }
    }
    
    const finalProcesses = Array.from(uniqueProcesses.values());
    console.log(`[LIST] Final unique processes: ${finalProcesses.length}`);
    
    return {
      ok: true,
      processes: finalProcesses,
      classification: 'SUCCESS',
    };
    
  } catch (err) {
    attempt.latency_ms = Date.now() - startMs;
    attempt.error_type = 'NETWORK_ERROR';
    attempt.response_snippet = err instanceof Error ? err.message : 'Unknown error';
    attempts.push(attempt);
    return { ok: false, processes: [], classification: 'NETWORK_ERROR' };
  }
}

async function fetchProcessDetail(
  cookieJar: CookieJar,
  process: IcarusProcess,
  attempts: AttemptLog[]
): Promise<{ ok: boolean; events: IcarusEvent[]; error?: string }> {
  
  const detailUrl = process.detail_url 
    ? (process.detail_url.startsWith('http') ? process.detail_url : `${ICARUS_BASE_URL}${process.detail_url}`)
    : `${ICARUS_BASE_URL}/main/process/detail.xhtml?radicado=${encodeURIComponent(process.radicado)}`;
  
  const attempt: AttemptLog = {
    phase: `DETAIL_${process.radicado.substring(0, 20)}`,
    url: detailUrl,
    method: 'GET',
    status: null,
    latency_ms: 0,
    success: false,
  };
  
  const startMs = Date.now();
  
  try {
    const response = await fetch(detailUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieJarToHeader(cookieJar),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    attempt.status = response.status;
    attempt.latency_ms = Date.now() - startMs;
    
    if (!response.ok) {
      attempt.error_type = 'HTTP_ERROR';
      attempts.push(attempt);
      return { ok: false, events: [], error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    attempt.response_snippet = truncate(html, 500);
    attempt.success = true;
    attempts.push(attempt);
    
    // Parse events from detail page
    const events: IcarusEvent[] = [];
    
    // Pattern 1: Table rows with date and description
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;
    while ((match = rowPattern.exec(html)) !== null) {
      const rowHtml = match[1];
      const dateMatch = rowHtml.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
      if (dateMatch) {
        // Extract text from cells
        const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells: string[] = [];
        let cellMatch;
        while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
          const cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim();
          if (cellText) cells.push(cellText);
        }
        
        if (cells.length >= 2) {
          events.push({
            fecha: dateMatch[1],
            actuacion: cells.slice(1).join(' - '),
          });
        }
      }
    }
    
    // Pattern 2: Look for actuaciones in text format
    if (events.length === 0) {
      const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[-:]\s*([^\n<]+)/g;
      while ((match = datePattern.exec(html)) !== null) {
        events.push({
          fecha: match[1],
          actuacion: match[2].trim(),
        });
      }
    }
    
    return { ok: true, events };
    
  } catch (err) {
    attempt.latency_ms = Date.now() - startMs;
    attempt.error_type = 'NETWORK_ERROR';
    attempt.response_snippet = err instanceof Error ? err.message : 'Unknown error';
    attempts.push(attempt);
    return { ok: false, events: [], error: err instanceof Error ? err.message : 'Unknown error' };
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

  const attempts: AttemptLog[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    const { action = 'list' } = body;

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

    // Load integration
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('owner_id', userId)
      .eq('provider', 'ICARUS')
      .single();

    if (integrationError || !integration) {
      return new Response(
        JSON.stringify({ ok: false, error: 'ICARUS not connected', classification: 'AUTH_FAILED' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!integration.session_encrypted) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No session available - login required', classification: 'NEEDS_REAUTH' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt session
    const sessionJson = await decryptSecret(integration.session_encrypted);
    if (!sessionJson) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to decrypt session', classification: 'AUTH_FAILED' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let cookieJar: CookieJar;
    try {
      cookieJar = JSON.parse(sessionJson);
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid session data', classification: 'AUTH_FAILED' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= ACTION: LIST =============
    if (action === 'list') {
      const result = await listProcesses(cookieJar, attempts);
      
      // Update session if ViewState changed
      if (cookieJar.viewState) {
        const encryptedSession = await encryptSession(cookieJar);
        if (encryptedSession) {
          await supabase.from('integrations').update({
            session_encrypted: encryptedSession,
            session_last_ok_at: result.ok ? new Date().toISOString() : undefined,
          }).eq('id', integration.id);
        }
      }

      if (!result.ok) {
        // Update integration status if auth failed
        if (result.classification === 'NEEDS_REAUTH') {
          await supabase.from('integrations').update({
            status: 'NEEDS_REAUTH',
            last_error: 'Session expired',
          }).eq('id', integration.id);
        }
      }

      return new Response(
        JSON.stringify({
          ok: result.ok,
          processes: result.processes,
          classification: result.classification,
          evidenceSnapshot: result.evidenceSnapshot?.substring(0, 2000),
          attempts,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= ACTION: SYNC (full sync with events) =============
    if (action === 'sync') {
      const listResult = await listProcesses(cookieJar, attempts);
      
      if (!listResult.ok) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Failed to list processes',
            classification: listResult.classification,
            attempts,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let eventsCreated = 0;
      let processesUpserted = 0;

      for (const process of listResult.processes) {
        try {
          // Upsert monitored_process
          const { data: monitoredProcess } = await supabase
            .from('monitored_processes')
            .upsert({
              owner_id: userId,
              radicado: process.radicado,
              despacho_name: process.despacho,
              monitoring_enabled: true,
              sources_enabled: ['ICARUS'],
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'owner_id,radicado',
            })
            .select('id')
            .single();

          if (monitoredProcess) {
            processesUpserted++;
          }

          // Fetch details
          const detailResult = await fetchProcessDetail(cookieJar, process, attempts);
          
          if (detailResult.ok && detailResult.events.length > 0) {
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

              if (matters && matters.length > 0) {
                const { data: newFiling } = await supabase
                  .from('filings')
                  .insert({
                    owner_id: userId,
                    matter_id: matters[0].id,
                    radicado: process.radicado,
                    filing_type: 'ICARUS_IMPORT',
                    status: 'MONITORING_ACTIVE',
                    court_name: process.despacho,
                  })
                  .select('id')
                  .single();
                filing = newFiling;
              }
            }

            if (filing) {
              for (const event of detailResult.events) {
                const eventDate = parseIcarusDate(event.fecha);
                const fingerprint = computeFingerprint('ICARUS', process.radicado, eventDate, event.actuacion);

                const { data: existing } = await supabase
                  .from('process_events')
                  .select('id')
                  .eq('hash_fingerprint', fingerprint)
                  .maybeSingle();

                if (!existing) {
                  await supabase.from('process_events').insert({
                    owner_id: userId,
                    filing_id: filing.id,
                    monitored_process_id: monitoredProcess?.id,
                    source: 'ICARUS',
                    event_type: 'ACTUACION',
                    event_date: eventDate,
                    description: event.actuacion,
                    detail: event.anotacion,
                    hash_fingerprint: fingerprint,
                  });
                  eventsCreated++;
                }
              }
            }
          }

          // Small delay between processes
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (err) {
          console.error(`[SYNC] Error processing ${process.radicado}:`, err);
        }
      }

      // Update integration
      await supabase.from('integrations').update({
        last_sync_at: new Date().toISOString(),
        session_last_ok_at: new Date().toISOString(),
        status: 'CONNECTED',
        last_error: null,
      }).eq('id', integration.id);

      return new Response(
        JSON.stringify({
          ok: true,
          processes_found: listResult.processes.length,
          processes_upserted: processesUpserted,
          events_created: eventsCreated,
          classification: 'SUCCESS',
          attempts,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[adapter-icarus] Error:', err);
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: err instanceof Error ? err.message : 'Unknown error',
        attempts 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper to encrypt session
async function encryptSession(cookieJar: CookieJar): Promise<string | null> {
  try {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(cookieJar));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );
    const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
  } catch {
    return null;
  }
}
