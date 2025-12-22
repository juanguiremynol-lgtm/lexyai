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

// Parse estados electrónicos from publicaciones portal
function parseEstadosElectronicos(markdown: string, html: string, sourceUrl: string): ProcessEvent[] {
  const events: ProcessEvent[] = [];
  const baseUrl = 'https://publicacionesprocesales.ramajudicial.gov.co';
  
  // Look for publication entries
  const publicationPattern = /(?:estado|notificación|publicación)[^<\n]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})[^<\n]*?([^<\n]+)/gi;
  const matches = markdown.matchAll(publicationPattern);
  
  for (const match of matches) {
    const dateStr = match[1];
    const description = match[2]?.trim();
    
    if (description && description.length > 5) {
      const eventDate = parseColombianDate(dateStr);
      const fingerprint = computeFingerprint('PUBLICACIONES', eventDate, description, sourceUrl);
      
      events.push({
        source: 'PUBLICACIONES',
        event_type: 'ESTADO_ELECTRONICO',
        event_date: eventDate,
        title: `Estado Electrónico - ${dateStr}`,
        description: description,
        attachments: [],
        source_url: sourceUrl,
        hash_fingerprint: fingerprint,
        raw_data: { original_text: match[0] }
      });
    }
  }
  
  // Parse HTML for links to documents/PDFs
  const linkPattern = /<a[^>]*href="([^"]*\.pdf[^"]*)"[^>]*>(.*?)<\/a>/gi;
  const tableRowPattern = /<tr[^>]*>(.*?)<\/tr>/gis;
  const cellPattern = /<td[^>]*>(.*?)<\/td>/gis;
  
  const rowMatches = html.matchAll(tableRowPattern);
  
  for (const row of rowMatches) {
    const cells = [...row[1].matchAll(cellPattern)].map(c => 
      c[1].replace(/<[^>]*>/g, '').trim()
    );
    
    // Look for date and description in cells
    const dateCell = cells.find(c => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(c));
    const descCell = cells.find(c => 
      c.length > 10 && 
      c !== dateCell && 
      (c.toLowerCase().includes('estado') || 
       c.toLowerCase().includes('notificación') ||
       c.toLowerCase().includes('publicación'))
    );
    
    if (dateCell && descCell && !events.some(e => e.description === descCell)) {
      const eventDate = parseColombianDate(dateCell);
      const fingerprint = computeFingerprint('PUBLICACIONES', eventDate, descCell, sourceUrl);
      
      // Extract PDF links from the row
      const attachments: Array<{ label: string; url: string }> = [];
      const links = [...row[1].matchAll(linkPattern)];
      for (const link of links) {
        if (link[1]) {
          const url = link[1].startsWith('http') ? link[1] : `${baseUrl}${link[1]}`;
          attachments.push({
            label: link[2]?.replace(/<[^>]*>/g, '').trim() || 'Documento PDF',
            url,
          });
        }
      }
      
      events.push({
        source: 'PUBLICACIONES',
        event_type: 'ESTADO_ELECTRONICO',
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
  
  return events;
}

// Parse despacho directory for historical lookup
function parseDespachoDirectory(markdown: string, html: string): Array<{
  nombre: string;
  slug: string;
  url: string;
}> {
  const despachos: Array<{ nombre: string; slug: string; url: string }> = [];
  
  // Look for links to portalhistorico
  const linkPattern = /href="(https?:\/\/portalhistorico\.ramajudicial\.gov\.co\/web\/[^"]+)"[^>]*>([^<]+)/gi;
  const matches = html.matchAll(linkPattern);
  
  for (const match of matches) {
    const url = match[1];
    const nombre = match[2]?.trim();
    
    if (url && nombre) {
      const slugMatch = url.match(/\/web\/([^\/]+)/);
      if (slugMatch) {
        despachos.push({
          nombre,
          slug: slugMatch[1],
          url,
        });
      }
    }
  }
  
  return despachos;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, departamento, municipio, despacho, fecha_desde, fecha_hasta, owner_id, monitored_process_id, include_screenshot } = await req.json();
    
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

    const baseUrl = 'https://publicacionesprocesales.ramajudicial.gov.co';
    
    if (action === 'search') {
      // Search for estados electrónicos by filters
      const searchUrl = `${baseUrl}/web/publicaciones-procesales/publicaciones-procesales`;
      console.log('PUBLICACIONES: Searching URL:', searchUrl);
      
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
            error: scrapeData.error || 'Failed to access Publicaciones portal',
            source: 'PUBLICACIONES'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = scrapeData.data?.markdown || '';
      const html = scrapeData.data?.html || '';
      
      const events = parseEstadosElectronicos(markdown, html, searchUrl);
      
      return new Response(
        JSON.stringify({
          success: true,
          source: 'PUBLICACIONES',
          events,
          search_url: searchUrl,
          message: 'Portal de publicaciones escaneado. Use filtros específicos para resultados más precisos.'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (action === 'get_directory') {
      // Get the consulta histórica directory
      const directoryUrl = `${baseUrl}/web/publicaciones-procesales/consulta-historica`;
      console.log('PUBLICACIONES: Getting directory from:', directoryUrl);
      
      const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: directoryUrl,
          formats: ['markdown', 'html'],
          onlyMainContent: false, // Need full page for directory links
          waitFor: 5000,
        }),
      });

      const scrapeData = await scrapeResponse.json();
      
      if (!scrapeResponse.ok || !scrapeData.success) {
        console.error('Firecrawl error:', scrapeData);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: scrapeData.error || 'Failed to access directory',
            source: 'PUBLICACIONES'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = scrapeData.data?.markdown || '';
      const html = scrapeData.data?.html || '';
      
      const despachos = parseDespachoDirectory(markdown, html);
      
      return new Response(
        JSON.stringify({
          success: true,
          source: 'PUBLICACIONES',
          despachos,
          directory_url: directoryUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (action === 'crawl' && despacho) {
      // Crawl specific despacho for estados
      const despachoUrl = `${baseUrl}/web/publicaciones-procesales/publicaciones-procesales?despacho=${encodeURIComponent(despacho)}`;
      console.log('PUBLICACIONES: Crawling despacho:', despachoUrl);
      
      const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: despachoUrl,
          formats: ['markdown', 'html', ...(include_screenshot ? ['screenshot'] : [])],
          onlyMainContent: true,
          waitFor: 5000,
        }),
      });

      const scrapeData = await scrapeResponse.json();
      
      if (!scrapeResponse.ok || !scrapeData.success) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: scrapeData.error || 'Failed to crawl despacho',
            source: 'PUBLICACIONES'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = scrapeData.data?.markdown || '';
      const html = scrapeData.data?.html || '';
      const screenshot = scrapeData.data?.screenshot;
      
      const events = parseEstadosElectronicos(markdown, html, despachoUrl);
      
      // Get existing fingerprints
      let existingFingerprints: Set<string> = new Set();
      if (monitored_process_id) {
        const { data: existingEvents } = await supabase
          .from('process_events')
          .select('hash_fingerprint')
          .eq('monitored_process_id', monitored_process_id)
          .eq('source', 'PUBLICACIONES');
        
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
        
        // Update monitored_process timestamps
        await supabase
          .from('monitored_processes')
          .update({
            last_checked_at: new Date().toISOString(),
            last_change_at: new Date().toISOString(),
          })
          .eq('id', monitored_process_id);
        
        // Create alert
        if (newEvents.length > 0) {
          await supabase.from('alerts').insert({
            owner_id,
            message: `PUBLICACIONES: ${newEvents.length} nuevo(s) estado(s) electrónico(s) encontrado(s)`,
            severity: 'INFO'
          });
        }
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          source: 'PUBLICACIONES',
          events_found: events.length,
          new_events: newEvents.length,
          events: newEvents,
          screenshot: include_screenshot ? screenshot : undefined,
          crawl_url: despachoUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in adapter-publicaciones:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage, source: 'PUBLICACIONES' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
