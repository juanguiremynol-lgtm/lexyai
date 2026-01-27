import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// External API configuration
const EXTERNAL_API_BASE = 'https://rama-judicial-api.onrender.com';

interface ExternalApiResponse {
  proceso?: {
    'Fecha de Radicación'?: string;
    'Tipo de Proceso'?: string;
    'Despacho'?: string;
    'Demandante'?: string;
    'Demandado'?: string;
    'Clase de Proceso'?: string;
    'Ubicación'?: string;
  };
  actuaciones?: Array<{
    'Fecha de Actuación'?: string;
    'Actuación'?: string;
    'Anotación'?: string;
    'Fecha inicia Término'?: string;
    'Fecha finaliza Término'?: string;
    'Fecha de Registro'?: string;
  }>;
  total_actuaciones?: number;
  ultima_actuacion?: Record<string, unknown>;
  error?: string;
}

interface CrawlResult {
  work_item_id: string;
  success: boolean;
  new_actuaciones: number;
  error?: string;
}

interface WorkItemToCrawl {
  id: string;
  radicado: string;
  owner_id: string;
  workflow_type: string;
  last_crawled_at?: string | null;
  last_checked_at?: string | null;
}

interface ActuacionRow {
  owner_id: string;
  work_item_id: string;
  source: string;
  source_url: string;
  raw_text: string;
  normalized_text: string;
  act_date: string | null;
  act_date_raw: string;
  act_type_guess: string | null;
  confidence: number;
  hash_fingerprint: string;
  attachments: unknown[];
  adapter_name: string;
}

