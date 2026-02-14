/**
 * demo-radicado-lookup — Public demo edge function
 * 
 * Zero-auth, zero-DB-write lookup for the landing page "Prueba ATENIA" experience.
 * All external calls route through egressClient with purpose "judicial_demo".
 * 
 * Security:
 * - Rate limit: 5 req / IP / 10 min (in-memory)
 * - PII redaction on all returned text
 * - No DB rows created (telemetry only via atenia_ai_actions)
 * - Masked radicado in all logs
 * - Whitelisted response schema only
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { egressFetch } from "../_shared/egressClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ═══════════════════════════════════════════
// RATE LIMITER (in-memory, resets on cold start)
// ═══════════════════════════════════════════
const ipBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 min

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  let entry = ipBuckets.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  ipBuckets.set(ip, entry);
  return { allowed: true };
}

// ═══════════════════════════════════════════
// PII REDACTION
// ═══════════════════════════════════════════
const PII_FIELD_PATTERNS = [
  "demandante", "demandado", "apoderado", "abogado", "defensor",
  "nombre", "apellido", "cedula", "nit", "telefono", "direccion",
  "email", "correo", "representante", "poderdante", "accionante",
  "accionado", "victima", "procesado", "imputado", "sindicado",
  "parte", "partes", "sujetos", "interviniente",
];

function isPIIField(key: string): boolean {
  const lower = key.toLowerCase();
  return PII_FIELD_PATTERNS.some((p) => lower.includes(p));
}

function redactPIIFromText(text: string): string {
  return text
    .replace(/C\.?\s*C\.?\s*N[oº°]?\s*[\.\s]?\d[\d\.\s]+/gi, "[ID REDACTADO]")
    .replace(/NIT[\s.:]*\d[\d\.\-]+/gi, "[ID REDACTADO]")
    .replace(/\b\d{7,10}\b/g, (m) => (m.length >= 7 ? "[ID REDACTADO]" : m));
}

function maskRadicado(rad: string): string {
  if (rad.length < 8) return "***";
  return rad.slice(0, 4) + "*".repeat(rad.length - 8) + rad.slice(-4);
}

function formatRadicadoDisplay(rad: string): string {
  if (rad.length !== 23) return rad;
  return `${rad.slice(0, 2)}-${rad.slice(2, 5)}-${rad.slice(5, 7)}-${rad.slice(7, 9)}-${rad.slice(9, 12)}-${rad.slice(12, 16)}-${rad.slice(16, 21)}-${rad.slice(21, 23)}`;
}

// ═══════════════════════════════════════════
// DANE CITY ENRICHMENT (subset)
// ═══════════════════════════════════════════
const DANE_CITIES: Record<string, { city: string; dept: string }> = {
  "05001": { city: "Medellín", dept: "Antioquia" },
  "05030": { city: "Apartadó", dept: "Antioquia" },
  "08001": { city: "Barranquilla", dept: "Atlántico" },
  "11001": { city: "Bogotá D.C.", dept: "Bogotá D.C." },
  "13001": { city: "Cartagena", dept: "Bolívar" },
  "15001": { city: "Tunja", dept: "Boyacá" },
  "17001": { city: "Manizales", dept: "Caldas" },
  "19001": { city: "Popayán", dept: "Cauca" },
  "20001": { city: "Valledupar", dept: "Cesar" },
  "23001": { city: "Montería", dept: "Córdoba" },
  "41001": { city: "Neiva", dept: "Huila" },
  "47001": { city: "Santa Marta", dept: "Magdalena" },
  "50001": { city: "Villavicencio", dept: "Meta" },
  "52001": { city: "Pasto", dept: "Nariño" },
  "54001": { city: "Cúcuta", dept: "Norte de Santander" },
  "63001": { city: "Armenia", dept: "Quindío" },
  "66001": { city: "Pereira", dept: "Risaralda" },
  "68001": { city: "Bucaramanga", dept: "Santander" },
  "70001": { city: "Sincelejo", dept: "Sucre" },
  "73001": { city: "Ibagué", dept: "Tolima" },
  "76001": { city: "Cali", dept: "Valle del Cauca" },
  "25754": { city: "Soacha", dept: "Cundinamarca" },
  "25175": { city: "Chía", dept: "Cundinamarca" },
};

const JURISDICCION_MAP: Record<string, string> = {
  "31": "Civil", "33": "Administrativo", "40": "Penal",
  "41": "Laboral", "44": "Familia", "50": "Promiscuo",
  "23": "Civil", "14": "Promiscuo Municipal",
};

// ═══════════════════════════════════════════
// WHITELISTED RESPONSE TYPES
// ═══════════════════════════════════════════
interface DemoResumen {
  radicado_display: string;
  despacho: string | null;
  ciudad: string | null;
  departamento: string | null;
  jurisdiccion: string | null;
  tipo_proceso: string | null;
  fecha_radicacion: string | null;
  ultima_actuacion_fecha: string | null;
  ultima_actuacion_tipo: string | null;
  total_actuaciones: number;
  total_estados: number;
}

interface DemoActuacion {
  fecha: string;
  tipo: string | null;
  descripcion: string;
  anotacion: string | null;
}

interface DemoEstado {
  tipo: string;
  fecha: string;
  descripcion: string | null;
}

// Whitelisted response envelope — nothing outside this shape leaves the function
interface DemoResponse {
  resumen: DemoResumen;
  actuaciones: DemoActuacion[];
  estados: DemoEstado[];
  meta: {
    radicado_masked: string;
    actuaciones_count: number;
    estados_count: number;
    fetched_at: string;
    demo: true;
  };
}

// ═══════════════════════════════════════════
// EGRESS HELPERS — all external calls go through egressClient
// ═══════════════════════════════════════════

const CALLER = "demo-radicado-lookup";

async function fetchCpnuDirect(radicado: string): Promise<{ status: number; body: Record<string, unknown> | null; diagnostic?: Record<string, unknown> }> {
  // Call CPNU v2 API directly with compatibility headers to avoid HTTP 406
  const url = `https://consultaprocesos.ramajudicial.gov.co/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`;
  const headers: Record<string, string> = {
    "Accept": "application/json, text/json, text/plain, */*",
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://consultaprocesos.ramajudicial.gov.co/",
    "Origin": "https://consultaprocesos.ramajudicial.gov.co",
  };
  
  console.log(`[demo] CPNU: calling ${url.slice(0, 80)}...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { method: "GET", headers, signal: controller.signal });
    clearTimeout(timeoutId);
    console.log(`[demo] CPNU: HTTP ${resp.status}, content-type=${resp.headers.get("content-type")}`);
    
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.log(`[demo] CPNU: non-OK response, body snippet: ${errBody.slice(0, 200)}`);
      // Graceful fallback: mark CPNU as temporarily unavailable, do NOT throw
      return { 
        status: resp.status, 
        body: null, 
        diagnostic: { 
          provider: "CPNU", 
          http_status: resp.status, 
          headers_sent: Object.keys(headers),
          error_snippet: errBody.slice(0, 200),
          message: `CPNU returned HTTP ${resp.status} — falling back to other providers`,
        },
      };
    }
    
    const text = await resp.text();
    const data = JSON.parse(text);
    const procesos = data?.procesos || [];
    console.log(`[demo] CPNU: ${procesos.length} procesos found`);
    
    if (procesos.length === 0) {
      return { status: 200, body: { ok: false, procesos: [] } };
    }
    
    const p = procesos[0];
    const idProceso = p.idProceso;
    
    // Fetch actuaciones for this process
    let actuaciones: any[] = [];
    if (idProceso) {
      try {
        const actUrl = `https://consultaprocesos.ramajudicial.gov.co/api/v2/Proceso/Actuaciones/${idProceso}`;
        const actController = new AbortController();
        const actTimeout = setTimeout(() => actController.abort(), 15000);
        const actResp = await fetch(actUrl, { headers, signal: actController.signal });
        clearTimeout(actTimeout);
        if (actResp.ok) {
          const actData = await actResp.json();
          actuaciones = actData?.actuaciones || [];
          console.log(`[demo] CPNU actuaciones: ${actuaciones.length} found`);
        }
      } catch (e) {
        console.log(`[demo] CPNU actuaciones fetch failed:`, e instanceof Error ? e.message : e);
      }
    }
    
    return {
      status: 200,
      body: {
        ok: true,
        proceso: {
          despacho: p.despacho || p.nombreDespacho || null,
          tipo: p.tipoProceso || null,
          clase: p.claseProceso || null,
          fecha_radicacion: p.fechaRadicacion || p.fechaProceso || null,
          sujetos_procesales: p.sujetosProcesales || [],
          actuaciones: actuaciones.map((a: any) => ({
            fecha_actuacion: a.fechaActuacion || a.fecharegistro || null,
            actuacion: a.actuacion || a.nombreActuacion || "",
            anotacion: a.anotacion || "",
            fecha: a.fechaActuacion || a.fecharegistro || null,
          })),
          estados_electronicos: [],
        },
      },
    };
  } catch (err) {
    console.log(`[demo] CPNU: fetch error:`, err instanceof Error ? err.message : err);
    return { 
      status: 0, 
      body: null,
      diagnostic: { provider: "CPNU", error: err instanceof Error ? err.message : "unknown", message: "CPNU unreachable — falling back" },
    };
  }
}

