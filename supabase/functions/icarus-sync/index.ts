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
  | 'COOKIE_EXPIRED'
  | 'RATE_LIMITED'
  | 'BLOCKED'
  | 'PARSE_BROKE'
  | 'ENDPOINT_CHANGED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

// ============= ENCRYPTION =============

const ENCRYPTION_KEY = Deno.env.get('ICARUS_ENCRYPTION_KEY') || 'default-key-change-me-in-production';

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

const ICARUS_BASE_URL = 'https://www.icarus.com.co';

async function scrapeWithCookie(
  url: string,
  cookie: string,
  attempts: AttemptLog[],
  phase: string
): Promise<{ success: boolean; html?: string; markdown?: string; error?: string; classification?: Classification }> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) {
    return { success: false, error: 'FIRECRAWL_API_KEY not configured', classification: 'NETWORK_ERROR' };
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
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html'],
        headers: { 'Cookie': cookie },
        waitFor: 3000,
        onlyMainContent: false,
      }),
    });

    attempt.status = response.status;
    attempt.latency_ms = Date.now() - startMs;

    if (response.status === 429) {
      attempt.error_type = 'RATE_LIMITED';
      attempts.push(attempt);
      return { success: false, error: 'Rate limited', classification: 'RATE_LIMITED' };
    }

    if (response.status === 403) {
      attempt.error_type = 'BLOCKED';
      attempts.push(attempt);
      return { success: false, error: 'Blocked', classification: 'BLOCKED' };
    }

    if (!response.ok) {
      const errorText = await response.text();
      attempt.error_type = 'HTTP_ERROR';
      attempt.response_snippet = truncate(errorText, 500);
      attempts.push(attempt);
      return { success: false, error: `HTTP ${response.status}`, classification: 'NETWORK_ERROR' };
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || '';
    const html = data.data?.html || data.html || '';

    // Check for login page (cookie expired)
    if (markdown.includes('login') || markdown.includes('iniciar sesión')) {
      if (!markdown.includes('proceso') && !markdown.includes('radicado')) {
        attempt.error_type = 'AUTH_FAILED';
        attempts.push(attempt);
        return { success: false, error: 'Cookie expired', classification: 'COOKIE_EXPIRED' };
      }
    }

    attempt.success = true;
    attempt.response_snippet = truncate(markdown, 500);
    attempts.push(attempt);

    return { success: true, html, markdown };
  } catch (err) {
    attempt.latency_ms = Date.now() - startMs;
    attempt.error_type = 'NETWORK_ERROR';
    attempt.response_snippet = err instanceof Error ? err.message : 'Unknown error';
    attempts.push(attempt);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error', classification: 'NETWORK_ERROR' };
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
  const startTime = Date.now();
  const steps: Step[] = [];
  const attempts: AttemptLog[] = [];
  let classification: Classification = 'UNKNOWN';
  let processesFound = 0;
  let eventsCreated = 0;

  try {
    const { mode = 'manual', fullSync = true } = await req.json();

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

    // Create sync run record
    const { data: runData } = await supabase
      .from('icarus_sync_runs')
      .insert({
        owner_id: userId,
        status: 'RUNNING',
        mode,
        steps: [],
        attempts: [],
      })
      .select('id')
      .single();

    runId = runData?.id;

    // Step 1: Load integration
    steps.push({ name: 'load_integration', started_at: new Date().toISOString(), status: 'running' });

    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('owner_id', userId)
      .eq('provider', 'ICARUS')
      .single();

    if (integrationError || !integration || integration.status !== 'CONNECTED') {
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].detail = 'ICARUS not connected';
      steps[steps.length - 1].finished_at = new Date().toISOString();
      classification = 'AUTH_FAILED';

      if (runId) {
        await supabase.from('icarus_sync_runs').update({
          finished_at: new Date().toISOString(),
          status: 'ERROR',
          classification,
          steps,
          attempts,
          error_message: 'ICARUS not connected',
        }).eq('id', runId);
      }

      return new Response(
        JSON.stringify({ ok: false, error: 'ICARUS not connected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].finished_at = new Date().toISOString();

    // Step 2: Decrypt cookie
    steps.push({ name: 'decrypt_cookie', started_at: new Date().toISOString(), status: 'running' });

    const cookie = decrypt(integration.secret_encrypted);
    if (!cookie) {
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].detail = 'Failed to decrypt cookie';
      steps[steps.length - 1].finished_at = new Date().toISOString();
      classification = 'AUTH_FAILED';

      // Update integration status
      await supabase.from('integrations').update({
        status: 'ERROR',
        last_error: 'Failed to decrypt cookie',
      }).eq('id', integration.id);

      if (runId) {
        await supabase.from('icarus_sync_runs').update({
          finished_at: new Date().toISOString(),
          status: 'ERROR',
          classification,
          steps,
          attempts,
          error_message: 'Failed to decrypt cookie',
        }).eq('id', runId);
      }

      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to decrypt cookie' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].finished_at = new Date().toISOString();

    // Step 3: List processes from ICARUS
    steps.push({ name: 'list_processes', started_at: new Date().toISOString(), status: 'running' });

    const listUrl = `${ICARUS_BASE_URL}/procesos/lista`;
    const listResult = await scrapeWithCookie(listUrl, cookie, attempts, 'LIST_PROCESSES');

    if (!listResult.success) {
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].detail = listResult.error;
      steps[steps.length - 1].finished_at = new Date().toISOString();
      classification = listResult.classification || 'UNKNOWN';

      // Update integration status if auth failed
      if (classification === 'COOKIE_EXPIRED' || classification === 'AUTH_FAILED') {
        await supabase.from('integrations').update({
          status: 'ERROR',
          last_error: 'Cookie expired - please reconnect',
        }).eq('id', integration.id);
      }

      if (runId) {
        await supabase.from('icarus_sync_runs').update({
          finished_at: new Date().toISOString(),
          status: 'ERROR',
          classification,
          steps,
          attempts,
          error_message: listResult.error,
        }).eq('id', runId);
      }

      return new Response(
        JSON.stringify({ ok: false, error: listResult.error, classification, attempts }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse processes from markdown
    const markdown = listResult.markdown || '';
    const radicadoPattern = /(\d{2}-\d{3}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5})/g;
    const foundRadicados = [...new Set(markdown.match(radicadoPattern) || [])];
    processesFound = foundRadicados.length;

    steps[steps.length - 1].status = 'success';
    steps[steps.length - 1].detail = `Found ${processesFound} processes`;
    steps[steps.length - 1].finished_at = new Date().toISOString();

    // Step 4: Sync each process
    steps.push({ name: 'sync_processes', started_at: new Date().toISOString(), status: 'running' });

    let processErrors = 0;

    for (const radicado of foundRadicados) {
      try {
        // Upsert monitored_process
        const { data: monitoredProcess } = await supabase
          .from('monitored_processes')
          .upsert({
            owner_id: userId,
            radicado,
            monitoring_enabled: true,
            sources_enabled: ['ICARUS'],
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'owner_id,radicado',
          })
          .select('id')
          .single();

        if (!monitoredProcess) continue;

        // Fetch process details
        const detailUrl = `${ICARUS_BASE_URL}/procesos/detalle/${encodeURIComponent(radicado)}`;
        const detailResult = await scrapeWithCookie(detailUrl, cookie, attempts, `FETCH_DETAIL_${radicado}`);

        if (detailResult.success) {
          const detailMarkdown = detailResult.markdown || '';
          
          // Parse events from detail page (simplified - needs actual ICARUS structure)
          const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[-:]\s*(.+)/g;
          let match;
          
          while ((match = datePattern.exec(detailMarkdown)) !== null) {
            const eventDate = parseIcarusDate(match[1]);
            const description = match[2].trim();
            const fingerprint = computeFingerprint('ICARUS', radicado, eventDate, description);

            // Check if event already exists
            const { data: existing } = await supabase
              .from('process_events')
              .select('id')
              .eq('hash_fingerprint', fingerprint)
              .maybeSingle();

            if (!existing) {
              // Need to find or create a filing for this radicado
              let { data: filing } = await supabase
                .from('filings')
                .select('id')
                .eq('owner_id', userId)
                .eq('radicado', radicado)
                .maybeSingle();

              if (!filing) {
                // Check if there's a matter to attach to (use first one)
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
                      radicado,
                      filing_type: 'ICARUS_IMPORT',
                      status: 'MONITORING_ACTIVE',
                    })
                    .select('id')
                    .single();
                  filing = newFiling;
                }
              }

              if (filing) {
                await supabase.from('process_events').insert({
                  owner_id: userId,
                  filing_id: filing.id,
                  monitored_process_id: monitoredProcess.id,
                  source: 'ICARUS',
                  event_type: 'ACTUACION',
                  event_date: eventDate,
                  description,
                  hash_fingerprint: fingerprint,
                  source_url: detailUrl,
                });
                eventsCreated++;
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error syncing process ${radicado}:`, err);
        processErrors++;
      }
    }

    steps[steps.length - 1].status = processErrors > 0 ? 'error' : 'success';
    steps[steps.length - 1].detail = `Synced ${processesFound - processErrors}/${processesFound} processes, ${eventsCreated} new events`;
    steps[steps.length - 1].finished_at = new Date().toISOString();

    // Determine final classification
    if (processErrors === 0 && eventsCreated >= 0) {
      classification = 'SUCCESS';
    } else if (processErrors > 0 && processErrors < processesFound) {
      classification = 'PARTIAL';
    } else if (processErrors === processesFound && processesFound > 0) {
      classification = 'PARSE_BROKE';
    } else {
      classification = 'SUCCESS';
    }

    // Update integration
    await supabase.from('integrations').update({
      last_sync_at: new Date().toISOString(),
      last_error: processErrors > 0 ? `${processErrors} process(es) failed to sync` : null,
      status: 'CONNECTED',
    }).eq('id', integration.id);

    // Finalize run
    if (runId) {
      await supabase.from('icarus_sync_runs').update({
        finished_at: new Date().toISOString(),
        status: processErrors > 0 ? 'PARTIAL' : 'SUCCESS',
        classification,
        processes_found: processesFound,
        events_created: eventsCreated,
        steps,
        attempts,
      }).eq('id', runId);
    }

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
    console.error('icarus-sync error:', err);

    if (runId) {
      await supabase.from('icarus_sync_runs').update({
        finished_at: new Date().toISOString(),
        status: 'ERROR',
        classification: 'UNKNOWN',
        steps,
        attempts,
        error_message: err instanceof Error ? err.message : 'Unknown error',
      }).eq('id', runId);
    }

    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});