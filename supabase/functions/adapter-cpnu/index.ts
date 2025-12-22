import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessEvent {
  source: string;
  event_type: string;
  event_date: string | null;
  title: string;
  description: string;
  detail?: string;
  attachments: Array<{ label: string; url: string }>;
  source_url: string;
  hash_fingerprint: string;
  raw_data?: Record<string, unknown>;
}

interface SearchResult {
  radicado: string;
  despacho: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  fecha_radicacion?: string;
  detail_url?: string;
  id_proceso?: number;
}

// Compute hash fingerprint for deduplication
function computeFingerprint(source: string, eventDate: string | null, description: string, sourceUrl: string): string {
  const data = `${source}|${eventDate || ''}|${description}|${sourceUrl}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Parse Colombian date format
function parseColombianDate(dateStr: string): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return new Date(dateStr).toISOString();
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
  } catch {
    return null;
  }
}

function determineEventType(description: string): string {
  const lowerDesc = description.toLowerCase();
  if (lowerDesc.includes('audiencia')) return 'AUDIENCIA';
  if (lowerDesc.includes('sentencia')) return 'SENTENCIA';
  if (lowerDesc.includes('auto')) return 'AUTO';
  if (lowerDesc.includes('notifica')) return 'NOTIFICACION';
  if (lowerDesc.includes('traslado')) return 'TRASLADO';
  if (lowerDesc.includes('memorial')) return 'MEMORIAL';
  return 'ACTUACION';
}

async function addStep(supabase: any, runId: string, stepName: string, ok: boolean, detail?: string, meta?: Record<string, unknown>) {
  try {
    await supabase.from('crawler_run_steps').insert({
      run_id: runId,
      step_name: stepName,
      ok,
      detail: detail?.substring(0, 500),
      meta: meta || {},
    });
  } catch (e) {
    console.error('Failed to add step:', e);
  }
}

async function finalizeRun(supabase: any, runId: string, status: string, startTime: number, httpStatus?: number, errorCode?: string, errorMessage?: string, responseMeta?: Record<string, unknown>, debugExcerpt?: string) {
  await supabase.from('crawler_runs').update({
    finished_at: new Date().toISOString(),
    status,
    http_status: httpStatus,
    error_code: errorCode,
    error_message: errorMessage?.substring(0, 1000),
    duration_ms: Date.now() - startTime,
    response_meta: responseMeta || {},
    debug_excerpt: debugExcerpt?.substring(0, 10000),
  }).eq('id', runId);
}

// CPNU Search URL - The CPNU SPA requires JavaScript execution to show results
// We need to scrape with longer wait time to allow JS to render
const CPNU_SEARCH_URL = (radicado: string) => 
  `https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion`;

// Firecrawl scraping with enhanced options for SPAs
async function scrapeWithFirecrawl(url: string, waitTime: number = 5000): Promise<{ 
  success: boolean; 
  markdown?: string; 
  html?: string; 
  error?: string; 
  statusCode?: number 
}> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) {
    return { success: false, error: 'FIRECRAWL_API_KEY not configured' };
  }

  try {
    console.log('Firecrawl: Scraping URL:', url, 'with waitFor:', waitTime);
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        url, 
        formats: ['markdown', 'html'],
        waitFor: waitTime,
        onlyMainContent: false, // Include all content for better parsing
      }),
    });

    const statusCode = response.status;
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Firecrawl error:', statusCode, errorText.substring(0, 500));
      return { success: false, error: `Firecrawl HTTP ${statusCode}`, statusCode };
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || '';
    const html = data.data?.html || data.html || '';
    console.log('Firecrawl success, markdown length:', markdown.length, 'html length:', html.length);
    return { success: true, markdown, html, statusCode };
  } catch (error) {
    console.error('Firecrawl fetch error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Parse search results from markdown AND HTML - improved parsing
function parseSearchResults(markdown: string, html: string, radicado: string): { results: SearchResult[]; parseMethod: string } {
  const results: SearchResult[] = [];
  
  console.log('Parsing content, markdown length:', markdown.length, 'html length:', html.length);
  console.log('Looking for radicado:', radicado);
  
  // First try: Check if radicado appears in the content
  const contentToCheck = markdown + html;
  
  if (contentToCheck.includes(radicado)) {
    console.log('Found radicado in content!');
    
    // Look for idProceso in the content (it's usually in links or data attributes)
    const idMatches = contentToCheck.match(/idProceso[=:"]?\s*(\d+)/gi);
    console.log('idProceso matches:', idMatches);
    
    // Look for despacho patterns
    const despachoMatch = contentToCheck.match(/(Juzgado|Tribunal|Corte)[^\n\|<]*/i);
    
    let idProceso: number | undefined;
    if (idMatches && idMatches.length > 0) {
      const numMatch = idMatches[0].match(/(\d+)/);
      if (numMatch) {
        idProceso = parseInt(numMatch[1], 10);
      }
    }
    
    results.push({
      radicado,
      despacho: despachoMatch ? despachoMatch[0].trim() : 'Despacho encontrado',
      id_proceso: idProceso,
      detail_url: idProceso 
        ? `https://consultaprocesos.ramajudicial.gov.co/Procesos/Detalle?idProceso=${idProceso}` 
        : undefined,
    });
    return { results, parseMethod: 'CONTENT_MATCH' };
  }
  
  // Check if this is just the search form (not results)
  const isSearchForm = markdown.includes('Número de Radicación') && 
                       markdown.includes('0 / 23') && 
                       !markdown.includes('Código');
  
  if (isSearchForm) {
    console.log('Detected empty search form - CPNU SPA requires form submission');
    return { results: [], parseMethod: 'SPA_FORM_NOT_SUBMITTED' };
  }
  
  console.log('Radicado NOT found in content');
  console.log('Markdown sample:', markdown.substring(0, 500));
  return { results: [], parseMethod: 'NO_MATCH' };
}

