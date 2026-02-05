import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    
    const { action, radicado, despacho, sources, process_id } = await req.json();
    
    if (!action) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Unified search across all sources
    if (action === 'search') {
      if (!radicado) {
        return new Response(
          JSON.stringify({ success: false, error: 'radicado is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Process Monitor: Searching for radicado:', radicado);
      
      const results: Record<string, unknown> = {
        CPNU: null,
        PUBLICACIONES: null,
        HISTORICO: null,
      };
      
      const errors: Record<string, string> = {};
      
      // Call CPNU adapter
      try {
        const cpnuResponse = await fetch(`${supabaseUrl}/functions/v1/adapter-cpnu`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'search',
            radicado,
            owner_id,
            include_screenshot: false,
          }),
        });
        
        const cpnuData = await cpnuResponse.json();
        // Handle new response format with ok/run_id
        if (cpnuData.ok !== false && cpnuData.success !== false) {
          results.CPNU = cpnuData;
        } else {
          // Include the full response so UI can access run_id for diagnostics
          results.CPNU = cpnuData;
          errors.CPNU = cpnuData.error || 'Unknown error';
        }
      } catch (e) {
        errors.CPNU = e instanceof Error ? e.message : 'Request failed';
        console.error('CPNU search error:', e);
      }
      
      // Call Publicaciones adapter (portal scan)
      try {
        const pubResponse = await fetch(`${supabaseUrl}/functions/v1/adapter-publicaciones`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'search',
            owner_id,
          }),
        });
        
        const pubData = await pubResponse.json();
        if (pubData.success) {
          results.PUBLICACIONES = pubData;
        } else {
          errors.PUBLICACIONES = pubData.error || 'Unknown error';
        }
      } catch (e) {
        errors.PUBLICACIONES = e instanceof Error ? e.message : 'Request failed';
        console.error('Publicaciones search error:', e);
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          radicado,
          results,
          errors,
          sources_checked: Object.keys(results).filter(k => results[k] !== null),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Run full crawl for a work item
    if (action === 'crawl') {
      if (!process_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'work_item_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Get the work item
      const { data: process, error: processError } = await supabase
        .from('work_items')
        .select('*')
        .eq('id', process_id)
        .eq('owner_id', owner_id)
        .single();
      
      if (processError || !process) {
        return new Response(
          JSON.stringify({ success: false, error: 'Process not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log('Process Monitor: Running crawl for process:', process.radicado);
      
      const enabledSources = (process.sources_enabled as string[]) || ['CPNU'];
      const results: Record<string, unknown> = {};
      const errors: Record<string, string> = {};
      let totalNewEvents = 0;
      
      // Crawl each enabled source
      if (enabledSources.includes('CPNU')) {
        try {
          const cpnuResponse = await fetch(`${supabaseUrl}/functions/v1/adapter-cpnu`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'crawl',
              radicado: process.radicado,
              owner_id,
              monitored_process_id: process_id,
              include_screenshot: true,
            }),
          });
          
          const cpnuData = await cpnuResponse.json();
          results.CPNU = cpnuData;
          if (cpnuData.success) {
            totalNewEvents += cpnuData.new_events || 0;
          } else {
            errors.CPNU = cpnuData.error;
          }
        } catch (e) {
          errors.CPNU = e instanceof Error ? e.message : 'Request failed';
        }
      }
      
      if (enabledSources.includes('PUBLICACIONES') && process.despacho_name) {
        try {
          const pubResponse = await fetch(`${supabaseUrl}/functions/v1/adapter-publicaciones`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'crawl',
              despacho: process.despacho_name,
              owner_id,
              monitored_process_id: process_id,
              include_screenshot: true,
            }),
          });
          
          const pubData = await pubResponse.json();
          results.PUBLICACIONES = pubData;
          if (pubData.success) {
            totalNewEvents += pubData.new_events || 0;
          } else {
            errors.PUBLICACIONES = pubData.error;
          }
        } catch (e) {
          errors.PUBLICACIONES = e instanceof Error ? e.message : 'Request failed';
        }
      }
      
      // Update last_checked_at
      await supabase
        .from('monitored_processes')
        .update({ 
          last_checked_at: new Date().toISOString(),
          ...(totalNewEvents > 0 ? { last_change_at: new Date().toISOString() } : {})
        })
        .eq('id', process_id);
      
      return new Response(
        JSON.stringify({
          success: true,
          process_id,
          radicado: process.radicado,
          sources_crawled: enabledSources,
          total_new_events: totalNewEvents,
          results,
          errors,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Run scheduled crawl for all work items
    if (action === 'scheduled_crawl') {
      console.log('Process Monitor: Starting scheduled crawl...');
      
      // Get all enabled work items with monitoring enabled
      const { data: processes, error: queryError } = await supabase
        .from('work_items')
        .select('*')
        .eq('monitoring_enabled', true);
      
      if (queryError) {
        return new Response(
          JSON.stringify({ success: false, error: queryError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log(`Found ${processes?.length || 0} processes to crawl`);
      
      const crawlResults = [];
      
      for (const process of processes || []) {
        // Skip if checked recently (within 20 hours)
        if (process.last_checked_at) {
          const hoursSince = (Date.now() - new Date(process.last_checked_at).getTime()) / (1000 * 60 * 60);
          if (hoursSince < 20) {
            console.log(`Skipping ${process.radicado} - checked ${hoursSince.toFixed(1)}h ago`);
            continue;
          }
        }
        
        try {
          const crawlResponse = await fetch(`${supabaseUrl}/functions/v1/process-monitor`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'crawl',
              process_id: process.id,
              owner_id: process.owner_id,
            }),
          });
          
          const crawlData = await crawlResponse.json();
          crawlResults.push({
            process_id: process.id,
            radicado: process.radicado,
            success: crawlData.success,
            new_events: crawlData.total_new_events || 0,
          });
          
          // Small delay between requests
          await new Promise(r => setTimeout(r, 2000));
          
        } catch (e) {
          crawlResults.push({
            process_id: process.id,
            radicado: process.radicado,
            success: false,
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      }
      
      const totalNew = crawlResults.reduce((sum, r) => sum + (r.new_events || 0), 0);
      
      return new Response(
        JSON.stringify({
          success: true,
          processes_checked: crawlResults.length,
          total_new_events: totalNew,
          results: crawlResults,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in process-monitor:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
