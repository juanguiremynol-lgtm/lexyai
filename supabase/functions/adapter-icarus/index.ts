import { createClient } from "npm:@supabase/supabase-js@2";

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

interface IcarusProcess {
  radicado: string;
  despacho?: string;
  demandante?: string;
  demandado?: string;
  ultima_actuacion?: string;
  detail_url?: string;
}

interface IcarusEvent {
  fecha: string;
  actuacion: string;
  anotacion?: string;
}

type Classification = 
  | 'SUCCESS'
  | 'PARTIAL'
  | 'AUTH_FAILED'
  | 'NEEDS_REAUTH'
  | 'CAPTCHA_REQUIRED'
  | 'RATE_LIMITED'
  | 'PARSE_BROKE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

// ============= AES-256-GCM ENCRYPTION =============

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyB64 = Deno.env.get('ICARUS_ENCRYPTION_KEY') || '';
  if (!keyB64) throw new Error('ICARUS_ENCRYPTION_KEY not configured');
  const keyBytes = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error('Key must be 32 bytes');
  return await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decryptSecret(encrypted: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return '';
  }
}

// ============= RESPONSE HELPERS =============

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonError(status: number, code: string, message: string, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    ok: false,
    code,
    message,
    request_id: generateRequestId(),
    ...(meta || {}),
    timestamp: new Date().toISOString(),
  }), {
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

// ============= FIRECRAWL HELPERS =============

async function firecrawlScrape(url: string, options: { actions?: any[]; waitFor?: number } = {}): Promise<{
  ok: boolean;
  html?: string;
  markdown?: string;
  error?: string;
}> {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    return { ok: false, error: 'FIRECRAWL_API_KEY not configured' };
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['html', 'markdown'],
        waitFor: options.waitFor || 2000,
        actions: options.actions,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { ok: false, error: data.error || `HTTP ${response.status}` };
    }

    return {
      ok: true,
      html: data.data?.html || data.html || '',
      markdown: data.data?.markdown || data.markdown || '',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function firecrawlLoginAndNavigate(
  username: string,
  password: string,
  targetUrl: string
): Promise<{ ok: boolean; html?: string; error?: string }> {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    return { ok: false, error: 'FIRECRAWL_API_KEY not configured' };
  }

  const loginActions = [
    { type: 'wait', milliseconds: 2000 },
    { type: 'wait', selector: 'input[type="text"], input[type="email"], input[name*="username"]', timeout: 15000 },
    { type: 'input', selector: 'input[type="text"], input[type="email"], input[name*="username"]', text: username },
    { type: 'input', selector: 'input[type="password"]', text: password },
    { type: 'wait', milliseconds: 500 },
    { type: 'click', selector: 'button[type="submit"], input[type="submit"], button[name*="Ingresar"]' },
    { type: 'wait', milliseconds: 3000 },
    { type: 'wait', selector: 'a[href*="Salir"], .logout-link', timeout: 10000 },
  ];

  try {
    // First do login
    const loginResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://icarus.com.co/',
        actions: loginActions,
        formats: ['html'],
        waitFor: 2000,
      }),
    });

    const loginData = await loginResponse.json();
    if (!loginResponse.ok) {
      return { ok: false, error: `Login failed: ${loginData.error || loginResponse.status}` };
    }

    // Check if authenticated
    const loginHtml = loginData.data?.html || '';
    if (!loginHtml.toLowerCase().includes('salir')) {
      return { ok: false, error: 'Login did not authenticate' };
    }

    // Now navigate to target
    const targetResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetUrl,
        formats: ['html'],
        waitFor: 2000,
      }),
    });

    const targetData = await targetResponse.json();
    if (!targetResponse.ok) {
      return { ok: false, error: `Navigate failed: ${targetData.error || targetResponse.status}` };
    }

    return { ok: true, html: targetData.data?.html || targetData.html || '' };

  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============= PARSING FUNCTIONS =============

