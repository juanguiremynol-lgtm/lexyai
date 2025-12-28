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

// Parse estados electrónicos from portal histórico
function parseEstadosHistorico(markdown: string, html: string, sourceUrl: string, baseUrl: string): ProcessEvent[] {
  const events: ProcessEvent[] = [];
  
  // Look for year pages and estado entries
  const estadoPattern = /estado[^<\n]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})[^<\n]*?([^<\n]+)/gi;
  const matches = markdown.matchAll(estadoPattern);
  
  for (const match of matches) {
    const dateStr = match[1];
    const description = match[2]?.trim();
    
    if (description && description.length > 3) {
      const eventDate = parseColombianDate(dateStr);
      const fingerprint = computeFingerprint('HISTORICO', eventDate, description, sourceUrl);
      
      events.push({
        source: 'HISTORICO',
        event_type: 'ESTADO_ELECTRONICO',
        event_date: eventDate,
        title: `Estado Histórico - ${dateStr}`,
        description: description,
        attachments: [],
        source_url: sourceUrl,
        hash_fingerprint: fingerprint,
        raw_data: { original_text: match[0] }
      });
    }
  }
  
  // Parse HTML for PDF links and table entries
  const linkPattern = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  const tableRowPattern = /<tr[^>]*>(.*?)<\/tr>/gis;
  const cellPattern = /<td[^>]*>(.*?)<\/td>/gis;
  
  const rowMatches = html.matchAll(tableRowPattern);
  
  for (const row of rowMatches) {
    const cells = [...row[1].matchAll(cellPattern)].map(c => 
      c[1].replace(/<[^>]*>/g, '').trim()
    );
    
    // Look for date-like content in cells
    const dateCell = cells.find(c => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(c));
    const descCell = cells.find(c => c.length > 5 && c !== dateCell);
    
    if (dateCell && descCell && !events.some(e => e.description === descCell)) {
      const eventDate = parseColombianDate(dateCell);
      const fingerprint = computeFingerprint('HISTORICO', eventDate, descCell, sourceUrl);
      
      // Extract PDF links
      const attachments: Array<{ label: string; url: string }> = [];
      const links = [...row[1].matchAll(linkPattern)];
      for (const link of links) {
        if (link[1] && (link[1].includes('.pdf') || link[1].includes('documento'))) {
          const url = link[1].startsWith('http') ? link[1] : `${baseUrl}${link[1]}`;
          attachments.push({
            label: link[2]?.replace(/<[^>]*>/g, '').trim() || 'Documento',
            url,
          });
        }
      }
      
      events.push({
        source: 'HISTORICO',
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
  
  // Also look for direct PDF links not in tables
  const allLinks = [...html.matchAll(linkPattern)];
  for (const link of allLinks) {
    const url = link[1];
    const text = link[2]?.replace(/<[^>]*>/g, '').trim();
    
    if (url && text && (url.includes('.pdf') || text.toLowerCase().includes('estado'))) {
      const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
      const eventDate = dateMatch ? parseColombianDate(dateMatch[1]) : null;
      
      if (!events.some(e => e.description === text)) {
        const fingerprint = computeFingerprint('HISTORICO', eventDate, text, sourceUrl);
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        
        events.push({
          source: 'HISTORICO',
          event_type: 'ESTADO_ELECTRONICO',
          event_date: eventDate,
          title: text.substring(0, 100),
          description: text,
          attachments: [{ label: 'Documento PDF', url: fullUrl }],
          source_url: sourceUrl,
          hash_fingerprint: fingerprint,
          raw_data: { link_url: url, link_text: text }
        });
      }
    }
  }
  
  return events;
}

// Parse year pages from despacho microsite
function parseYearPages(markdown: string, html: string, baseUrl: string): Array<{
  year: number;
  url: string;
}> {
  const years: Array<{ year: number; url: string }> = [];
  
  // Look for year links (2020, 2021, 2022, 2023, 2024, etc.)
  const yearPattern = /<a[^>]*href="([^"]*)"[^>]*>\s*(20\d{2})\s*<\/a>/gi;
  const matches = html.matchAll(yearPattern);
  
  for (const match of matches) {
    const url = match[1];
    const year = parseInt(match[2]);
    
    if (url && year) {
      years.push({
        year,
        url: url.startsWith('http') ? url : `${baseUrl}${url}`,
      });
    }
  }
  
  return years.sort((a, b) => b.year - a.year); // Most recent first
}

// Helper to extract and validate user from JWT
async function getAuthenticatedUser(req: Request, supabaseUrl: string, supabaseAnonKey: string): Promise<{ user_id: string } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }
  
  return { user_id: user.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Authenticate user from JWT token
    const authUser = await getAuthenticatedUser(req, supabaseUrl, supabaseAnonKey);
    if (!authUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized - valid authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Use authenticated user's ID instead of trusting request body
    const owner_id = authUser.user_id;
    
    const { action, despacho_slug, year, monitored_process_id, include_screenshot } = await req.json();
    
    if (!action) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required field: action' }),
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const baseUrl = 'https://portalhistorico.ramajudicial.gov.co';
    
    if (action === 'get_despacho') {
      if (!despacho_slug) {
        return new Response(
          JSON.stringify({ success: false, error: 'despacho_slug is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const despachoUrl = `${baseUrl}/web/${despacho_slug}`;
      console.log('HISTORICO: Getting despacho page:', despachoUrl);
      
      const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: despachoUrl,
          formats: ['markdown', 'html'],
          onlyMainContent: false,
          waitFor: 5000,
        }),
      });

      const scrapeData = await scrapeResponse.json();
      
      if (!scrapeResponse.ok || !scrapeData.success) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: scrapeData.error || 'Failed to access despacho page',
            source: 'HISTORICO'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = scrapeData.data?.markdown || '';
      const html = scrapeData.data?.html || '';
      
      const yearPages = parseYearPages(markdown, html, baseUrl);
      
      return new Response(
        JSON.stringify({
          success: true,
          source: 'HISTORICO',
          despacho_slug,
          year_pages: yearPages,
          despacho_url: despachoUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (action === 'crawl_estados') {
      if (!despacho_slug) {
        return new Response(
          JSON.stringify({ success: false, error: 'despacho_slug is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Construct URL for estados electrónicos
      let estadosUrl = `${baseUrl}/web/${despacho_slug}`;
      if (year) {
        estadosUrl = `${estadosUrl}/estados-electronicos/${year}`;
      } else {
        estadosUrl = `${estadosUrl}/estados-electronicos`;
      }
      
      console.log('HISTORICO: Crawling estados:', estadosUrl);
      
      const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: estadosUrl,
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
            error: scrapeData.error || 'Failed to crawl estados',
            source: 'HISTORICO'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = scrapeData.data?.markdown || '';
      const html = scrapeData.data?.html || '';
      const screenshot = scrapeData.data?.screenshot;
      
      const events = parseEstadosHistorico(markdown, html, estadosUrl, baseUrl);
      
      // Get existing fingerprints
      let existingFingerprints: Set<string> = new Set();
      if (monitored_process_id) {
        const { data: existingEvents } = await supabase
          .from('process_events')
          .select('hash_fingerprint')
          .eq('monitored_process_id', monitored_process_id)
          .eq('source', 'HISTORICO');
        
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
        
        // Store evidence snapshot
        if (screenshot || newEvents.length > 0) {
          await supabase
            .from('evidence_snapshots')
            .insert({
              owner_id,
              monitored_process_id,
              source_url: estadosUrl,
              raw_markdown: markdown.substring(0, 50000),
              raw_html: html.substring(0, 100000),
            });
        }
        
        // Update timestamps
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
            message: `HISTÓRICO: ${newEvents.length} nuevo(s) estado(s) encontrado(s) en ${despacho_slug}`,
            severity: 'INFO'
          });
        }
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          source: 'HISTORICO',
          events_found: events.length,
          new_events: newEvents.length,
          events: newEvents,
          screenshot: include_screenshot ? screenshot : undefined,
          estados_url: estadosUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in adapter-historico:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage, source: 'HISTORICO' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
