import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting scheduled crawler run...');

    // Get all filings with crawler enabled and a radicado
    const { data: filings, error: filingsError } = await supabase
      .from('filings')
      .select('id, radicado, owner_id, last_crawled_at')
      .eq('crawler_enabled', true)
      .not('radicado', 'is', null)
      .not('status', 'eq', 'CLOSED');

    if (filingsError) {
      console.error('Error fetching filings:', filingsError);
      return new Response(
        JSON.stringify({ success: false, error: filingsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${filings?.length || 0} filings to crawl`);

    const results = [];
    
    for (const filing of filings || []) {
      // Skip if crawled in the last 20 hours (to avoid rate limiting)
      if (filing.last_crawled_at) {
        const lastCrawl = new Date(filing.last_crawled_at);
        const hoursSinceCrawl = (Date.now() - lastCrawl.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCrawl < 20) {
          console.log(`Skipping filing ${filing.id} - crawled ${hoursSinceCrawl.toFixed(1)} hours ago`);
          continue;
        }
      }

      try {
        // Call the crawl-rama-judicial function
        const crawlResponse = await fetch(`${supabaseUrl}/functions/v1/crawl-rama-judicial`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filing_id: filing.id,
            radicado: filing.radicado,
            owner_id: filing.owner_id,
            manual_trigger: false
          }),
        });

        const crawlResult = await crawlResponse.json();
        results.push({
          filing_id: filing.id,
          success: crawlResult.success,
          new_events: crawlResult.new_events || 0,
          new_hearings: crawlResult.new_hearings || 0
        });

        console.log(`Crawled filing ${filing.id}: ${crawlResult.new_events || 0} new events`);

        // Small delay between requests to be nice to the server
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`Error crawling filing ${filing.id}:`, error);
        results.push({
          filing_id: filing.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const totalNewEvents = results.reduce((sum, r) => sum + (r.new_events || 0), 0);
    const totalNewHearings = results.reduce((sum, r) => sum + (r.new_hearings || 0), 0);

    console.log(`Scheduled crawler complete: ${totalNewEvents} new events, ${totalNewHearings} new hearings`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        filings_processed: results.length,
        total_new_events: totalNewEvents,
        total_new_hearings: totalNewHearings,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in scheduled-crawler:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