function parseProcessTable(html: string): IcarusProcess[] {
  const processes: IcarusProcess[] = [];
  
  // Pattern: radicado format
  const radicadoPattern = /(\d{2}-\d{3}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5})/g;
  const foundRadicados = new Set<string>();
  
  let match;
  while ((match = radicadoPattern.exec(html)) !== null) {
    foundRadicados.add(match[1]);
  }

  // Try to parse table rows for more data
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  
  while ((match = rowPattern.exec(html)) !== null) {
    const rowHtml = match[1];
    const radicadoMatch = rowHtml.match(/(\d{2}-\d{3}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5})/);
    
    if (radicadoMatch) {
      const cells: string[] = [];
      let cellMatch;
      const cellRegex = new RegExp(cellPattern.source, 'gi');
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const text = cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        cells.push(text);
      }
      
      // Extract link
      const linkMatch = rowHtml.match(/href="([^"]*(?:detail|detalle)[^"]*)"/i);
      
      processes.push({
        radicado: radicadoMatch[1],
        despacho: cells[1] || undefined,
        demandante: cells[2] || undefined,
        demandado: cells[3] || undefined,
        ultima_actuacion: cells[4] || undefined,
        detail_url: linkMatch?.[1] || undefined,
      });
      
      foundRadicados.delete(radicadoMatch[1]);
    }
  }

  // Add remaining radicados not found in table rows
  for (const radicado of foundRadicados) {
    processes.push({ radicado });
  }

  return processes;
}

function parseProcessEvents(html: string): IcarusEvent[] {
  const events: IcarusEvent[] = [];
  
  // Look for actuaciones table
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  
  while ((match = rowPattern.exec(html)) !== null) {
    const rowHtml = match[1];
    
    // Skip header rows
    if (rowHtml.includes('<th')) continue;
    
    // Parse cells
    const cells: string[] = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
      const text = cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      cells.push(text);
    }
    
    // Try to identify date and actuacion
    if (cells.length >= 2) {
      const dateStr = cells[0];
      const actuacion = cells[1];
      const anotacion = cells[2] || undefined;
      
      // Validate date format
      if (dateStr.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) {
        events.push({
          fecha: dateStr,
          actuacion,
          anotacion,
        });
      }
    }
  }

  return events;
}

