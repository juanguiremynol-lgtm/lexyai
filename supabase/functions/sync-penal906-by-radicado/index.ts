/**
 * sync-penal906-by-radicado Edge Function
 * 
 * Syncs Penal 906 actuaciones from Rama Judicial for a specific work item.
 * Uses the scraper-proxy adapter to fetch data from the judicial portal.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Raw actuación structure from Rama Judicial
interface RawActuacion {
  radicado: string;
  fechaActuacion: string | null;
  despacho: string | null;
  descripcion: string;
  urlDocumento: string | null;
  fechaConsulta: string;
}

// Simple hash function for fingerprinting
function simpleHash(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

// Classification patterns for Penal 906 phases
const PHASE_PATTERNS: { phase: number; patterns: RegExp[]; priority: number }[] = [
  // Terminal phases (highest priority)
  { phase: 12, patterns: [/sentencia\s+condenatoria\s+(en\s+firme|ejecutoriada)/i, /condena\s+(en\s+firme|ejecutoriada)/i], priority: 100 },
  { phase: 11, patterns: [/sentencia\s+absolutoria\s+(en\s+firme|ejecutoriada)/i, /absolucion\s+(en\s+firme|ejecutoriada)/i], priority: 100 },
  { phase: 10, patterns: [/preclusion\s+(decretada|aprobada)/i, /archivo\s+definitivo/i, /cesacion\s+de\s+procedimiento/i], priority: 100 },
  // High priority phases
  { phase: 9, patterns: [/ejecutoria\s+de\s+sentencia/i, /sentencia\s+ejecutoriada/i, /ejecucion\s+de\s+pena/i], priority: 90 },
  { phase: 8, patterns: [/segunda\s+instancia/i, /tribunal\s+superior/i, /recurso\s+de\s+apelacion/i, /casacion/i], priority: 80 },
  { phase: 7, patterns: [/lectura\s+de\s+(fallo|sentencia)/i, /sentido\s+del\s+fallo/i, /individualizacion\s+de\s+pena/i], priority: 70 },
  { phase: 6, patterns: [/juicio\s+oral/i, /audiencia\s+de\s+juicio/i, /practica\s+de\s+pruebas/i, /alegatos\s+(de\s+cierre|finales)/i], priority: 60 },
  { phase: 5, patterns: [/audiencia\s+preparatoria/i, /preparatoria/i, /estipulaciones\s+probatorias/i], priority: 50 },
  { phase: 4, patterns: [/escrito\s+de\s+acusacion/i, /formulacion\s+de\s+acusacion/i, /audiencia\s+de\s+acusacion/i], priority: 40 },
  { phase: 3, patterns: [/solicitud\s+de\s+preclusion/i, /preclusion\s+(en\s+tramite|solicitada)/i], priority: 35 },
  { phase: 2, patterns: [/formulacion\s+de\s+imputacion/i, /audiencia\s+de\s+imputacion/i, /medida\s+de\s+aseguramiento/i, /control\s+de\s+garantias/i], priority: 30 },
  { phase: 1, patterns: [/noticia\s+criminal/i, /indagacion\s+preliminar/i, /investigacion\s+preliminar/i, /denuncia/i], priority: 20 },
  // Suspension
  { phase: 13, patterns: [/suspension\s+(del\s+proceso|procesal)/i, /proceso\s+suspendido/i], priority: 95 },
];

function classifyActuacion(text: string, currentPhase: number): { phase: number; keywords: string[] } {
  const textNorm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const matchedKeywords: string[] = [];
  let bestMatch: { phase: number; priority: number } | null = null;

  for (const rule of PHASE_PATTERNS) {
    for (const pattern of rule.patterns) {
      const match = textNorm.match(pattern);
      if (match) {
        matchedKeywords.push(match[0]);
        if (!bestMatch || rule.priority > bestMatch.priority) {
          bestMatch = { phase: rule.phase, priority: rule.priority };
        }
      }
    }
  }

  // Only advance forward (unless terminal or suspension)
  if (bestMatch) {
    if (bestMatch.phase >= 10 || bestMatch.phase === 13 || bestMatch.phase > currentPhase) {
      return { phase: bestMatch.phase, keywords: matchedKeywords };
    }
  }

  return { phase: currentPhase, keywords: matchedKeywords };
}

function extractSummary(text: string, maxLength = 200): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > maxLength * 0.7 ? truncated.slice(0, lastSpace) + "..." : truncated + "...";
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid token", code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claims.claims.sub as string;

    // Parse request
    const { work_item_id, radicado } = await req.json();

    if (!work_item_id || !radicado) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing work_item_id or radicado", code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify work item ownership
    const { data: workItem, error: wiError } = await supabase
      .from("work_items")
      .select("id, owner_id, organization_id, pipeline_stage, workflow_type")
      .eq("id", work_item_id)
      .single();

    if (wiError || !workItem) {
      return new Response(
        JSON.stringify({ ok: false, error: "Work item not found", code: "NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (workItem.workflow_type !== "PENAL_906") {
      return new Response(
        JSON.stringify({ ok: false, error: "Work item is not PENAL_906 type", code: "INVALID_TYPE" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // TODO: Call scraper-proxy or Rama Judicial adapter to fetch actuaciones
    // For now, return a stub response indicating sync initiated
    // In production, this would call the actual scraping service

    console.log(`[sync-penal906] Sync initiated for radicado: ${radicado}, work_item: ${work_item_id}`);

    // Simulate fetching actuaciones (stub - replace with actual scraper call)
    const rawActuaciones: RawActuacion[] = [];

    // Process actuaciones if any
    const scrapeDate = new Date().toISOString().split("T")[0];
    let currentPhase = workItem.pipeline_stage ?? 0;
    let eventsCreated = 0;
    let eventsSkippedDuplicate = 0;
    let phaseChanged = false;
    const oldPhase = currentPhase;
    let newPhase = currentPhase;

    // Get existing fingerprints
    const { data: existingActs } = await supabase
      .from("work_item_acts")
      .select("hash_fingerprint")
      .eq("work_item_id", work_item_id);

    const existingFingerprints = new Set((existingActs || []).map((a) => a.hash_fingerprint));

    for (const raw of rawActuaciones) {
      const fingerprint = `penal_${simpleHash(`${work_item_id}|${raw.fechaActuacion}|${raw.descripcion.slice(0, 100)}`)}`;

      if (existingFingerprints.has(fingerprint)) {
        eventsSkippedDuplicate++;
        continue;
      }

      const classification = classifyActuacion(raw.descripcion, currentPhase);
      const summary = extractSummary(raw.descripcion);

      const { error: insertError } = await supabase
        .from("work_item_acts")
        .insert({
          owner_id: workItem.owner_id,
          organization_id: workItem.organization_id,
          work_item_id: work_item_id,
          workflow_type: "PENAL_906",
          act_date: raw.fechaActuacion,
          description: summary,
          act_type: "ACTUACION",
          source: "RAMA_JUDICIAL",
          hash_fingerprint: fingerprint,
          phase_inferred: classification.phase,
          keywords_matched: classification.keywords,
          event_date: raw.fechaActuacion,
          scrape_date: scrapeDate,
          despacho: raw.despacho,
          event_summary: summary,
          source_url: raw.urlDocumento,
          source_platform: "Rama Judicial",
        });

      if (!insertError) {
        eventsCreated++;
        existingFingerprints.add(fingerprint);

        if (classification.phase > newPhase) {
          newPhase = classification.phase;
        }
      }
    }

    // Update work item if phase changed
    if (newPhase !== oldPhase) {
      phaseChanged = true;
      await supabase
        .from("work_items")
        .update({
          pipeline_stage: newPhase,
          last_phase_change_at: new Date().toISOString(),
          last_scrape_at: new Date().toISOString(),
        })
        .eq("id", work_item_id);
    } else {
      await supabase
        .from("work_items")
        .update({ last_scrape_at: new Date().toISOString() })
        .eq("id", work_item_id);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        work_item_id,
        events_processed: rawActuaciones.length,
        events_created: eventsCreated,
        events_skipped_duplicate: eventsSkippedDuplicate,
        phase_changed: phaseChanged,
        old_phase: oldPhase,
        new_phase: newPhase,
        message: rawActuaciones.length === 0 
          ? "Sync service ready. Rama Judicial adapter pending integration." 
          : `Processed ${rawActuaciones.length} actuaciones.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[sync-penal906] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message, code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