// Normalize text for comparison
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Compute hash for deduplication
function computeHash(workItemId: string, actDate: string | null, normalizedText: string, sourceUrl: string): string {
  const data = `${workItemId}|${actDate || ''}|${normalizedText}|${sourceUrl}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Parse Colombian date formats
function parseColombianDate(dateStr: string): string | null {
  if (!dateStr) return null;
  
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.split('T')[0];
  }

  // DD/MM/YYYY format
  const ddmmyyyy = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, '0');
    const month = ddmmyyyy[2].padStart(2, '0');
    return `${ddmmyyyy[3]}-${month}-${day}`;
  }

  // Spelled format
  const months: Record<string, string> = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };
  const spelled = dateStr.toLowerCase().match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (spelled && months[spelled[2]]) {
    const day = spelled[1].padStart(2, '0');
    return `${spelled[3]}-${months[spelled[2]]}-${day}`;
  }

  return null;
}

// Guess actuacion type
function guessActType(normalizedText: string): string | null {
  if (/auto\s+admisorio|admite\s+(la\s+)?demanda/.test(normalizedText)) return 'AUTO_ADMISORIO';
  if (/mandamiento\s+de\s+pago/.test(normalizedText)) return 'MANDAMIENTO_DE_PAGO';
  if (/notificacion|notificado/.test(normalizedText)) return 'NOTIFICACION';
  if (/al\s+despacho|expediente\s+al\s+despacho/.test(normalizedText)) return 'EXPEDIENTE_AL_DESPACHO';
  if (/sentencia|fallo/.test(normalizedText)) return 'SENTENCIA';
  if (/audiencia/.test(normalizedText)) return 'AUDIENCIA';
  if (/recurso|apelacion/.test(normalizedText)) return 'RECURSO';
  if (/traslado/.test(normalizedText)) return 'TRASLADO';
  return null;
}

// Fetch data from external API using job-based polling
async function fetchFromExternalApi(radicado: string): Promise<ExternalApiResponse | null> {
  try {
    const cleanRadicado = radicado.replace(/\D/g, '');
    
    console.log(`🔍 Starting job for radicado: ${cleanRadicado}`);

    // Step 1: Start the search job
    const startResponse = await fetch(
      `${EXTERNAL_API_BASE}/buscar?numero_radicacion=${cleanRadicado}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );

    if (!startResponse.ok) {
      console.error(`API returned status ${startResponse.status} for radicado ${radicado}`);
      return null;
    }

    const startData = await startResponse.json();
    
    // If API returns direct data (no jobId), handle it directly
    if (!startData.jobId) {
      if (startData.error || !startData.success) {
        console.log(`API returned error for ${radicado}:`, startData.error);
        return null;
      }
      // Direct response with data
      if (startData.proceso) {
        return startData;
      }
      return null;
    }

    const jobId = startData.jobId;
    console.log(`📋 Job ID for ${cleanRadicado}: ${jobId}`);

    // Step 2: Poll for results (max 60 attempts, 2 seconds each = 2 minutes)
    const maxAttempts = 60;
    const pollingInterval = 2000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
      
      try {
        const resultResponse = await fetch(
          `${EXTERNAL_API_BASE}/resultado/${jobId}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          }
        );

        const result = await resultResponse.json();
        console.log(`⏳ Attempt ${attempt} for ${cleanRadicado}: ${result.status}`);

        if (result.status === 'completed') {
          if (result.estado === 'NO_ENCONTRADO') {
            console.log(`❌ Process not found for ${cleanRadicado}`);
            return null;
          }
          console.log(`✅ Process found for ${cleanRadicado} with ${result.total_actuaciones} actuaciones`);
          return result;
        } else if (result.status === 'failed') {
          console.error(`❌ Job failed for ${cleanRadicado}:`, result.error);
          return null;
        }
        // Continue polling if status is 'pending' or 'processing'
      } catch (pollError) {
        console.error(`Error polling for ${cleanRadicado}:`, pollError);
        // Continue trying unless we've hit max attempts
      }
    }

    console.error(`⏱️ Timeout waiting for job ${jobId} for ${cleanRadicado}`);
    return null;
  } catch (error) {
    console.error(`Error fetching from external API for ${radicado}:`, error);
    return null;
  }
}

// Process a single work_item
async function crawlWorkItem(
  supabase: SupabaseClient,
  workItem: WorkItemToCrawl
): Promise<CrawlResult> {
  console.log(`Crawling work_item ${workItem.id} with radicado ${workItem.radicado}`);

  const data = await fetchFromExternalApi(workItem.radicado);

  if (!data || data.error || !data.proceso) {
    await supabase
      .from('work_items')
      .update({ 
        last_checked_at: new Date().toISOString(),
        scrape_status: 'FAILED',
      })
      .eq('id', workItem.id);

    return {
      work_item_id: workItem.id,
      success: false,
      new_actuaciones: 0,
      error: data?.error || 'No data returned from API',
    };
  }

  const sourceUrl = `${EXTERNAL_API_BASE}/buscar?numero_radicacion=${workItem.radicado}`;

  // Get existing actuaciones to detect new ones
  const { data: existingActs } = await supabase
    .from('actuaciones')
    .select('hash_fingerprint')
    .eq('work_item_id', workItem.id);

  const existingHashes = new Set(
    ((existingActs as Array<{ hash_fingerprint: string }>) || []).map(a => a.hash_fingerprint)
  );

  // Process new actuaciones
  const newActuaciones: ActuacionRow[] = [];

  for (const act of data.actuaciones || []) {
    const rawText = `${act['Actuación'] || ''}${act['Anotación'] ? ' - ' + act['Anotación'] : ''}`;
    const normalizedText = normalizeText(rawText);
    const actDate = parseColombianDate(act['Fecha de Actuación'] || '');
    const hashFingerprint = computeHash(workItem.id, actDate, normalizedText, sourceUrl);

    if (!existingHashes.has(hashFingerprint)) {
      newActuaciones.push({
        owner_id: workItem.owner_id,
        work_item_id: workItem.id,
        source: 'RAMA_JUDICIAL',
        source_url: sourceUrl,
        raw_text: rawText,
        normalized_text: normalizedText,
        act_date: actDate,
        act_date_raw: act['Fecha de Actuación'] || '',
        act_type_guess: guessActType(normalizedText),
        confidence: 0.7,
        hash_fingerprint: hashFingerprint,
        attachments: [],
        adapter_name: 'external-rama-judicial-api',
      });
    }
  }

  // Insert new actuaciones
  if (newActuaciones.length > 0) {
    const { error: insertError } = await supabase
      .from('actuaciones')
      .insert(newActuaciones as unknown as Record<string, unknown>[]);

    if (insertError) {
      console.error('Error inserting actuaciones:', insertError);
    } else {
      console.log(`Inserted ${newActuaciones.length} new actuaciones for ${workItem.id}`);

      // Create alerts for new actuaciones
      await createActuacionAlerts(supabase, workItem, newActuaciones);
    }
  }

  // Update work_item with scraped metadata
  const updateData: Record<string, unknown> = {
    scraped_fields: {
      despacho: data.proceso['Despacho'],
      tipoProceso: data.proceso['Tipo de Proceso'],
      demandante: data.proceso['Demandante'],
      demandado: data.proceso['Demandado'],
      ubicacion: data.proceso['Ubicación'],
      fechaRadicacion: data.proceso['Fecha de Radicación'],
      totalActuaciones: data.total_actuaciones,
    },
    radicado_verified: true,
    last_checked_at: new Date().toISOString(),
    last_crawled_at: new Date().toISOString(),
    scrape_status: 'SUCCESS',
  };

  // Also update court info if not already set
  if (data.proceso['Despacho']) {
    updateData.authority_name = data.proceso['Despacho'];
  }
  if (data.proceso['Demandante']) {
    updateData.demandantes = data.proceso['Demandante'];
  }
  if (data.proceso['Demandado']) {
    updateData.demandados = data.proceso['Demandado'];
  }

  await supabase.from('work_items').update(updateData).eq('id', workItem.id);

  return {
    work_item_id: workItem.id,
    success: true,
    new_actuaciones: newActuaciones.length,
  };
}

// Create alerts for new actuaciones
async function createActuacionAlerts(
  supabase: SupabaseClient,
  workItem: WorkItemToCrawl,
  newActuaciones: ActuacionRow[]
) {
  // Get user email for notifications
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', workItem.owner_id)
    .single();

  const profileData = profile as { email?: string; full_name?: string } | null;

  // Create a summary alert for all new actuaciones
  const alertTitle = `${newActuaciones.length} nueva(s) actuación(es) detectada(s)`;
  const recentActs = newActuaciones.slice(0, 3);
  const alertMessage = `Radicado ${workItem.radicado}: ${recentActs.map(a => 
    a.act_type_guess || 'Actuación'
  ).join(', ')}${newActuaciones.length > 3 ? ` y ${newActuaciones.length - 3} más` : ''}`;

  // Determine severity based on act types
  let severity = 'INFO';
  const hasImportant = newActuaciones.some(a => 
    ['SENTENCIA', 'AUTO_ADMISORIO', 'AUDIENCIA', 'NOTIFICACION'].includes(a.act_type_guess || '')
  );
  if (hasImportant) severity = 'WARNING';

  // Create alert instance using canonical /work-items/:id route
  const alertInsert = {
    owner_id: workItem.owner_id,
    entity_type: 'WORK_ITEM',
    entity_id: workItem.id,
    severity,
    status: 'PENDING',
    title: alertTitle,
    message: alertMessage,
    payload: {
      radicado: workItem.radicado,
      workflow_type: workItem.workflow_type,
      new_count: newActuaciones.length,
      actuaciones: newActuaciones.map(a => ({
        text: a.raw_text.substring(0, 200),
        date: a.act_date,
        type: a.act_type_guess,
      })),
    },
    actions: [
      { 
        label: 'Ver Proceso', 
        action: 'navigate', 
        params: { path: `/work-items/${workItem.id}` } 
      },
    ],
  };
  
  await supabase.from('alert_instances').insert(alertInsert as unknown as Record<string, unknown>);

  // Send email notification if user has email
  if (profileData?.email) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

      await fetch(`${supabaseUrl}/functions/v1/send-reminder`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'process_update',
          recipientEmail: profileData.email,
          recipientName: profileData.full_name || undefined,
          subject: alertTitle,
          radicado: workItem.radicado,
          message: `Se detectaron ${newActuaciones.length} nueva(s) actuación(es) en el proceso ${workItem.radicado}:\n\n${
            newActuaciones.slice(0, 5).map(a => `• ${a.act_date || 'Sin fecha'}: ${a.raw_text.substring(0, 100)}...`).join('\n')
          }${newActuaciones.length > 5 ? `\n\n... y ${newActuaciones.length - 5} actuación(es) más.` : ''}`,
        }),
      });
      console.log(`Email notification sent to ${profileData.email} for ${workItem.radicado}`);
    } catch (emailError) {
      console.error('Error sending email notification:', emailError);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting scheduled crawler run with work_items...');

    const results: CrawlResult[] = [];
    let totalNewActuaciones = 0;

    // Get all work_items with monitoring enabled and valid radicado
    // This replaces the legacy queries to filings and monitored_processes
    const { data: workItems, error: workItemsError } = await supabase
      .from('work_items')
      .select('id, radicado, owner_id, workflow_type, last_crawled_at, last_checked_at')
      .eq('monitoring_enabled', true)
      .in('workflow_type', ['CGP', 'CPACA', 'TUTELA', 'LABORAL', 'PENAL_906'])
      .not('radicado', 'is', null)
      .neq('status', 'ARCHIVED');

    if (workItemsError) {
      console.error('Error fetching work_items:', workItemsError);
      return new Response(
        JSON.stringify({ success: false, error: workItemsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const workItemsArray = (workItems as WorkItemToCrawl[] | null) || [];
    console.log(`Found ${workItemsArray.length} work_items to crawl`);

    // Process work_items
    for (const workItem of workItemsArray) {
      // Skip if checked in the last 20 hours
      const lastCheck = workItem.last_checked_at || workItem.last_crawled_at;
      if (lastCheck) {
        const lastCheckDate = new Date(lastCheck);
        const hoursSinceCheck = (Date.now() - lastCheckDate.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCheck < 20) {
          console.log(`Skipping work_item ${workItem.id} - checked ${hoursSinceCheck.toFixed(1)} hours ago`);
          continue;
        }
      }

      try {
        const result = await crawlWorkItem(supabase, workItem);
        results.push(result);
        totalNewActuaciones += result.new_actuaciones;

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`Error crawling work_item ${workItem.id}:`, error);
        results.push({
          work_item_id: workItem.id,
          success: false,
          new_actuaciones: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`Scheduled crawler complete: ${successCount} success, ${failCount} failed, ${totalNewActuaciones} new actuaciones`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        entities_processed: results.length,
        success_count: successCount,
        fail_count: failCount,
        total_new_actuaciones: totalNewActuaciones,
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