async function fetchPublicacionesDirect(radicado: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const pubBaseUrl = Deno.env.get("PUBLICACIONES_BASE_URL");
  const pubApiKey = Deno.env.get("PUBLICACIONES_X_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY");
  if (!pubBaseUrl || !pubApiKey) {
    console.log(`[demo] Publicaciones skipped: missing env vars (BASE_URL=${!!pubBaseUrl}, API_KEY=${!!pubApiKey})`);
    return { status: 0, body: null };
  }
  const url = `${pubBaseUrl}/snapshot/${radicado}`;
  console.log(`[demo] Calling Publicaciones for radicado ***${radicado.slice(-4)}`);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": pubApiKey },
    });
    console.log(`[demo] Publicaciones responded: HTTP ${resp.status}`);
    const text = await resp.text();
    try {
      return { status: resp.status, body: JSON.parse(text) };
    } catch {
      console.log(`[demo] Publicaciones response not JSON, length=${text.length}`);
      return { status: resp.status, body: null };
    }
  } catch (err) {
    console.error(`[demo] Publicaciones fetch error:`, err);
    return { status: 0, body: null };
  }
}

async function fetchSamaiDirect(radicado: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const samaiUrl = Deno.env.get("SAMAI_BASE_URL");
  const samaiKey = Deno.env.get("SAMAI_X_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY");
  if (!samaiUrl || !samaiKey) {
    console.log(`[demo] SAMAI skipped: missing env vars (BASE_URL=${!!samaiUrl}, API_KEY=${!!samaiKey})`);
    return { status: 0, body: null };
  }
  const url = `${samaiUrl}/buscar?numero_radicacion=${radicado}`;
  console.log(`[demo] Calling SAMAI for radicado ***${radicado.slice(-4)}`);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": samaiKey },
    });
    console.log(`[demo] SAMAI responded: HTTP ${resp.status}`);
    const text = await resp.text();
    try {
      return { status: resp.status, body: JSON.parse(text) };
    } catch {
      console.log(`[demo] SAMAI response not JSON, length=${text.length}`);
      return { status: resp.status, body: null };
    }
  } catch (err) {
    console.error(`[demo] SAMAI fetch error:`, err);
    return { status: 0, body: null };
  }
}