// Parse events from detail page markdown
function parseEventsFromMarkdown(markdown: string, sourceUrl: string): ProcessEvent[] {
  const events: ProcessEvent[] = [];
  const lines = markdown.split('\n');
  
  for (const line of lines) {
    // Look for date patterns followed by actuacion text
    const dateMatch = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    if (dateMatch && line.length > 20) {
      const eventDate = parseColombianDate(dateMatch[1]);
      const description = line.replace(dateMatch[0], '').trim();
      if (description.length > 10) {
        events.push({
          source: 'CPNU',
          event_type: determineEventType(description),
          event_date: eventDate,
          title: description.substring(0, 100),
          description,
          attachments: [],
          source_url: sourceUrl,
          hash_fingerprint: computeFingerprint('CPNU', eventDate, description, sourceUrl),
        });
      }
    }
  }
  
  return events;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let runId: string | null = null;

  try {
    const { action, radicado, owner_id } = await req.json();
    
    if (!action || !owner_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields: action, owner_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create crawler run
    const { data: runData } = await supabase.from('crawler_runs').insert({
      owner_id,
      radicado: radicado || 'N/A',
      adapter: 'CPNU',
      status: 'RUNNING',
      request_meta: { action, radicado },
    }).select('id').single();
    
    runId = runData?.id;
    console.log('CPNU: Created crawler run:', runId);

    if (action === 'search') {
      if (!radicado) {
        if (runId) await finalizeRun(supabase, runId, 'ERROR', startTime, undefined, 'MISSING_PARAM', 'Radicado is required');
        return new Response(JSON.stringify({ ok: false, error: 'Radicado is required', run_id: runId }), 
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const radicadoStr = String(radicado).trim();
      if (runId) await addStep(supabase, runId, 'VALIDATE', true, `Radicado: ${radicadoStr}`);

      // Scrape CPNU with Firecrawl
      const searchUrl = CPNU_SEARCH_URL(radicadoStr);
      if (runId) await addStep(supabase, runId, 'FETCH', true, 'Scraping CPNU via Firecrawl', { url: searchUrl });
      
      const scrapeResult = await scrapeWithFirecrawl(searchUrl);
      
      if (!scrapeResult.success) {
        if (runId) await addStep(supabase, runId, 'FETCH', false, scrapeResult.error);
        if (runId) await finalizeRun(supabase, runId, 'ERROR', startTime, scrapeResult.statusCode, 'SCRAPE_ERROR', scrapeResult.error);
        return new Response(JSON.stringify({ ok: false, error: scrapeResult.error, run_id: runId, source: 'CPNU' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (runId) await addStep(supabase, runId, 'PARSE', true, `Markdown length: ${scrapeResult.markdown?.length || 0}`);
      
      const parseResult = parseSearchResults(scrapeResult.markdown || '', scrapeResult.html || '', radicadoStr);
      const results = parseResult.results;
      
      // If we found results with idProceso, scrape detail page for events
      let events: ProcessEvent[] = [];
      if (results.length > 0 && results[0].detail_url) {
        if (runId) await addStep(supabase, runId, 'FETCH', true, 'Scraping detail page');
        const detailResult = await scrapeWithFirecrawl(results[0].detail_url);
        if (detailResult.success) {
          events = parseEventsFromMarkdown(detailResult.markdown || '', results[0].detail_url);
          if (runId) await addStep(supabase, runId, 'NORMALIZE', true, `Found ${events.length} events`);
        }
      }

      const status = results.length > 0 ? 'SUCCESS' : 'EMPTY';
      let whyEmpty: string | undefined;
      if (results.length === 0) {
        if (parseResult.parseMethod === 'SPA_FORM_NOT_SUBMITTED') {
          whyEmpty = 'SPA_REQUIRES_INTERACTION';
        } else if (scrapeResult.markdown?.includes('No se encontraron')) {
          whyEmpty = 'EMPTY_NO_MATCH';
        } else {
          whyEmpty = 'EMPTY_PARSE_ZERO_ITEMS';
        }
      }
      
      if (runId) await finalizeRun(supabase, runId, status, startTime, 200, undefined, undefined, 
        { results_count: results.length, events_count: events.length, why_empty: whyEmpty, parse_method: parseResult.parseMethod },
        scrapeResult.markdown?.substring(0, 10000));

      return new Response(JSON.stringify({
        ok: true,
        success: true,
        source: 'CPNU',
        run_id: runId,
        results,
        events,
        search_url: searchUrl,
        why_empty: whyEmpty,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: false, error: `Unknown action: ${action}`, run_id: runId }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('CPNU adapter error:', error);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      run_id: runId,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