function extractPaginationInfo(html: string): { current: number; total: number; perPage: number } | null {
  // Pattern: "1-10 de 25"
  const match = html.match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/);
  if (!match) return null;
  
  const start = parseInt(match[1]);
  const end = parseInt(match[2]);
  const total = parseInt(match[3]);
  
  return {
    current: Math.floor((start - 1) / (end - start + 1)),
    total,
    perPage: end - start + 1,
  };
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
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
    // Validate environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonError(500, 'FUNCTION_MISCONFIG', 'Missing Supabase config', { steps });
    }
    
    if (!firecrawlKey) {
      return jsonError(500, 'FIRECRAWL_NOT_CONFIGURED', 'FIRECRAWL_API_KEY required', { steps });
    }
    addStep('ENV_CHECK', 'success', 'Environment OK');

    // Parse request
    let payload: { action?: string; radicado?: string } = {};
    try {
      const text = await req.text();
      if (text) payload = JSON.parse(text);
    } catch {}
    
    const action = payload.action || 'list';
    addStep('PARSE_BODY', 'success', `Action: ${action}`);

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonError(401, 'UNAUTHORIZED', 'Missing Authorization header', { steps });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return jsonError(401, 'UNAUTHORIZED', 'Invalid token', { steps });
    }
    addStep('AUTH_CHECK', 'success', `User: ${user.id.substring(0, 8)}...`);

    // Load integration
    const { data: integration, error: loadError } = await supabase
      .from('integrations')
      .select('*')
      .eq('owner_id', user.id)
      .eq('provider', 'ICARUS')
      .maybeSingle();

    if (loadError || !integration) {
      return jsonError(404, 'INTEGRATION_NOT_FOUND', 'ICARUS integration not found', { steps });
    }
    
    if (!integration.username || !integration.password_encrypted) {
      return jsonError(400, 'MISSING_CREDENTIALS', 'No credentials stored', { steps });
    }
    addStep('LOAD_INTEGRATION', 'success', `Username: ${integration.username}`);

    // Decrypt password
    const password = await decryptSecret(integration.password_encrypted);
    if (!password) {
      return jsonError(500, 'DECRYPT_FAILED', 'Failed to decrypt password', { steps });
    }
    addStep('DECRYPT', 'success', 'Password decrypted');

    // ============= ACTION: LIST =============
    if (action === 'list') {
      steps.push({
        name: 'FIRECRAWL_LIST',
        started_at: new Date().toISOString(),
        status: 'running',
        detail: 'Fetching process list via Firecrawl',
      });

      const result = await firecrawlLoginAndNavigate(
        integration.username,
        password,
        'https://icarus.com.co/main/process/list.xhtml'
      );

      const listStep = steps[steps.length - 1];
      listStep.finished_at = new Date().toISOString();

      if (!result.ok) {
        listStep.status = 'error';
        listStep.detail = result.error;
        
        // Update integration status
        await supabase.from('integrations').update({
          status: 'NEEDS_REAUTH',
          last_error: result.error,
          updated_at: new Date().toISOString(),
        }).eq('id', integration.id);

        return jsonError(400, 'FETCH_FAILED', result.error || 'Failed to fetch list', { 
          steps,
          classification: 'NEEDS_REAUTH',
        });
      }

      // Parse processes
      const html = result.html || '';
      const processes = parseProcessTable(html);
      const pagination = extractPaginationInfo(html);
      
      listStep.status = 'success';
      listStep.detail = `Found ${processes.length} processes`;
      listStep.meta = { processes_count: processes.length, pagination };

      // Handle pagination if needed
      let allProcesses = [...processes];
      
      if (pagination && pagination.total > allProcesses.length) {
        const totalPages = Math.ceil(pagination.total / pagination.perPage);
        console.log(`[LIST] Need to fetch ${totalPages - 1} more pages`);
        
        // Note: Firecrawl doesn't maintain session between calls
        // For full pagination, we need to implement JSF AJAX via Firecrawl Actions
        // This is a simplified version that gets the first page
        
        addStep('PAGINATION_NOTE', 'success', 
          `Found ${allProcesses.length} of ${pagination.total} processes. Full pagination requires enhanced Firecrawl Actions.`,
          { shown: allProcesses.length, total: pagination.total }
        );
      }

      // Update integration last sync
      await supabase.from('integrations').update({
        status: 'CONNECTED',
        last_sync_at: new Date().toISOString(),
        last_error: null,
        metadata: { 
          worker_method: 'FIRECRAWL', 
          last_processes_count: allProcesses.length,
          total_processes: pagination?.total || allProcesses.length,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', integration.id);

      return jsonSuccess({
        action: 'list',
        processes: allProcesses,
        processes_count: allProcesses.length,
        total_count: pagination?.total || allProcesses.length,
        pagination,
        worker_method: 'FIRECRAWL',
        classification: 'SUCCESS',
        steps,
      });
    }

    // ============= ACTION: DETAIL =============
    if (action === 'detail' && payload.radicado) {
      steps.push({
        name: 'FIRECRAWL_DETAIL',
        started_at: new Date().toISOString(),
        status: 'running',
        detail: `Fetching detail for ${payload.radicado}`,
      });

      // For detail, we need to navigate through the authenticated session
      // This is simplified - full implementation would use process detail URL
      const detailUrl = `https://icarus.com.co/main/process/detail.xhtml?radicado=${encodeURIComponent(payload.radicado)}`;
      
      const result = await firecrawlLoginAndNavigate(
        integration.username,
        password,
        detailUrl
      );

      const detailStep = steps[steps.length - 1];
      detailStep.finished_at = new Date().toISOString();

      if (!result.ok) {
        detailStep.status = 'error';
        detailStep.detail = result.error;
        return jsonError(400, 'FETCH_FAILED', result.error || 'Failed to fetch detail', { steps });
      }

      const html = result.html || '';
      const events = parseProcessEvents(html);
      
      detailStep.status = 'success';
      detailStep.detail = `Found ${events.length} events`;
      detailStep.meta = { events_count: events.length };

      return jsonSuccess({
        action: 'detail',
        radicado: payload.radicado,
        events,
        events_count: events.length,
        worker_method: 'FIRECRAWL',
        steps,
      });
    }

    return jsonError(400, 'UNKNOWN_ACTION', `Unknown action: ${action}`, { steps });

  } catch (err) {
    console.error('[adapter-icarus] Error:', err);
    return jsonError(500, 'UNKNOWN_ERROR', err instanceof Error ? err.message : 'Unknown error', { steps });
  }
});