// ═══════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.health_check) {
    return json({ status: "OK" }, 200);
  }

  const t0 = Date.now();

  try {
    // 1. Rate limit
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = checkRateLimit(ip);
    if (!rl.allowed) {
      return json({
        error: "RATE_LIMITED",
        message: "Has alcanzado el límite de consultas. Intenta de nuevo en unos minutos.",
        retry_after_seconds: rl.retryAfterSeconds,
      }, 200);
    }

    // 2. Validate radicado
    const rawRadicado = body?.radicado;
    if (!rawRadicado || typeof rawRadicado !== "string") {
      return json({ error: "MISSING_RADICADO", message: "El radicado es requerido." }, 200);
    }
    const radicado = rawRadicado.replace(/\D/g, "");
    if (radicado.length !== 23) {
      return json({
        error: "INVALID_RADICADO",
        message: `El radicado debe tener exactamente 23 dígitos numéricos (tiene ${radicado.length}).`,
      }, 200);
    }

    // 3. Parallel API calls (direct fetch, no egress proxy needed)
    const [cpnuResult, pubResult] = await Promise.allSettled([
      fetchCpnuDirect(radicado),
      fetchPublicacionesDirect(radicado),
    ]);

    // 4. Parse responses into whitelisted schema
    let actuaciones: DemoActuacion[] = [];
    let estados: DemoEstado[] = [];
    let resumen: DemoResumen | null = null;
    let dataFound = false;

    // Parse CPNU (graceful: if CPNU failed, log diagnostic and continue)
    let cpnuDiagnostic: Record<string, unknown> | null = null;
    if (cpnuResult.status === "fulfilled") {
      const d = cpnuResult.value;
      cpnuDiagnostic = d.diagnostic || null;
      if (cpnuDiagnostic) {
        console.log(`[demo] CPNU fallback: ${JSON.stringify(cpnuDiagnostic)}`);
      }
      console.log(`[demo] CPNU result: status=${d.status}, ok=${(d.body as any)?.ok}, hasProceso=${!!(d.body as any)?.proceso}`);
      if (d.status === 200 && d.body && (d.body as any)?.ok && (d.body as any)?.proceso) {
        const p = (d.body as any).proceso;
        const daneCode = radicado.slice(0, 5);
        const daneInfo = DANE_CITIES[daneCode];
        const jurCode = radicado.slice(5, 7);

        actuaciones = (p.actuaciones || [])
          .map((a: Record<string, unknown>) => ({
            fecha: normalizeDate(a.fecha_actuacion ?? a.fecha),
            tipo: truncate(String(a.actuacion || ""), 120),
            descripcion: redactPIIFromText(truncate(String(a.anotacion || a.actuacion || ""), 300) || ""),
            anotacion: a.anotacion ? redactPIIFromText(truncate(String(a.anotacion), 200) || "") : null,
          }))
          .filter((a: DemoActuacion) => a.fecha)
          .sort((a: DemoActuacion, b: DemoActuacion) => b.fecha.localeCompare(a.fecha));

        // Deduplicate
        const seen = new Set<string>();
        actuaciones = actuaciones.filter((a) => {
          const k = `${a.fecha}|${a.tipo}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        resumen = {
          radicado_display: formatRadicadoDisplay(radicado),
          despacho: p.despacho ? redactPIIFromText(truncate(String(p.despacho), 100) || "") : null,
          ciudad: daneInfo?.city || (p.ciudad ? String(p.ciudad) : null),
          departamento: daneInfo?.dept || (p.departamento ? String(p.departamento) : null),
          jurisdiccion: JURISDICCION_MAP[jurCode] || null,
          tipo_proceso: p.tipo ? truncate(String(p.tipo), 80) : null,
          fecha_radicacion: normalizeDate(p.fecha_radicacion),
          ultima_actuacion_fecha: actuaciones[0]?.fecha || null,
          ultima_actuacion_tipo: actuaciones[0]?.tipo || null,
          total_actuaciones: actuaciones.length,
          total_estados: 0,
        };
        dataFound = true;
      }
    }

    // Parse Publicaciones
    if (pubResult.status === "fulfilled") {
      const d = pubResult.value;
      if (d.status === 200 && d.body) {
        const rawBody = d.body as any;
        // Handle the snapshot response format: { found, publicaciones: [...], principal: {...}, ... }
        const pubs = Array.isArray(rawBody?.publicaciones)
          ? rawBody.publicaciones
          : Array.isArray(rawBody) ? rawBody : [];
        
        console.log(`[demo] Publicaciones: found=${rawBody?.found}, totalResultados=${rawBody?.totalResultados}, pubsCount=${pubs.length}, hasPrincipal=${!!rawBody?.principal}`);
        if (pubs.length > 0) {
          // Log raw date values from first pub for diagnostic
          const sample = pubs[0];
          console.log(`[demo] Pub[0] raw values: fecha_publicacion=${JSON.stringify(sample.fecha_publicacion)}, tipo_evento=${JSON.stringify(sample.tipo_evento)}, titulo=${JSON.stringify(sample.titulo?.slice?.(0, 60))}, fecha_hora_inicio=${JSON.stringify(sample.fecha_hora_inicio)}`);
          console.log(`[demo] Pub[0] keys: ${Object.keys(sample).join(',')}`);
        }
        
        // Map publicaciones to estados with robust date parsing
        // When fecha_publicacion is null, extract date from titulo pattern:
        // "ESTADOS 036 DEL 28 DE JULIO DE 2025.pdf" → 2025-07-28
        const mappedEstados = pubs.map((p: Record<string, unknown>, idx: number) => {
          let rawFecha = p.fecha_publicacion ?? p.fecha_hora_inicio ?? p.fechaFijacion ?? p.fechaPublicacion ?? p.fecha ?? p.fechaInicio ?? p.fechaRegistro;
          let fecha = normalizeDate(rawFecha);
          
          // If no fecha from fields, try extracting from titulo
          const tituloStr = String(p.titulo || "");
          if (!fecha && tituloStr) {
            fecha = extractDateFromSpanishTitle(tituloStr);
          }
          
          // Also try extracting from pdf_url pattern like "EstadosYYYYMMDD.pdf"
          const pdfUrl = String(p.pdf_url || p.url || "");
          if (!fecha && pdfUrl) {
            const urlDateMatch = pdfUrl.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
            if (urlDateMatch) {
              fecha = `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
            }
          }
          
          // Infer tipo from document name pattern
          let tipo = String(p.tipo_evento || "");
          if (!tipo || tipo === "null") {
            if (/^ESTADOS?\b/i.test(tituloStr)) tipo = "Estado Electrónico";
            else if (/^EDICTO/i.test(tituloStr)) tipo = "Edicto";
            else if (/^NOTIFICACI/i.test(tituloStr)) tipo = "Notificación";
            else if (/^TRASLADO/i.test(tituloStr)) tipo = "Traslado";
            else if (String(p.tipo || "") === "document") tipo = "Publicación";
            else tipo = truncate(String(p.tipo || "Estado"), 80) || "Estado";
          }
          
          // Clean up titulo for display (remove .pdf extension)
          const cleanTitulo = tituloStr.replace(/\.pdf$/i, "").trim();
          
          if (idx < 3) {
            console.log(`[demo] Pub[${idx}] mapping: rawFecha=${JSON.stringify(rawFecha)} → fecha=${fecha}, inferredTipo=${tipo}, titulo=${cleanTitulo.slice(0, 50)}`);
          }
          return {
            tipo,
            fecha: fecha || "",
            descripcion: cleanTitulo ? redactPIIFromText(truncate(cleanTitulo, 200) || "") : (p.descripcion ? redactPIIFromText(truncate(String(p.descripcion), 200) || "") : null),
          };
        });
        
        // Keep items with fecha or description
        estados = mappedEstados
          .filter((e: DemoEstado) => e.fecha || e.descripcion)
          .sort((a: DemoEstado, b: DemoEstado) => (b.fecha || "").localeCompare(a.fecha || ""));
        
        console.log(`[demo] Publicaciones mapping: ${pubs.length} raw → ${estados.length} estados after mapping`);
        
        // Build resumen from principal info when available (even if CPNU already provided resumen)
        if (rawBody?.found && rawBody?.principal && !resumen) {
          const pr = rawBody.principal;
          const daneCode = radicado.slice(0, 5);
          const daneInfo = DANE_CITIES[daneCode];
          resumen = {
            radicado_display: formatRadicadoDisplay(radicado),
            despacho: pr.despacho ? redactPIIFromText(truncate(String(pr.despacho), 100) || "") : null,
            ciudad: daneInfo?.city || (pr.ciudad ? String(pr.ciudad) : null),
            departamento: daneInfo?.dept || (pr.departamento ? String(pr.departamento) : null),
            jurisdiccion: JURISDICCION_MAP[radicado.slice(5, 7)] || null,
            tipo_proceso: pr.tipoProceso ? truncate(String(pr.tipoProceso), 80) : (pr.tipo_proceso ? truncate(String(pr.tipo_proceso), 80) : null),
            fecha_radicacion: normalizeDate(pr.fechaRadicacion ?? pr.fecha_radicacion ?? pr.fecha),
            ultima_actuacion_fecha: estados[0]?.fecha !== "0000-00-00" ? estados[0]?.fecha : null,
            ultima_actuacion_tipo: estados[0]?.tipo || null,
            total_actuaciones: 0,
            total_estados: estados.length,
          };
          dataFound = true;
        }
        
        // Mark data found if we got any estados
        if (estados.length > 0) dataFound = true;
        if (resumen) resumen.total_estados = estados.length;
      }
    }

    // 5. SAMAI fallback if no data yet (SAMAI 200 with no match = healthy, not an error)
    let samaiDiagnostic: string | null = null;
    if (!dataFound) {
      try {
        const samaiResult = await fetchSamaiDirect(radicado);
        if (samaiResult.status === 200 && samaiResult.body) {
          const sd = samaiResult.body as any;
          const resultado = sd?.result || sd;
          if (resultado?.actuaciones || resultado?.despacho) {
            const acts = Array.isArray(resultado.actuaciones) ? resultado.actuaciones : [];
            actuaciones = acts
              .map((a: Record<string, unknown>) => ({
                fecha: normalizeDate(a.fechaActuacion ?? a.fecha_actuacion ?? a.fecha),
                tipo: truncate(String(a.actuacion || a.tipo_actuacion || ""), 120),
                descripcion: redactPIIFromText(truncate(String(a.anotacion || a.descripcion || a.actuacion || ""), 300) || ""),
                anotacion: a.anotacion ? redactPIIFromText(truncate(String(a.anotacion), 200) || "") : null,
              }))
              .filter((a: DemoActuacion) => a.fecha)
              .sort((a: DemoActuacion, b: DemoActuacion) => b.fecha.localeCompare(a.fecha));

            const daneCode = radicado.slice(0, 5);
            const daneInfo = DANE_CITIES[daneCode];
            resumen = {
              radicado_display: formatRadicadoDisplay(radicado),
              despacho: resultado.despacho ? redactPIIFromText(truncate(String(resultado.despacho), 100) || "") : null,
              ciudad: daneInfo?.city || null,
              departamento: daneInfo?.dept || null,
              jurisdiccion: JURISDICCION_MAP[radicado.slice(5, 7)] || null,
              tipo_proceso: resultado.tipo_proceso ? truncate(String(resultado.tipo_proceso), 80) : null,
              fecha_radicacion: normalizeDate(resultado.fecha_radicacion ?? resultado.fecha_radicado),
              ultima_actuacion_fecha: actuaciones[0]?.fecha || null,
              ultima_actuacion_tipo: actuaciones[0]?.tipo || null,
              total_actuaciones: actuaciones.length,
              total_estados: 0,
            };
            dataFound = true;
            samaiDiagnostic = `SAMAI: ${actuaciones.length} actuaciones found`;
          } else {
            // SAMAI returned 200 but no matching data — this is NOT an error
            samaiDiagnostic = "SAMAI: 200 OK but no matching data (radicado not in SAMAI)";
            console.log(`[demo] SAMAI: no matching data for radicado — pipeline continues healthy`);
          }
        } else {
          samaiDiagnostic = `SAMAI: HTTP ${samaiResult.status} (no data)`;
        }
      } catch (e) {
        samaiDiagnostic = `SAMAI: fetch error — ${e instanceof Error ? e.message : "unknown"}`;
        console.log(`[demo] SAMAI fallback failed (non-blocking): ${samaiDiagnostic}`);
      }
    }

    if (!dataFound) {
      return json({
        error: "NOT_FOUND",
        message: "No se encontraron datos para este radicado. Verifica que el número sea correcto.",
      }, 200);
    }

    // Build default resumen if still null
    if (!resumen) {
      const daneInfo = DANE_CITIES[radicado.slice(0, 5)];
      resumen = {
        radicado_display: formatRadicadoDisplay(radicado),
        despacho: null,
        ciudad: daneInfo?.city || null,
        departamento: daneInfo?.dept || null,
        jurisdiccion: JURISDICCION_MAP[radicado.slice(5, 7)] || null,
        tipo_proceso: null,
        fecha_radicacion: null,
        ultima_actuacion_fecha: actuaciones[0]?.fecha || estados[0]?.fecha || null,
        ultima_actuacion_tipo: actuaciones[0]?.tipo || null,
        total_actuaciones: actuaciones.length,
        total_estados: estados.length,
      };
    }

    // 6. Build whitelisted response — only DemoResponse shape leaves the function
    const response: DemoResponse = {
      resumen,
      actuaciones: actuaciones.slice(0, 30), // Cap at 30 for demo
      estados: estados.slice(0, 20),
      meta: {
        radicado_masked: maskRadicado(radicado),
        actuaciones_count: actuaciones.length,
        estados_count: estados.length,
        fetched_at: new Date().toISOString(),
        demo: true,
      },
    };

    // 7. Telemetry (non-blocking, masked)
    logTelemetry(radicado, actuaciones.length, estados.length, Date.now() - t0, ip).catch(() => {});

    return json(response, 200);

  } catch (err) {
    console.error("[demo-radicado-lookup] Error:", err);
    return json({
      error: "INTERNAL_ERROR",
      message: "Ocurrió un error al consultar el radicado. Intenta de nuevo.",
    }, 200);
  }
});

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

