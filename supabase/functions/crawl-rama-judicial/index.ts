import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessEvent {
  event_date: string | null;
  event_type: string;
  description: string;
  raw_data: Record<string, unknown>;
}

interface HearingInfo {
  title: string;
  scheduled_at: string;
  location?: string;
  is_virtual: boolean;
  virtual_link?: string;
}

// Parse radicado to construct Rama Judicial search URL
function buildRamaJudicialUrl(radicado: string): string {
  // Colombian radicado format: 23 digits
  // Format: DDDDD-CC-CCC-AAAA-NNNNN-00
  // Where: D=department, C=court code, A=year, N=case number
  const baseUrl = 'https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion';
  return `${baseUrl}?numero=${radicado}`;
}

// Extract process events from scraped content
function parseProcessEvents(markdown: string, html: string): ProcessEvent[] {
  const events: ProcessEvent[] = [];
  
  // Look for actuaciones/events table patterns
  const actuacionPattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[|\-]\s*(.*?)(?:\n|$)/gi;
  const matches = markdown.matchAll(actuacionPattern);
  
  for (const match of matches) {
    const dateStr = match[1];
    const description = match[2]?.trim();
    
    if (description && description.length > 5) {
      // Determine event type based on keywords
      let eventType = 'ACTUACION';
      const lowerDesc = description.toLowerCase();
      
      if (lowerDesc.includes('audiencia')) eventType = 'AUDIENCIA';
      else if (lowerDesc.includes('auto') || lowerDesc.includes('admite')) eventType = 'AUTO';
      else if (lowerDesc.includes('sentencia')) eventType = 'SENTENCIA';
      else if (lowerDesc.includes('notifica')) eventType = 'NOTIFICACION';
      else if (lowerDesc.includes('traslado')) eventType = 'TRASLADO';
      else if (lowerDesc.includes('memorial') || lowerDesc.includes('escrito')) eventType = 'MEMORIAL';
      
      events.push({
        event_date: parseColombianDate(dateStr),
        event_type: eventType,
        description: description,
        raw_data: { original_text: match[0] }
      });
    }
  }
  
  // Also look for table rows in HTML
  const rowPattern = /<tr[^>]*>(.*?)<\/tr>/gis;
  const cellPattern = /<td[^>]*>(.*?)<\/td>/gis;
  const rowMatches = html.matchAll(rowPattern);
  
  for (const row of rowMatches) {
    const cells = [...row[1].matchAll(cellPattern)].map(c => 
      c[1].replace(/<[^>]*>/g, '').trim()
    );
    
    if (cells.length >= 2) {
      const dateCell = cells.find(c => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(c));
      const descCell = cells.find(c => c.length > 10 && !/^\d+$/.test(c) && c !== dateCell);
      
      if (dateCell && descCell && !events.some(e => e.description === descCell)) {
        events.push({
          event_date: parseColombianDate(dateCell),
          event_type: 'ACTUACION',
          description: descCell,
          raw_data: { cells }
        });
      }
    }
  }
  
  return events;
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

// Extract hearing information from content
function parseHearings(markdown: string, html: string): HearingInfo[] {
  const hearings: HearingInfo[] = [];
  
  // Look for audiencia patterns with future dates
  const audienciaPattern = /audiencia[^.]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})[^.]*?(\d{1,2}:\d{2})?/gi;
  const matches = markdown.matchAll(audienciaPattern);
  
  for (const match of matches) {
    const dateStr = match[1];
    const timeStr = match[2] || '08:00';
    const parsedDate = parseColombianDate(dateStr);
    
    if (parsedDate) {
      const date = new Date(parsedDate);
      const [hours, minutes] = timeStr.split(':').map(Number);
      date.setHours(hours || 8, minutes || 0);
      
      // Only include future hearings
      if (date > new Date()) {
        const isVirtual = /virtual|teams|zoom|meet/i.test(match[0]);
        const linkMatch = match[0].match(/(https?:\/\/[^\s]+)/);
        
        hearings.push({
          title: `Audiencia - ${dateStr}`,
          scheduled_at: date.toISOString(),
          is_virtual: isVirtual,
          virtual_link: linkMatch?.[1]
        });
      }
    }
  }
  
  return hearings;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filing_id, radicado, owner_id, manual_trigger } = await req.json();
    
    if (!filing_id || !radicado || !owner_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
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

    // Build the Rama Judicial URL
    const ramaUrl = buildRamaJudicialUrl(radicado);
    console.log('Crawling Rama Judicial URL:', ramaUrl);

    // Use Firecrawl to scrape the page
    const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: ramaUrl,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        waitFor: 5000, // Wait for dynamic content
      }),
    });

    const scrapeData = await scrapeResponse.json();
    
    if (!scrapeResponse.ok || !scrapeData.success) {
      console.error('Firecrawl error:', scrapeData);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: scrapeData.error || 'Failed to scrape Rama Judicial' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const markdown = scrapeData.data?.markdown || '';
    const html = scrapeData.data?.html || '';
    
    console.log('Scraped content length:', markdown.length);

    // Parse events and hearings
    const events = parseProcessEvents(markdown, html);
    const hearings = parseHearings(markdown, html);
    
    console.log(`Found ${events.length} events and ${hearings.length} hearings`);

    // Get existing events to avoid duplicates
    const { data: existingEvents } = await supabase
      .from('process_events')
      .select('description')
      .eq('filing_id', filing_id);
    
    const existingDescriptions = new Set(existingEvents?.map(e => e.description) || []);
    
    // Insert new events
    const newEvents = events.filter(e => !existingDescriptions.has(e.description));
    
    if (newEvents.length > 0) {
      const { error: insertError } = await supabase
        .from('process_events')
        .insert(newEvents.map(e => ({
          filing_id,
          owner_id,
          event_date: e.event_date,
          event_type: e.event_type,
          description: e.description,
          raw_data: e.raw_data,
          source_url: ramaUrl
        })));
      
      if (insertError) {
        console.error('Error inserting events:', insertError);
      }
      
      // Create alerts for new events
      if (newEvents.length > 0 && !manual_trigger) {
        await supabase.from('alerts').insert({
          filing_id,
          owner_id,
          message: `Se encontraron ${newEvents.length} nuevas actuaciones en el proceso ${radicado}`,
          severity: 'INFO'
        });
      }
    }

    // Get existing hearings to avoid duplicates
    const { data: existingHearings } = await supabase
      .from('hearings')
      .select('scheduled_at')
      .eq('filing_id', filing_id);
    
    const existingHearingDates = new Set(
      existingHearings?.map(h => new Date(h.scheduled_at).toISOString().split('T')[0]) || []
    );
    
    // Insert new hearings
    const newHearings = hearings.filter(h => 
      !existingHearingDates.has(new Date(h.scheduled_at).toISOString().split('T')[0])
    );
    
    if (newHearings.length > 0) {
      const { error: hearingError } = await supabase
        .from('hearings')
        .insert(newHearings.map(h => ({
          filing_id,
          owner_id,
          title: h.title,
          scheduled_at: h.scheduled_at,
          location: h.location,
          is_virtual: h.is_virtual,
          virtual_link: h.virtual_link,
          auto_detected: true
        })));
      
      if (hearingError) {
        console.error('Error inserting hearings:', hearingError);
      }
      
      // Create alerts for new hearings
      for (const hearing of newHearings) {
        await supabase.from('alerts').insert({
          filing_id,
          owner_id,
          message: `Nueva audiencia detectada: ${hearing.title} programada para ${new Date(hearing.scheduled_at).toLocaleDateString('es-CO')}`,
          severity: 'WARN'
        });
      }
    }

    // Update filing with crawl timestamp and URL
    await supabase
      .from('filings')
      .update({ 
        last_crawled_at: new Date().toISOString(),
        rama_judicial_url: ramaUrl,
        crawler_enabled: true
      })
      .eq('id', filing_id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        events_found: events.length,
        new_events: newEvents.length,
        hearings_found: hearings.length,
        new_hearings: newHearings.length,
        url: ramaUrl
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in crawl-rama-judicial:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
