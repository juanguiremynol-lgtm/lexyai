import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// External API configuration
const EXTERNAL_API_BASE = 'https://rama-judicial-api.onrender.com';
const CRAWL_TIMEOUT = 30000; // 30 seconds

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
  filing_id?: string;
  process_id?: string;
  success: boolean;
  new_actuaciones: number;
  error?: string;
}

interface EntityToCrawl {
  id: string;
  radicado: string;
  owner_id: string;
  last_crawled_at?: string | null;
  last_checked_at?: string | null;
}

interface ActuacionRow {
  owner_id: string;
  filing_id: string | null;
  monitored_process_id: string | null;
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
function computeHash(actDate: string | null, normalizedText: string, sourceUrl: string): string {
  const data = `${actDate || ''}|${normalizedText}|${sourceUrl}`;
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

// Fetch data from external API
async function fetchFromExternalApi(radicado: string): Promise<ExternalApiResponse | null> {
  try {
    const cleanRadicado = radicado.replace(/\D/g, '');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CRAWL_TIMEOUT);

    const response = await fetch(
      `${EXTERNAL_API_BASE}/buscar?numero_radicacion=${cleanRadicado}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`API returned status ${response.status} for radicado ${radicado}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching from external API for ${radicado}:`, error);
    return null;
  }
}

// Process a single entity (filing or monitored_process)
async function crawlEntity(
  supabase: SupabaseClient,
  entity: EntityToCrawl,
  isMonitoredProcess: boolean
): Promise<CrawlResult> {
  const idField = isMonitoredProcess ? 'process_id' : 'filing_id';
  
  console.log(`Crawling ${isMonitoredProcess ? 'monitored_process' : 'filing'} ${entity.id} with radicado ${entity.radicado}`);

  const data = await fetchFromExternalApi(entity.radicado);

  if (!data || data.error || !data.proceso) {
    if (isMonitoredProcess) {
      await supabase
        .from('monitored_processes')
        .update({ 
          last_checked_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', entity.id);
    } else {
      await supabase
        .from('filings')
        .update({ 
          last_crawled_at: new Date().toISOString(),
          scrape_status: 'FAILED' 
        } as Record<string, unknown>)
        .eq('id', entity.id);
    }

    return {
      [idField]: entity.id,
      success: false,
      new_actuaciones: 0,
      error: data?.error || 'No data returned from API',
    };
  }

  const sourceUrl = `${EXTERNAL_API_BASE}/buscar?numero_radicacion=${entity.radicado}`;

  // Get existing actuaciones to detect new ones
  const queryField = isMonitoredProcess ? 'monitored_process_id' : 'filing_id';
  const { data: existingActs } = await supabase
    .from('actuaciones')
    .select('hash_fingerprint')
    .eq(queryField, entity.id);

  const existingHashes = new Set(
    ((existingActs as Array<{ hash_fingerprint: string }>) || []).map(a => a.hash_fingerprint)
  );

  // Process new actuaciones
  const newActuaciones: ActuacionRow[] = [];

  for (const act of data.actuaciones || []) {
    const rawText = `${act['Actuación'] || ''}${act['Anotación'] ? ' - ' + act['Anotación'] : ''}`;
    const normalizedText = normalizeText(rawText);
    const actDate = parseColombianDate(act['Fecha de Actuación'] || '');
    const hashFingerprint = computeHash(actDate, normalizedText, sourceUrl);

    if (!existingHashes.has(hashFingerprint)) {
      newActuaciones.push({
        owner_id: entity.owner_id,
        filing_id: isMonitoredProcess ? null : entity.id,
        monitored_process_id: isMonitoredProcess ? entity.id : null,
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
      console.log(`Inserted ${newActuaciones.length} new actuaciones for ${entity.id}`);

      // Create alerts for new actuaciones
      await createActuacionAlerts(supabase, entity, newActuaciones, isMonitoredProcess);
    }
  }

  // Update entity with scraped metadata
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
    radicado_status: 'VERIFIED_FOUND',
  };

  // Also update court info if not already set
  if (data.proceso['Despacho']) {
    updateData.court_name = data.proceso['Despacho'];
  }
  if (data.proceso['Demandante']) {
    updateData.demandantes = data.proceso['Demandante'];
  }
  if (data.proceso['Demandado']) {
    updateData.demandados = data.proceso['Demandado'];
  }

  if (isMonitoredProcess) {
    updateData.last_checked_at = new Date().toISOString();
    await supabase.from('monitored_processes').update(updateData).eq('id', entity.id);
  } else {
    updateData.last_crawled_at = new Date().toISOString();
    updateData.scrape_status = 'SUCCESS';
    await supabase.from('filings').update(updateData).eq('id', entity.id);
  }

  return {
    [idField]: entity.id,
    success: true,
    new_actuaciones: newActuaciones.length,
  };
}

// Create alerts for new actuaciones
async function createActuacionAlerts(
  supabase: SupabaseClient,
  entity: EntityToCrawl,
  newActuaciones: ActuacionRow[],
  isMonitoredProcess: boolean
) {
  const entityType = isMonitoredProcess ? 'CGP_CASE' : 'CGP_FILING';
  
  // Get user email for notifications
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', entity.owner_id)
    .single();

  const profileData = profile as { email?: string; full_name?: string } | null;

  // Create a summary alert for all new actuaciones
  const alertTitle = `${newActuaciones.length} nueva(s) actuación(es) detectada(s)`;
  const recentActs = newActuaciones.slice(0, 3);
  const alertMessage = `Radicado ${entity.radicado}: ${recentActs.map(a => 
    a.act_type_guess || 'Actuación'
  ).join(', ')}${newActuaciones.length > 3 ? ` y ${newActuaciones.length - 3} más` : ''}`;

  // Determine severity based on act types
  let severity = 'INFO';
  const hasImportant = newActuaciones.some(a => 
    ['SENTENCIA', 'AUTO_ADMISORIO', 'AUDIENCIA', 'NOTIFICACION'].includes(a.act_type_guess || '')
  );
  if (hasImportant) severity = 'WARNING';

  // Create alert instance
  const alertInsert = {
    owner_id: entity.owner_id,
    entity_type: entityType,
    entity_id: entity.id,
    severity,
    status: 'PENDING',
    title: alertTitle,
    message: alertMessage,
    payload: {
      radicado: entity.radicado,
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
        params: { path: isMonitoredProcess ? `/processes/${entity.id}` : `/filings/${entity.id}` } 
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
          radicado: entity.radicado,
          message: `Se detectaron ${newActuaciones.length} nueva(s) actuación(es) en el proceso ${entity.radicado}:\n\n${
            newActuaciones.slice(0, 5).map(a => `• ${a.act_date || 'Sin fecha'}: ${a.raw_text.substring(0, 100)}...`).join('\n')
          }${newActuaciones.length > 5 ? `\n\n... y ${newActuaciones.length - 5} actuación(es) más.` : ''}`,
        }),
      });
      console.log(`Email notification sent to ${profileData.email} for ${entity.radicado}`);
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

    console.log('Starting scheduled crawler run with external API...');

    const results: CrawlResult[] = [];
    let totalNewActuaciones = 0;

    // Get all CGP filings with crawler enabled and a radicado
    const { data: filings, error: filingsError } = await supabase
      .from('filings')
      .select('id, radicado, owner_id, last_crawled_at, case_family')
      .eq('crawler_enabled', true)
      .not('radicado', 'is', null)
      .not('status', 'in', '(CLOSED,ARCHIVED)')
      .or('case_family.eq.CGP,case_family.is.null');

    if (filingsError) {
      console.error('Error fetching filings:', filingsError);
    }

    // Get all monitored processes with active flag
    const { data: processes, error: processesError } = await supabase
      .from('monitored_processes')
      .select('id, radicado, owner_id, last_checked_at')
      .eq('active', true)
      .not('radicado', 'is', null);

    if (processesError) {
      console.error('Error fetching monitored_processes:', processesError);
    }

    const filingsArray = (filings as EntityToCrawl[] | null) || [];
    const processesArray = (processes as EntityToCrawl[] | null) || [];

    console.log(`Found ${filingsArray.length} filings and ${processesArray.length} monitored processes to crawl`);

    // Process filings
    for (const filing of filingsArray) {
      // Skip if crawled in the last 20 hours
      if (filing.last_crawled_at) {
        const lastCrawl = new Date(filing.last_crawled_at);
        const hoursSinceCrawl = (Date.now() - lastCrawl.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCrawl < 20) {
          console.log(`Skipping filing ${filing.id} - crawled ${hoursSinceCrawl.toFixed(1)} hours ago`);
          continue;
        }
      }

      try {
        const result = await crawlEntity(supabase, filing, false);
        results.push(result);
        totalNewActuaciones += result.new_actuaciones;

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`Error crawling filing ${filing.id}:`, error);
        results.push({
          filing_id: filing.id,
          success: false,
          new_actuaciones: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Process monitored processes
    for (const process of processesArray) {
      // Skip if checked in the last 20 hours
      if (process.last_checked_at) {
        const lastCheck = new Date(process.last_checked_at);
        const hoursSinceCheck = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCheck < 20) {
          console.log(`Skipping process ${process.id} - checked ${hoursSinceCheck.toFixed(1)} hours ago`);
          continue;
        }
      }

      try {
        const result = await crawlEntity(supabase, process, true);
        results.push(result);
        totalNewActuaciones += result.new_actuaciones;

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`Error crawling process ${process.id}:`, error);
        results.push({
          process_id: process.id,
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