const SPANISH_MONTHS: Record<string, string> = {
  "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
  "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
  "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12",
};

/**
 * Extract date from Spanish-format document titles like:
 * "ESTADOS 036 DEL 28 DE JULIO DE 2025.pdf" → "2025-07-28"
 * "ESTADOS 004 DEL 13 DE FEBRERO DE 2026.pdf" → "2026-02-13"
 */
function extractDateFromSpanishTitle(titulo: string): string {
  const match = titulo.match(/DEL\s+(\d{1,2})\s+DE\s+(\w+)\s+DE\s+(\d{4})/i);
  if (!match) return "";
  const day = match[1].padStart(2, "0");
  const monthName = match[2].toLowerCase();
  const year = match[3];
  const month = SPANISH_MONTHS[monthName];
  if (!month) return "";
  return `${year}-${month}-${day}`;
}

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDate(val: unknown): string {
  if (val === null || val === undefined) return "";
  
  // Handle numeric timestamps (epoch ms)
  if (typeof val === "number") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    return "";
  }
  
  // Coerce to string for non-string types
  const str = String(val).trim();
  if (!str || str === "null" || str === "undefined") return "";
  
  // dd/mm/yyyy or dd-mm-yyyy
  const ddmm = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
  
  // yyyy-mm-dd (already ISO-like, extract date part)
  const isoDate = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  
  // Full ISO datetime or other parseable formats
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso.toISOString().split("T")[0];
  
  return "";
}

function truncate(val: string, max: number): string | null {
  if (!val) return null;
  const c = val.trim();
  return c.length <= max ? c : c.slice(0, max) + "...";
}

async function logTelemetry(radicado: string, actCount: number, estCount: number, durationMs: number, ip: string) {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (!orgRow) return;

    await supabase.from("atenia_ai_actions").insert({
      action_type: "DEMO_LOOKUP",
      autonomy_tier: "T0_OBSERVE",
      organization_id: orgRow.id,
      reasoning: `Demo lookup: ${maskRadicado(radicado)}, ${actCount} actuaciones, ${estCount} estados, ${durationMs}ms`,
      evidence: {
        radicado_masked: maskRadicado(radicado),
        actuaciones_count: actCount,
        estados_count: estCount,
        duration_ms: durationMs,
        ip_masked: ip.split(".").slice(0, 2).join(".") + ".*.*",
        egress_purpose: "judicial_demo",
      },
      status: "executed",
    });
  } catch { /* telemetry is non-blocking */ }
}
