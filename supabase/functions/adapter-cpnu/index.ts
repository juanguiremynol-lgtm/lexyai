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

// Parse Colombian date format (DD/MM/YYYY or DD-MM-YYYY)
function parseColombianDate(dateStr: string): string | null {
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

// Determine event type from description
function determineEventType(description: string): string {
  const lowerDesc = description.toLowerCase();
  
  if (lowerDesc.includes('audiencia')) return 'AUDIENCIA';
  if (lowerDesc.includes('sentencia')) return 'SENTENCIA';
  if (lowerDesc.includes('auto admite') || lowerDesc.includes('auto que admite')) return 'AUTO';
  if (lowerDesc.includes('auto')) return 'AUTO';
  if (lowerDesc.includes('notifica')) return 'NOTIFICACION';
  if (lowerDesc.includes('traslado')) return 'TRASLADO';
  if (lowerDesc.includes('memorial') || lowerDesc.includes('escrito')) return 'MEMORIAL';
  if (lowerDesc.includes('providencia')) return 'PROVIDENCIA';
  if (lowerDesc.includes('estado')) return 'ESTADO_ELECTRONICO';
  
  return 'ACTUACION';
}

// Parse search results from CPNU
function parseSearchResults(markdown: string, html: string, baseUrl: string): SearchResult[] {
  const results: SearchResult[] = [];
  
  // Look for process cards/rows in the HTML
  const processPattern = /(\d{23})\s*[|\-–]\s*([^|\-–\n]+?)(?:\s*[|\-–]\s*([^|\-–\n]+))?/gi;
  const matches = markdown.matchAll(processPattern);
  
  for (const match of matches) {
    const radicado = match[1];
    const despacho = match[2]?.trim() || '';
    
    if (radicado && despacho) {
      results.push({
        radicado,
        despacho,
        detail_url: `${baseUrl}/Procesos/Detalle?idProceso=${radicado}`,
      });
    }
  }
  
  // Also try to find in table format
  const rowPattern = /<tr[^>]*>(.*?)<\/tr>/gis;
  const cellPattern = /<td[^>]*>(.*?)<\/td>/gis;
  const rowMatches = html.matchAll(rowPattern);
  
  for (const row of rowMatches) {
    const cells = [...row[1].matchAll(cellPattern)].map(c => 
      c[1].replace(/<[^>]*>/g, '').trim()
    );
    
    // Look for 23-digit radicado in cells
    const radicadoCell = cells.find(c => /^\d{23}$/.test(c.replace(/\s/g, '')));
    if (radicadoCell && cells.length >= 2) {
      const radicado = radicadoCell.replace(/\s/g, '');
      const despachoCell = cells.find(c => c.length > 5 && c !== radicadoCell);
      
      if (!results.some(r => r.radicado === radicado)) {
        results.push({
          radicado,
          despacho: despachoCell || '',
          detail_url: `${baseUrl}/Procesos/Detalle?idProceso=${radicado}`,
        });
      }
    }
  }
  
  return results;
}

// Parse actuaciones/events from CPNU detail page
function parseActuaciones(markdown: string, html: string, sourceUrl: string): ProcessEvent[] {
  const events: ProcessEvent[] = [];
  
  // Look for actuaciones table patterns
  const actuacionPattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[|\-–]\s*(.*?)(?:\n|$)/gi;
  const matches = markdown.matchAll(actuacionPattern);
  
  for (const match of matches) {
    const dateStr = match[1];
    const description = match[2]?.trim();
    
    if (description && description.length > 5) {
      const eventDate = parseColombianDate(dateStr);
      const eventType = determineEventType(description);
      const fingerprint = computeFingerprint('CPNU', eventDate, description, sourceUrl);
      
      events.push({
        source: 'CPNU',
        event_type: eventType,
        event_date: eventDate,
        title: description.substring(0, 100),
        description: description,
        attachments: [],
        source_url: sourceUrl,
        hash_fingerprint: fingerprint,
        raw_data: { original_text: match[0] }
      });
    }
  }
  
  // Parse HTML tables more thoroughly
  const rowPattern = /<tr[^>]*>(.*?)<\/tr>/gis;
  const cellPattern = /<td[^>]*>(.*?)<\/td>/gis;
  const linkPattern = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  const rowMatches = html.matchAll(rowPattern);
  
  for (const row of rowMatches) {
    const cells = [...row[1].matchAll(cellPattern)].map(c => 
      c[1].replace(/<[^>]*>/g, '').trim()
    );
    
    if (cells.length >= 2) {
      const dateCell = cells.find(c => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(c));
      const descCell = cells.find(c => c.length > 10 && !/^\d+$/.test(c) && c !== dateCell);
      
      if (dateCell && descCell && !events.some(e => e.description === descCell)) {
        const eventDate = parseColombianDate(dateCell);
        const eventType = determineEventType(descCell);
        const fingerprint = computeFingerprint('CPNU', eventDate, descCell, sourceUrl);
        
        // Extract any links/attachments
        const attachments: Array<{ label: string; url: string }> = [];
        const links = [...row[1].matchAll(linkPattern)];
        for (const link of links) {
          if (link[1] && link[2]) {
            attachments.push({
              label: link[2].replace(/<[^>]*>/g, '').trim() || 'Documento',
              url: link[1].startsWith('http') ? link[1] : `https://consultaprocesos.ramajudicial.gov.co${link[1]}`,
            });
          }
        }
        
        events.push({
          source: 'CPNU',
          event_type: eventType,
          event_date: eventDate,
          title: descCell.substring(0, 100),
          description: descCell,
          attachments,
          source_url: sourceUrl,
          hash_fingerprint: fingerprint,
          raw_data: { cells }
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

  try {
    const { action, radicado, owner_id, monitored_process_id, include_screenshot } = await req.json();
    
    if (!action || !owner_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: action, owner_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlApiKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const baseUrl = 'https://consultaprocesos.ramajudicial.gov.co';
    
    if (action === 'search') {
      if (!radicado) {
        return new Response(
          JSON.stringify({ success: false, error: 'Radicado is required for search' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const searchUrl = `${baseUrl}/Procesos/NumeroRadicacion?numero=${radicado}`;
      console.log('CPNU: Searching URL:', searchUrl);
      
      const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: searchUrl,
          formats: ['markdown', 'html'],
          onlyMainContent: true,
          waitFor: 5000,
        }),
      });

      const scrapeData = await scrapeResponse.json();
      
      if (!scrapeResponse.ok || !scrapeData.success) {
        console.error('Firecrawl error:', scrapeData);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: scrapeData.error || 'Failed to search CPNU',
            source: 'CPNU'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = scrapeData.data?.markdown || '';
      const html = scrapeData.data?.html || '';
      
      const results = parseSearchResults(markdown, html, baseUrl);
      
      // If we have a direct match (exact radicado), also fetch actuaciones
      if (results.length === 1 && results[0].radicado === radicado) {
        const detailUrl = `${baseUrl}/Procesos/Detalle?idProceso=${radicado}`;
        
        const detailResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: detailUrl,
            formats: ['markdown', 'html', ...(include_screenshot ? ['screenshot'] : [])],
            onlyMainContent: true,
            waitFor: 5000,
          }),
        });
        
        const detailData = await detailResponse.json();
        
        if (detailResponse.ok && detailData.success) {
          const detailMarkdown = detailData.data?.markdown || '';
          const detailHtml = detailData.data?.html || '';
          const screenshot = detailData.data?.screenshot;
          
          const events = parseActuaciones(detailMarkdown, detailHtml, detailUrl);
          
          return new Response(
            JSON.stringify({
              success: true,
              source: 'CPNU',
              results,
              events,
              screenshot,
              search_url: searchUrl,
              detail_url: detailUrl
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          source: 'CPNU',
          results,
          events: [],
          search_url: searchUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (action === 'crawl') {
      if (!radicado) {
        return new Response(
          JSON.stringify({ success: false, error: 'Radicado is required for crawl' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const detailUrl = `${baseUrl}/Procesos/Detalle?idProceso=${radicado}`;
      console.log('CPNU: Crawling detail URL:', detailUrl);
      
      const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: detailUrl,
          formats: ['markdown', 'html', ...(include_screenshot ? ['screenshot'] : [])],
          onlyMainContent: true,
          waitFor: 5000,
        }),
      });

      const scrapeData = await scrapeResponse.json();
      
      if (!scrapeResponse.ok || !scrapeData.success) {
        console.error('Firecrawl error:', scrapeData);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: scrapeData.error || 'Failed to crawl CPNU detail',
            source: 'CPNU'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = scrapeData.data?.markdown || '';
      const html = scrapeData.data?.html || '';
      const screenshot = scrapeData.data?.screenshot;
      
      const events = parseActuaciones(markdown, html, detailUrl);
      
      // Get existing fingerprints to detect new events
      let existingFingerprints: Set<string> = new Set();
      if (monitored_process_id) {
        const { data: existingEvents } = await supabase
          .from('process_events')
          .select('hash_fingerprint')
          .eq('monitored_process_id', monitored_process_id)
          .eq('source', 'CPNU');
        
        existingFingerprints = new Set(existingEvents?.map(e => e.hash_fingerprint).filter(Boolean) || []);
      }
      
      const newEvents = events.filter(e => !existingFingerprints.has(e.hash_fingerprint));
      
      // Insert new events
      if (newEvents.length > 0 && monitored_process_id) {
        const { error: insertError } = await supabase
          .from('process_events')
          .insert(newEvents.map(e => ({
            owner_id,
            monitored_process_id,
            source: e.source,
            event_type: e.event_type,
            event_date: e.event_date,
            title: e.title,
            description: e.description,
            detail: e.detail,
            attachments: e.attachments,
            source_url: e.source_url,
            hash_fingerprint: e.hash_fingerprint,
            raw_data: e.raw_data,
          })));
        
        if (insertError) {
          console.error('Error inserting events:', insertError);
        }
        
        // Store evidence snapshot if screenshot available
        if (screenshot && newEvents.length > 0) {
          await supabase
            .from('evidence_snapshots')
            .insert({
              owner_id,
              monitored_process_id,
              source_url: detailUrl,
              raw_markdown: markdown.substring(0, 50000), // Limit size
              raw_html: html.substring(0, 100000),
            });
        }
        
        // Update monitored_process timestamps
        await supabase
          .from('monitored_processes')
          .update({
            last_checked_at: new Date().toISOString(),
            last_change_at: new Date().toISOString(),
          })
          .eq('id', monitored_process_id);
        
        // Create alert for new events
        if (newEvents.length > 0) {
          await supabase.from('alerts').insert({
            owner_id,
            message: `CPNU: ${newEvents.length} nueva(s) actuación(es) en proceso ${radicado}`,
            severity: 'INFO'
          });
        }
      } else if (monitored_process_id) {
        // Just update last_checked_at
        await supabase
          .from('monitored_processes')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', monitored_process_id);
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          source: 'CPNU',
          events_found: events.length,
          new_events: newEvents.length,
          events: newEvents,
          screenshot: include_screenshot ? screenshot : undefined,
          detail_url: detailUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in adapter-cpnu:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage, source: 'CPNU' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
