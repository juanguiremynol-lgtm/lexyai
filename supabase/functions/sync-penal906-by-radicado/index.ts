/**
 * sync-penal906-by-radicado Edge Function
 * 
 * Syncs Penal 906 actuaciones from Rama Judicial for a specific work item.
 * Uses the External API adapter to fetch data from the judicial portal.
 * 
 * Responsibilities:
 * 1. Fetch actuaciones from External API (Render)
 * 2. Classify into Penal 906 phases (0-13)
 * 3. Write to work_item_acts with deduplication
 * 4. Update work_items.pipeline_stage
 * 5. Create alert_instances for significant events
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// External API configuration
const EXTERNAL_API_BASE = "https://rama-judicial-api.onrender.com";
const POLLING_INTERVAL_MS = 2000;
const MAX_POLLING_ATTEMPTS = 45; // 90 seconds max

// Raw actuación structure from External API
interface ExternalActuacion {
  "Fecha de Actuación"?: string;
  "Actuación"?: string;
  "Anotación"?: string;
  "Fecha inicia Término"?: string;
  "Fecha finaliza Término"?: string;
  "Fecha de Registro"?: string;
}

interface ExternalApiResponse {
  jobId?: string;
  success?: boolean;
  status?: string;
  estado?: string;
  proceso?: Record<string, string>;
  actuaciones?: ExternalActuacion[];
  total_actuaciones?: number;
  error?: string;
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

// Normalize text for pattern matching
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract summary from raw text
function extractSummary(text: string, maxLength = 200): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > maxLength * 0.7 ? truncated.slice(0, lastSpace) + "..." : truncated + "...";
}

// Classification patterns for Penal 906 phases
type PatternPriority = "CRITICA" | "ALTA" | "MEDIA" | "BAJA";

interface PatternRule {
  phase: number;
  patterns: RegExp[];
  priority: PatternPriority;
  forcePhase?: boolean; // For terminal states
}

const CLASSIFICATION_RULES: PatternRule[] = [
  // CRITICA - Terminal phases
  {
    phase: 12, // FINALIZADO_CONDENADO
    patterns: [
      /sentencia\s+condenatoria\s+(en\s+firme|ejecutoriada)/,
      /condena\s+(en\s+firme|ejecutoriada)/,
      /fallo\s+condenatorio\s+ejecutoriado/,
    ],
    priority: "CRITICA",
    forcePhase: true,
  },
  {
    phase: 11, // FINALIZADO_ABSUELTO
    patterns: [
      /sentencia\s+absolutoria\s+(en\s+firme|ejecutoriada)/,
      /absolucion\s+(en\s+firme|ejecutoriada)/,
    ],
    priority: "CRITICA",
    forcePhase: true,
  },
  {
    phase: 10, // PRECLUIDO_ARCHIVADO
    patterns: [
      /preclusion\s+(decretada|aprobada|ordenada)/,
      /archivo\s+(definitivo|del\s+proceso)/,
      /cesacion\s+de\s+procedimiento/,
      /extincion\s+de\s+la\s+accion\s+penal/,
    ],
    priority: "CRITICA",
    forcePhase: true,
  },
  // ALTA - High priority
  {
    phase: 9, // EJECUTORIA
    patterns: [/ejecutoria\s+de\s+sentencia/, /sentencia\s+ejecutoriada/, /ejecucion\s+de\s+pena/],
    priority: "ALTA",
  },
  {
    phase: 8, // SEGUNDA_INSTANCIA
    patterns: [/segunda\s+instancia/, /tribunal\s+superior/, /recurso\s+de\s+apelacion/, /casacion/],
    priority: "ALTA",
  },
  {
    phase: 7, // SENTENCIA_TRAMITE
    patterns: [
      /lectura\s+de\s+(fallo|sentencia)/,
      /sentido\s+del\s+fallo/,
      /audiencia\s+de\s+individualizacion/,
      /allanamiento\s+a\s+cargos/,
      /aceptacion\s+de\s+cargos/,
    ],
    priority: "ALTA",
  },
  {
    phase: 6, // JUICIO_ORAL
    patterns: [
      /juicio\s+oral/,
      /audiencia\s+de\s+juicio/,
      /practica\s+de\s+pruebas/,
      /alegatos\s+(de\s+cierre|finales)/,
    ],
    priority: "ALTA",
  },
  {
    phase: 5, // PREPARATORIA
    patterns: [/audiencia\s+preparatoria/, /estipulaciones\s+probatorias/, /solicitudes\s+probatorias/],
    priority: "ALTA",
  },
  {
    phase: 4, // ACUSACION
    patterns: [
      /escrito\s+de\s+acusacion/,
      /formulacion\s+de\s+acusacion/,
      /audiencia\s+de\s+acusacion/,
    ],
    priority: "ALTA",
  },
  {
    phase: 2, // IMPUTACION_INVESTIGACION
    patterns: [
      /formulacion\s+de\s+imputacion/,
      /audiencia\s+de\s+imputacion/,
      /control\s+de\s+garantias/,
      /medida\s+de\s+aseguramiento/,
    ],
    priority: "ALTA",
  },
  // MEDIA - Medium priority
  {
    phase: 3, // PRECLUSION_TRAMITE
    patterns: [/solicitud\s+de\s+preclusion/, /preclusion\s+(en\s+tramite|solicitada)/],
    priority: "MEDIA",
  },
  {
    phase: 1, // NOTICIA_CRIMINAL_INDAGACION
    patterns: [
      /noticia\s+criminal/,
      /indagacion\s+preliminar/,
      /investigacion\s+preliminar/,
      /denuncia/,
    ],
    priority: "MEDIA",
  },
  // Suspension
  {
    phase: 13, // SUSPENDIDO_INACTIVO
    patterns: [/suspension\s+(del\s+proceso|procesal)/, /proceso\s+suspendido/],
    priority: "ALTA",
    forcePhase: true,
  },
];

// Retroceso patterns (allow backward movement)
const RETROCESO_PATTERNS = [
  /nulidad\s+(decreta|declara)/,
  /revoca\s+auto/,
  /deja\s+sin\s+efecto/,
  /anula\s+(actuacion|proceso)/,
];

function hasRetrocesoKeywords(textNorm: string): boolean {
  return RETROCESO_PATTERNS.some((p) => p.test(textNorm));
}

function isValidTransition(currentPhase: number, newPhase: number, hasRetroceso: boolean): boolean {
  // Forward progression always allowed
  if (newPhase > currentPhase) return true;
  // Same phase allowed
  if (newPhase === currentPhase) return true;
  // Backward only with retroceso
  if (newPhase < currentPhase && hasRetroceso) return true;
  return false;
}

function classifyActuacion(
  text: string,
  currentPhase: number
): { phase: number; keywords: string[]; confidence: string } {
  const textNorm = normalizeText(text);
  const matchedKeywords: string[] = [];
  const hasRetroceso = hasRetrocesoKeywords(textNorm);

  // Sort rules by priority
  const priorityOrder: PatternPriority[] = ["CRITICA", "ALTA", "MEDIA", "BAJA"];
  let bestPhase: number | null = null;
  let bestConfidence: string | null = null;

  for (const priority of priorityOrder) {
    const rulesAtPriority = CLASSIFICATION_RULES.filter((r) => r.priority === priority);

    for (const rule of rulesAtPriority) {
      for (const pattern of rule.patterns) {
        const match = textNorm.match(pattern);
        if (match) {
          matchedKeywords.push(match[0]);

          if (rule.forcePhase) {
            if (bestPhase === null || rule.phase > bestPhase) {
              bestPhase = rule.phase;
              bestConfidence = "HIGH";
            }
          } else if (isValidTransition(currentPhase, rule.phase, hasRetroceso)) {
            if (bestPhase === null || rule.phase > bestPhase) {
              bestPhase = rule.phase;
              bestConfidence = priority === "ALTA" ? "HIGH" : "MEDIUM";
            }
          }
        }
      }
    }

    if (bestPhase !== null) break;
  }

  return {
    phase: bestPhase ?? currentPhase,
    keywords: matchedKeywords,
    confidence: bestConfidence ?? "LOW",
  };
}

// Detect important events for alerts
function detectImportantEvent(textNorm: string): { type: string; severity: string } | null {
  if (/sentencia|fallo\s+(condenat|absolut)/.test(textNorm)) {
    return { type: "SENTENCIA", severity: "CRITICAL" };
  }
  if (/audiencia/.test(textNorm)) {
    return { type: "AUDIENCIA", severity: "WARNING" };
  }
  if (/preclusion|archivo/.test(textNorm)) {
    return { type: "TERMINACION", severity: "CRITICAL" };
  }
  if (/recurso|apelacion/.test(textNorm)) {
    return { type: "RECURSO", severity: "WARNING" };
  }
  return null;
}

// Poll for External API results
async function pollForResults(jobId: string): Promise<ExternalApiResponse> {
  let attempts = 0;

  while (attempts < MAX_POLLING_ATTEMPTS) {
    attempts++;
    await new Promise((r) => setTimeout(r, POLLING_INTERVAL_MS));

    const response = await fetch(`${EXTERNAL_API_BASE}/resultado/${jobId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const result: ExternalApiResponse = await response.json();
    console.log(`[sync-penal906] Polling attempt ${attempts}: ${result.status || "unknown"}`);

    if (result.status === "completed") {
      return result;
    }
    if (result.status === "failed" || result.estado === "NO_ENCONTRADO") {
      throw new Error(result.error || "Not found");
    }
  }

  throw new Error("Polling timeout");
}

// Fetch actuaciones from External API
async function fetchActuaciones(
  radicado: string
): Promise<{ ok: boolean; actuaciones: ExternalActuacion[]; proceso: Record<string, string> | null; error?: string }> {
  try {
    console.log(`[sync-penal906] Fetching radicado: ${radicado}`);

    const startResponse = await fetch(`${EXTERNAL_API_BASE}/buscar?numero_radicacion=${radicado}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!startResponse.ok) {
      return { ok: false, actuaciones: [], proceso: null, error: `HTTP ${startResponse.status}` };
    }

    const startData: ExternalApiResponse = await startResponse.json();

    let data: ExternalApiResponse;

    if (startData.jobId) {
      console.log(`[sync-penal906] Job ID received: ${startData.jobId}`);
      try {
        data = await pollForResults(startData.jobId);
      } catch (pollError) {
        return {
          ok: false,
          actuaciones: [],
          proceso: null,
          error: pollError instanceof Error ? pollError.message : "Polling failed",
        };
      }
    } else if (startData.proceso) {
      data = startData;
    } else if (startData.estado === "NO_ENCONTRADO") {
      return { ok: false, actuaciones: [], proceso: null, error: "Not found" };
    } else {
      return { ok: false, actuaciones: [], proceso: null, error: "Unexpected response" };
    }

    if (data.estado === "NO_ENCONTRADO" || !data.proceso) {
      return { ok: false, actuaciones: [], proceso: null, error: "Not found" };
    }

    console.log(`[sync-penal906] Found ${data.total_actuaciones} actuaciones`);
    return {
      ok: true,
      actuaciones: data.actuaciones || [],
      proceso: data.proceso,
    };
  } catch (err) {
    console.error("[sync-penal906] Fetch error:", err);
    return {
      ok: false,
      actuaciones: [],
      proceso: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// Parse Colombian date to ISO
function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  // Try DD/MM/YYYY
  const dmyMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  return null;
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

    // Verify user via claims
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
    const { work_item_id, radicado, force_refresh = false } = await req.json();

    if (!work_item_id || !radicado) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing work_item_id or radicado", code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize radicado
    const cleanRadicado = radicado.replace(/\D/g, "");
    if (cleanRadicado.length !== 23) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Radicado must be 23 digits (got ${cleanRadicado.length})`,
          code: "INVALID_RADICADO",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify work item ownership
    const { data: workItem, error: wiError } = await supabase
      .from("work_items")
      .select("id, owner_id, organization_id, pipeline_stage, workflow_type, radicado")
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

    // Fetch actuaciones from External API
    const fetchResult = await fetchActuaciones(cleanRadicado);

    if (!fetchResult.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: fetchResult.error || "Failed to fetch actuaciones",
          code: "FETCH_FAILED",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawActuaciones = fetchResult.actuaciones;
    const scrapeDate = new Date().toISOString().split("T")[0];
    let currentPhase = workItem.pipeline_stage ?? 0;
    let eventsCreated = 0;
    let eventsSkippedDuplicate = 0;
    let alertsCreated = 0;
    const oldPhase = currentPhase;
    let newPhase = currentPhase;

    // Get existing fingerprints
    const { data: existingActs } = await supabase
      .from("work_item_acts")
      .select("hash_fingerprint")
      .eq("work_item_id", work_item_id);

    const existingFingerprints = new Set((existingActs || []).map((a) => a.hash_fingerprint));

    // Process actuaciones
    for (const raw of rawActuaciones) {
      const rawText = `${raw["Actuación"] || ""} ${raw["Anotación"] || ""}`.trim();
      if (!rawText) continue;

      const eventDate = parseDate(raw["Fecha de Actuación"]);
      const fingerprint = `penal_${simpleHash(`${work_item_id}|${eventDate || ""}|${rawText.slice(0, 100)}`)}`;

      if (existingFingerprints.has(fingerprint)) {
        eventsSkippedDuplicate++;
        continue;
      }

      const classification = classifyActuacion(rawText, currentPhase);
      const summary = extractSummary(rawText);
      const textNorm = normalizeText(rawText);

      // Insert work_item_act
      const { error: insertError } = await supabase.from("work_item_acts").insert({
        owner_id: workItem.owner_id,
        organization_id: workItem.organization_id,
        work_item_id: work_item_id,
        workflow_type: "PENAL_906",
        act_date: eventDate,
        description: summary,
        act_type: "ACTUACION",
        source: "RAMA_JUDICIAL",
        hash_fingerprint: fingerprint,
        phase_inferred: classification.phase,
        keywords_matched: classification.keywords,
        event_date: eventDate,
        scrape_date: scrapeDate,
        despacho: fetchResult.proceso?.["Despacho"] || null,
        event_summary: summary,
        source_url: `${EXTERNAL_API_BASE}/buscar?numero_radicacion=${cleanRadicado}`,
        source_platform: "Rama Judicial",
      });

      if (!insertError) {
        eventsCreated++;
        existingFingerprints.add(fingerprint);

        // Update phase if advanced
        if (classification.phase > newPhase) {
          newPhase = classification.phase;
        }

        // Create alert for important events
        const importantEvent = detectImportantEvent(textNorm);
        if (importantEvent) {
          const { error: alertError } = await supabase.from("alert_instances").insert({
            owner_id: workItem.owner_id,
            organization_id: workItem.organization_id,
            entity_type: "PENAL_CASE",
            entity_id: work_item_id,
            severity: importantEvent.severity,
            status: "PENDING",
            title: `${importantEvent.type} detectado`,
            message: `Radicado ${cleanRadicado}: ${summary}`,
            payload: {
              radicado: cleanRadicado,
              event_date: eventDate,
              event_type: importantEvent.type,
              phase_inferred: classification.phase,
            },
            actions: [
              {
                label: "Ver Proceso",
                action: "navigate",
                params: { path: `/work-items/${work_item_id}` },
              },
            ],
          });

          if (!alertError) alertsCreated++;
        }
      }
    }

    // Update work item if phase changed or sync happened
    const phaseChanged = newPhase !== oldPhase;
    const updatePayload: Record<string, unknown> = {
      last_scrape_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (phaseChanged) {
      updatePayload.pipeline_stage = newPhase;
      updatePayload.last_phase_change_at = new Date().toISOString();
    }

    // Update court info if available
    if (fetchResult.proceso) {
      if (fetchResult.proceso["Despacho"]) {
        updatePayload.authority_name = fetchResult.proceso["Despacho"];
      }
      if (fetchResult.proceso["Demandante"]) {
        updatePayload.demandantes = fetchResult.proceso["Demandante"];
      }
      if (fetchResult.proceso["Demandado"]) {
        updatePayload.demandados = fetchResult.proceso["Demandado"];
      }
    }

    await supabase.from("work_items").update(updatePayload).eq("id", work_item_id);

    console.log(
      `[sync-penal906] Completed: ${eventsCreated} created, ${eventsSkippedDuplicate} skipped, phase ${oldPhase} -> ${newPhase}`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        work_item_id,
        events_processed: rawActuaciones.length,
        events_created: eventsCreated,
        events_skipped_duplicate: eventsSkippedDuplicate,
        alerts_created: alertsCreated,
        phase_changed: phaseChanged,
        old_phase: oldPhase,
        new_phase: newPhase,
        source: "EXTERNAL_API",
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
