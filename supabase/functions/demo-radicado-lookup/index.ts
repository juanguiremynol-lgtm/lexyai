/**
 * demo-radicado-lookup — Public demo edge function
 * 
 * Zero-auth, zero-DB-write lookup for the landing page "Prueba Andromeda" experience.
 * All external calls route through direct fetch with purpose "judicial_demo".
 * 
 * Provider Registry:
 * - CPNU (actuaciones + basic metadata)
 * - SAMAI (actuaciones + basic metadata)
 * - Publicaciones Procesales (estados)
 * - Tutelas API (actuaciones + estados + metadata)
 * - SAMAI Estados (estados)
 * 
 * Adding a new provider: add an entry to DEMO_PROVIDER_REGISTRY. It will
 * automatically be included in every demo lookup fan-out.
 * 
 * Security:
 * - Rate limit: 5 req / IP / 10 min (in-memory)
 * - PII redaction on all returned text
 * - No DB rows created (telemetry only via atenia_ai_actions)
 * - Masked radicado in all logs
 * - Whitelisted response schema only
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseCpnuSujetos } from "../_shared/partyNormalization.ts";

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
const WINDOW_MS = 10 * 60 * 1000;

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
// TYPES
// ═══════════════════════════════════════════

type FoundStatus = "FOUND_COMPLETE" | "FOUND_PARTIAL" | "NOT_FOUND";
type ProviderOutcome = "success" | "no-data" | "error" | "timeout" | "skipped";

interface ProviderResult {
  provider: string;
  outcome: ProviderOutcome;
  found_status: FoundStatus;
  latency_ms: number;
  actuaciones: DemoActuacion[];
  estados: DemoEstado[];
  metadata: ProviderMetadata | null;
  parties: { demandante: string | null; demandado: string | null } | null;
  error?: string;
}

interface ProviderMetadata {
  despacho?: string | null;
  tipo_proceso?: string | null;
  fecha_radicacion?: string | null;
  ciudad?: string | null;
  departamento?: string | null;
}

interface DemoActuacion {
  fecha: string;
  tipo: string | null;
  descripcion: string;
  anotacion: string | null;
  sources: string[];  // provenance: which providers contributed
}

interface DemoEstado {
  tipo: string;
  fecha: string;
  descripcion: string | null;
  sources: string[];  // provenance
}

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
  demandante: string | null;
  demandado: string | null;
}

interface CategoryInference {
  category: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  signals: string[];
}

// Party parsing delegated to _shared/partyNormalization.ts
function parseSujetosString(raw: unknown): { demandante: string | null; demandado: string | null } {
  const result = parseCpnuSujetos(raw);
  return { demandante: result.demandante || null, demandado: result.demandado || null };
}

// ═══════════════════════════════════════════
// PROVIDER REGISTRY — add new providers here
// ═══════════════════════════════════════════

interface ProviderConfig {
  name: string;
  label: string;        // Human-friendly label for UI
  provides: ("actuaciones" | "estados" | "metadata")[];
  envBaseUrl: string;
  envApiKey: string[];   // Try these env vars in order for the API key
  fetchFn: (radicado: string, baseUrl: string, apiKey: string) => Promise<ProviderResult>;
}

const DEMO_PROVIDER_REGISTRY: ProviderConfig[] = [
  {
    name: "CPNU",
    label: "Consulta Nacional de Procesos",
    provides: ["actuaciones", "metadata"],
    envBaseUrl: "CPNU_BASE_URL", // Not used for CPNU (hardcoded endpoints)
    envApiKey: [],               // No API key needed
    fetchFn: fetchCpnu,
  },
  {
    name: "SAMAI",
    label: "Sistema de Gestión SAMAI",
    provides: ["actuaciones", "metadata"],
    envBaseUrl: "SAMAI_BASE_URL",
    envApiKey: ["SAMAI_X_API_KEY", "EXTERNAL_X_API_KEY"],
    fetchFn: fetchSamai,
  },
  {
    name: "Publicaciones",
    label: "Publicaciones Procesales",
    provides: ["estados"],
    envBaseUrl: "PUBLICACIONES_BASE_URL",
    envApiKey: ["PUBLICACIONES_X_API_KEY", "EXTERNAL_X_API_KEY"],
    fetchFn: fetchPublicaciones,
  },
  {
    name: "Tutelas",
    label: "API de Tutelas",
    provides: ["actuaciones", "estados", "metadata"],
    envBaseUrl: "TUTELAS_BASE_URL",
    envApiKey: ["TUTELAS_X_API_KEY", "EXTERNAL_X_API_KEY"],
    fetchFn: fetchTutelas,
  },
  {
    name: "SAMAI Estados",
    label: "SAMAI Estados Electrónicos",
    provides: ["estados"],
    envBaseUrl: "SAMAI_ESTADOS_BASE_URL",
    envApiKey: ["SAMAI_ESTADOS_API_KEY", "EXTERNAL_X_API_KEY"],
    fetchFn: fetchSamaiEstados,
  },
];

function resolveApiKey(envKeys: string[]): string | null {
  for (const key of envKeys) {
    const val = Deno.env.get(key);
    if (val) return val;
  }
  return null;
}

// ═══════════════════════════════════════════
// PROVIDER FETCH IMPLEMENTATIONS
// ═══════════════════════════════════════════

async function fetchCpnu(radicado: string, _baseUrl: string, _apiKey: string): Promise<ProviderResult> {
  const t0 = Date.now();
  const provider = "CPNU";
  const headers: Record<string, string> = {
    "Accept": "application/json, text/json, text/plain, */*",
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://consultaprocesos.ramajudicial.gov.co/",
    "Origin": "https://consultaprocesos.ramajudicial.gov.co",
  };

  const searchCandidates = [
    { url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`, method: "GET", desc: "v2 standard" },
    { url: `https://consultaprocesos.ramajudicial.gov.co:443/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`, method: "GET", desc: "v2 port 443" },
    { url: `https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`, method: "GET", desc: "v2 port 448" },
    { url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Procesos/Consulta/NumeroRadicacion`, method: "POST", body: JSON.stringify({ numero: radicado, SoloActivos: false, pagina: 1 }), desc: "v2 POST" },
    { url: `https://consultaprocesos.ramajudicial.gov.co/api/v1/Procesos/Consulta/NumeroRadicacion?numero=${radicado}`, method: "GET", desc: "v1 legacy" },
  ];

  for (const candidate of searchCandidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const fetchOpts: RequestInit = { method: candidate.method, headers, signal: controller.signal };
      if ((candidate as any).body) fetchOpts.body = (candidate as any).body;
      const resp = await fetch(candidate.url, fetchOpts);
      clearTimeout(timeoutId);

      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("json") && !ct.includes("text/plain")) continue;
      if (!resp.ok) continue;

      const data = await resp.json();
      const procesos = data?.procesos || [];
      if (procesos.length === 0) {
        return { provider, outcome: "no-data", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null };
      }

      const p = procesos[0];
      const idProceso = p.idProceso;

      // Fetch actuaciones
      let rawActs: any[] = [];
      if (idProceso) {
        const actCandidates = [
          `https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Proceso/Actuaciones/${idProceso}`,
          `https://consultaprocesos.ramajudicial.gov.co/api/v2/Proceso/Actuaciones/${idProceso}`,
          `https://consultaprocesos.ramajudicial.gov.co:443/api/v2/Proceso/Actuaciones/${idProceso}`,
        ];
        for (const actUrl of actCandidates) {
          try {
            const ac = new AbortController();
            const at = setTimeout(() => ac.abort(), 12000);
            const actResp = await fetch(actUrl, { headers, signal: ac.signal });
            clearTimeout(at);
            if (actResp.ok && (actResp.headers.get("content-type") || "").includes("json")) {
              const actData = await actResp.json();
              rawActs = actData?.actuaciones || [];
              break;
            }
          } catch { /* try next */ }
        }
      }

      const actuaciones: DemoActuacion[] = rawActs
        .map((a: any) => ({
          fecha: normalizeDate(a.fechaActuacion ?? a.fecha),
          tipo: truncate(String(a.actuacion || ""), 120),
          descripcion: redactPIIFromText(truncate(String(a.anotacion || a.actuacion || ""), 300) || ""),
          anotacion: a.anotacion ? redactPIIFromText(truncate(String(a.anotacion), 200) || "") : null,
          sources: [provider],
        }))
        .filter((a: DemoActuacion) => a.fecha)
        .sort((a: DemoActuacion, b: DemoActuacion) => b.fecha.localeCompare(a.fecha));

      const parsedParties = parseSujetosString(p.sujetosProcesales);
      const demandante = parsedParties.demandante || (typeof p.demandante === 'string' ? p.demandante.trim().replace(/\.+$/, '') : null);
      const demandado = parsedParties.demandado || (typeof p.demandado === 'string' ? p.demandado.trim().replace(/\.+$/, '') : null);

      return {
        provider,
        outcome: "success",
        found_status: actuaciones.length > 0 ? "FOUND_COMPLETE" : "FOUND_PARTIAL",
        latency_ms: Date.now() - t0,
        actuaciones,
        estados: [],
        metadata: {
          despacho: p.despacho || p.nombreDespacho || null,
          tipo_proceso: p.tipoProceso || null,
          fecha_radicacion: p.fechaRadicacion || p.fechaProceso || null,
        },
        parties: { demandante, demandado },
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { provider, outcome: "timeout", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: "Timeout" };
      }
      continue;
    }
  }

  return { provider, outcome: "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: "All candidates exhausted" };
}

async function fetchSamai(radicado: string, baseUrl: string, apiKey: string): Promise<ProviderResult> {
  const t0 = Date.now();
  const provider = "SAMAI";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(`${baseUrl}/buscar?numero_radicacion=${radicado}`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { provider, outcome: resp.status === 404 ? "no-data" : "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: `HTTP ${resp.status}` };
    }

    const raw = await resp.json();
    const resultado = raw?.result || raw;
    if (!resultado?.actuaciones && !resultado?.despacho) {
      return { provider, outcome: "no-data", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null };
    }

    const acts = Array.isArray(resultado.actuaciones) ? resultado.actuaciones : [];
    const actuaciones: DemoActuacion[] = acts
      .map((a: any) => ({
        fecha: normalizeDate(a.fechaActuacion ?? a.fecha_actuacion ?? a.fecha),
        tipo: truncate(String(a.actuacion || a.tipo_actuacion || ""), 120),
        descripcion: redactPIIFromText(truncate(String(a.anotacion || a.descripcion || a.actuacion || ""), 300) || ""),
        anotacion: a.anotacion ? redactPIIFromText(truncate(String(a.anotacion), 200) || "") : null,
        sources: [provider],
      }))
      .filter((a: DemoActuacion) => a.fecha);

    return {
      provider,
      outcome: "success",
      found_status: actuaciones.length > 0 ? "FOUND_COMPLETE" : (resultado.despacho ? "FOUND_PARTIAL" : "NOT_FOUND"),
      latency_ms: Date.now() - t0,
      actuaciones,
      estados: [],
      metadata: {
        despacho: resultado.despacho ? redactPIIFromText(truncate(String(resultado.despacho), 100) || "") : null,
        tipo_proceso: resultado.tipo_proceso ? truncate(String(resultado.tipo_proceso), 80) : null,
        fecha_radicacion: normalizeDate(resultado.fecha_radicacion ?? resultado.fecha_radicado),
      },
      parties: null,
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return { provider, outcome: isTimeout ? "timeout" : "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: isTimeout ? "Timeout" : String(err) };
  }
}

async function fetchPublicaciones(radicado: string, baseUrl: string, apiKey: string): Promise<ProviderResult> {
  const t0 = Date.now();
  const provider = "Publicaciones";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(`${baseUrl}/snapshot/${radicado}`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { provider, outcome: resp.status === 404 ? "no-data" : "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: `HTTP ${resp.status}` };
    }

    const rawBody = await resp.json();
    const pubs = Array.isArray(rawBody?.publicaciones) ? rawBody.publicaciones : (Array.isArray(rawBody) ? rawBody : []);

    const estados: DemoEstado[] = pubs
      .map((p: any) => {
        let fecha = normalizeDate(p.fecha_publicacion ?? p.fecha_hora_inicio ?? p.fechaFijacion ?? p.fechaPublicacion ?? p.fecha ?? p.fechaInicio ?? p.fechaRegistro);
        const tituloStr = String(p.titulo || "");
        if (!fecha && tituloStr) fecha = extractDateFromSpanishTitle(tituloStr);
        const pdfUrl = String(p.pdf_url || p.url || "");
        if (!fecha && pdfUrl) {
          const m = pdfUrl.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
          if (m) fecha = `${m[1]}-${m[2]}-${m[3]}`;
        }
        let tipo = String(p.tipo_evento || "");
        if (!tipo || tipo === "null") {
          if (/^ESTADOS?\b/i.test(tituloStr)) tipo = "Estado Electrónico";
          else if (/^EDICTO/i.test(tituloStr)) tipo = "Edicto";
          else if (/^NOTIFICACI/i.test(tituloStr)) tipo = "Notificación";
          else if (/^TRASLADO/i.test(tituloStr)) tipo = "Traslado";
          else tipo = truncate(String(p.tipo || "Estado"), 80) || "Estado";
        }
        const cleanTitulo = tituloStr.replace(/\.pdf$/i, "").trim();
        return {
          tipo,
          fecha: fecha || "",
          descripcion: cleanTitulo ? redactPIIFromText(truncate(cleanTitulo, 200) || "") : (p.descripcion ? redactPIIFromText(truncate(String(p.descripcion), 200) || "") : null),
          sources: [provider],
        };
      })
      .filter((e: DemoEstado) => e.fecha || e.descripcion);

    let metadata: ProviderMetadata | null = null;
    if (rawBody?.found && rawBody?.principal) {
      const pr = rawBody.principal;
      metadata = {
        despacho: pr.despacho ? redactPIIFromText(truncate(String(pr.despacho), 100) || "") : null,
        tipo_proceso: pr.tipoProceso || pr.tipo_proceso || null,
        fecha_radicacion: normalizeDate(pr.fechaRadicacion ?? pr.fecha_radicacion ?? pr.fecha),
      };
    }

    return {
      provider,
      outcome: estados.length > 0 ? "success" : "no-data",
      found_status: estados.length > 0 ? "FOUND_COMPLETE" : "NOT_FOUND",
      latency_ms: Date.now() - t0,
      actuaciones: [],
      estados,
      metadata,
      parties: null,
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return { provider, outcome: isTimeout ? "timeout" : "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: isTimeout ? "Timeout" : String(err) };
  }
}

async function fetchTutelas(radicado: string, baseUrl: string, apiKey: string): Promise<ProviderResult> {
  const t0 = Date.now();
  const provider = "Tutelas";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // longer timeout for async job
    const resp = await fetch(`${baseUrl}/search`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ radicado }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      if (resp.status === 404) {
        return { provider, outcome: "no-data", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null };
      }
      return { provider, outcome: "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: `HTTP ${resp.status}` };
    }

    let result = await resp.json();

    // Handle async job polling
    if ((result.status === "pending" || result.status === "processing") && (result.job_id || result.jobId)) {
      const jobId = result.job_id || result.jobId;
      console.log(`[demo] Tutelas async job: ${jobId}`);
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(r => setTimeout(r, 2500));
        try {
          const pollResp = await fetch(`${baseUrl}/job/${jobId}`, {
            method: "GET",
            headers: { "x-api-key": apiKey },
          });
          if (pollResp.ok) {
            const pollData = await pollResp.json();
            if (pollData.status === "completed" || pollData.status === "done" || pollData.data) {
              result = pollData.data || pollData;
              break;
            }
          }
        } catch { /* continue polling */ }
      }
    }

    // Extract actuaciones
    const rawActs = Array.isArray(result?.actuaciones) ? result.actuaciones : [];
    const actuaciones: DemoActuacion[] = rawActs
      .map((a: any) => ({
        fecha: normalizeDate(a.fechaActuacion ?? a.fecha_actuacion ?? a.fecha),
        tipo: truncate(String(a.actuacion || a.tipo || ""), 120),
        descripcion: redactPIIFromText(truncate(String(a.anotacion || a.descripcion || a.actuacion || ""), 300) || ""),
        anotacion: a.anotacion ? redactPIIFromText(truncate(String(a.anotacion), 200) || "") : null,
        sources: [provider],
      }))
      .filter((a: DemoActuacion) => a.fecha);

    // Extract estados
    const rawEstados = Array.isArray(result?.estados) ? result.estados : [];
    const estados: DemoEstado[] = rawEstados
      .map((e: any) => ({
        tipo: truncate(String(e.tipo || e.actuacion || "Estado"), 120) || "Estado",
        fecha: normalizeDate(e.fecha || e.fechaEstado || e.fechaProvidencia),
        descripcion: e.descripcion ? redactPIIFromText(truncate(String(e.descripcion), 200) || "") : null,
        sources: [provider],
      }))
      .filter((e: DemoEstado) => e.fecha || e.descripcion);

    const hasData = actuaciones.length > 0 || estados.length > 0 || result?.despacho;
    let metadata: ProviderMetadata | null = null;
    if (result?.despacho || result?.tipo_proceso) {
      metadata = {
        despacho: result.despacho ? redactPIIFromText(truncate(String(result.despacho), 100) || "") : null,
        tipo_proceso: result.tipo_proceso || null,
        fecha_radicacion: normalizeDate(result.fecha_radicacion),
      };
    }

    // Extract parties if available
    let parties: { demandante: string | null; demandado: string | null } | null = null;
    if (result?.demandante || result?.demandado || result?.accionante || result?.accionado) {
      parties = {
        demandante: result.demandante || result.accionante || null,
        demandado: result.demandado || result.accionado || null,
      };
    }

    return {
      provider,
      outcome: hasData ? "success" : "no-data",
      found_status: actuaciones.length > 0 || estados.length > 0 ? "FOUND_COMPLETE" : (metadata ? "FOUND_PARTIAL" : "NOT_FOUND"),
      latency_ms: Date.now() - t0,
      actuaciones,
      estados,
      metadata,
      parties,
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return { provider, outcome: isTimeout ? "timeout" : "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: isTimeout ? "Timeout" : String(err) };
  }
}

async function fetchSamaiEstados(radicado: string, baseUrl: string, apiKey: string): Promise<ProviderResult> {
  const t0 = Date.now();
  const provider = "SAMAI Estados";
  try {
    const formatted = radicado.length === 23
      ? `${radicado.slice(0, 2)}-${radicado.slice(2, 5)}-${radicado.slice(5, 7)}-${radicado.slice(7, 9)}-${radicado.slice(9, 12)}-${radicado.slice(12, 16)}-${radicado.slice(16, 21)}-${radicado.slice(21, 23)}`
      : radicado;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(`${baseUrl}/buscar?radicado=${encodeURIComponent(formatted)}`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { provider, outcome: resp.status === 404 ? "no-data" : "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: `HTTP ${resp.status}` };
    }

    const raw = await resp.json();
    const resultado = raw?.result || raw;
    const rawEstados = Array.isArray(resultado?.estados) ? resultado.estados : [];

    const estados: DemoEstado[] = rawEstados
      .map((e: any) => {
        const fecha = normalizeDate(e["Fecha Providencia"] ?? e["Fecha Estado"] ?? e.fechaProvidencia ?? e.fechaEstado ?? e.fecha ?? "");
        const actuacion = String(e["Actuación"] ?? e.actuacion ?? e.tipo ?? "");
        const anotacion = String(e["Anotación"] ?? e.anotacion ?? e.descripcion ?? "");
        return {
          tipo: actuacion ? truncate(actuacion, 120) || "Estado SAMAI" : "Estado SAMAI",
          fecha: fecha || "",
          descripcion: anotacion ? redactPIIFromText(truncate(anotacion, 200) || "") : (actuacion ? redactPIIFromText(truncate(actuacion, 200) || "") : null),
          sources: [provider],
        };
      })
      .filter((e: DemoEstado) => e.fecha || e.descripcion);

    return {
      provider,
      outcome: estados.length > 0 ? "success" : "no-data",
      found_status: estados.length > 0 ? "FOUND_COMPLETE" : "NOT_FOUND",
      latency_ms: Date.now() - t0,
      actuaciones: [],
      estados,
      metadata: null,
      parties: null,
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return { provider, outcome: isTimeout ? "timeout" : "error", found_status: "NOT_FOUND", latency_ms: Date.now() - t0, actuaciones: [], estados: [], metadata: null, parties: null, error: isTimeout ? "Timeout" : String(err) };
  }
}

// ═══════════════════════════════════════════
// CATEGORY INFERENCE (demo-only scoring)
// ═══════════════════════════════════════════

function inferCategory(results: ProviderResult[], radicado: string): CategoryInference {
  const signals: string[] = [];
  const scores: Record<string, number> = { CGP: 0, CPACA: 0, TUTELA: 0, LABORAL: 0, PENAL_906: 0 };

  // Provider-based scoring
  for (const r of results) {
    if (r.found_status === "NOT_FOUND") continue;
    const weight = r.found_status === "FOUND_COMPLETE" ? 2 : 1;

    if (r.provider === "Tutelas" && r.outcome === "success") {
      scores.TUTELA += 3 * weight;
      signals.push(`${r.provider} returned data (strong tutela signal)`);
    }
    if (r.provider === "SAMAI Estados" && r.outcome === "success") {
      scores.CPACA += 2 * weight;
      signals.push(`${r.provider} returned data (CPACA signal)`);
    }
    if (r.provider === "SAMAI" && r.outcome === "success") {
      scores.CPACA += 1 * weight;
      signals.push(`${r.provider} returned data`);
    }
    if (r.provider === "CPNU" && r.outcome === "success") {
      scores.CGP += 1; // CPNU hits many categories, weak signal alone
    }
  }

  // Metadata-based scoring
  for (const r of results) {
    if (!r.metadata) continue;
    const despacho = (r.metadata.despacho || "").toLowerCase();
    const tipoProceso = (r.metadata.tipo_proceso || "").toLowerCase();

    if (despacho.includes("administrativo") || despacho.includes("contencioso") || despacho.includes("consejo de estado")) {
      scores.CPACA += 3;
      signals.push(`Despacho: ${r.metadata.despacho} (administrativo)`);
    }
    if (despacho.includes("laboral") || tipoProceso.includes("laboral")) {
      scores.LABORAL += 3;
      signals.push(`Despacho/tipo: laboral`);
    }
    if (despacho.includes("penal") || tipoProceso.includes("penal") || tipoProceso.includes("906")) {
      scores.PENAL_906 += 3;
      signals.push(`Despacho/tipo: penal`);
    }
    if (despacho.includes("civil") || despacho.includes("familia") || despacho.includes("promiscuo")) {
      scores.CGP += 2;
      signals.push(`Despacho: ${r.metadata.despacho}`);
    }
  }

  // Actuaciones text scanning for tutela keywords
  for (const r of results) {
    for (const act of r.actuaciones) {
      const text = [act.tipo, act.descripcion].join(" ").toLowerCase();
      if (text.includes("tutela") || text.includes("acción de tutela") || text.includes("auto admite tutela")) {
        scores.TUTELA += 2;
        signals.push("Tutela keyword found in actuaciones");
        break;
      }
    }
  }

  // Radicado jurisdiccion code
  const jurCode = radicado.slice(5, 7);
  if (jurCode === "33") { scores.CPACA += 1; signals.push("Jurisdicción code 33 (Administrativo)"); }
  if (jurCode === "40") { scores.PENAL_906 += 1; signals.push("Jurisdicción code 40 (Penal)"); }
  if (jurCode === "41") { scores.LABORAL += 1; signals.push("Jurisdicción code 41 (Laboral)"); }

  // Find winner
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topCat, topScore] = entries[0];
  const [, secondScore] = entries[1] || [null, 0];

  if (topScore === 0) {
    return { category: "DESCONOCIDA", confidence: "LOW", signals: ["Sin señales suficientes"] };
  }

  const confidence = topScore >= 5 ? "HIGH" : (topScore >= 3 && topScore > secondScore * 1.5 ? "MEDIUM" : "LOW");
  return { category: topCat, confidence, signals };
}

// ═══════════════════════════════════════════
// SMART MERGE + DEDUPE
// ═══════════════════════════════════════════

function dedupeActuaciones(all: DemoActuacion[]): DemoActuacion[] {
  // Sort newest first
  all.sort((a, b) => b.fecha.localeCompare(a.fecha));

  const merged: DemoActuacion[] = [];
  const keyMap = new Map<string, number>(); // normalized key → index in merged

  for (const act of all) {
    // Primary key: date + first 60 chars of tipo (normalized)
    const tipoNorm = (act.tipo || "").toLowerCase().replace(/[\s\-–—]+/g, " ").trim().slice(0, 60);
    const key = `${act.fecha}|${tipoNorm}`;

    const existingIdx = keyMap.get(key);
    if (existingIdx !== undefined) {
      // Merge provenance
      const existing = merged[existingIdx];
      for (const src of act.sources) {
        if (!existing.sources.includes(src)) existing.sources.push(src);
      }
      // Prefer richer description
      if (act.descripcion.length > existing.descripcion.length) {
        existing.descripcion = act.descripcion;
      }
      if (act.anotacion && (!existing.anotacion || act.anotacion.length > existing.anotacion.length)) {
        existing.anotacion = act.anotacion;
      }
    } else {
      keyMap.set(key, merged.length);
      merged.push({ ...act, sources: [...act.sources] });
    }
  }

  return merged;
}

function dedupeEstados(all: DemoEstado[]): DemoEstado[] {
  all.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  const merged: DemoEstado[] = [];
  const keyMap = new Map<string, number>();

  for (const est of all) {
    const tipoNorm = (est.tipo || "").toLowerCase().replace(/[\s\-–—]+/g, " ").trim().slice(0, 40);
    const key = `${est.fecha}|${tipoNorm}`;

    const existingIdx = keyMap.get(key);
    if (existingIdx !== undefined) {
      const existing = merged[existingIdx];
      for (const src of est.sources) {
        if (!existing.sources.includes(src)) existing.sources.push(src);
      }
      if (est.descripcion && (!existing.descripcion || est.descripcion.length > (existing.descripcion?.length || 0))) {
        existing.descripcion = est.descripcion;
      }
    } else {
      keyMap.set(key, merged.length);
      merged.push({ ...est, sources: [...est.sources] });
    }
  }

  return merged;
}

// ═══════════════════════════════════════════
// METADATA MERGE (best-available)
// ═══════════════════════════════════════════

function mergeMetadata(results: ProviderResult[], radicado: string): { resumen: DemoResumen; conflicts: MetadataConflict[] } {
  const daneCode = radicado.slice(0, 5);
  const daneInfo = DANE_CITIES[daneCode];
  const jurCode = radicado.slice(5, 7);

  let despacho: string | null = null;
  let tipo_proceso: string | null = null;
  let fecha_radicacion: string | null = null;
  let demandante: string | null = null;
  let demandado: string | null = null;
  const conflicts: MetadataConflict[] = [];

  // Collect all non-null values per field to detect conflicts
  const despachoValues: { value: string; provider: string }[] = [];
  const partyValues: { demandante: string | null; demandado: string | null; provider: string }[] = [];

  for (const r of results) {
    if (r.metadata?.despacho) {
      despachoValues.push({ value: r.metadata.despacho, provider: r.provider });
      if (!despacho) despacho = r.metadata.despacho;
    }
    if (r.metadata?.tipo_proceso && !tipo_proceso) tipo_proceso = r.metadata.tipo_proceso;
    if (r.metadata?.fecha_radicacion && !fecha_radicacion) fecha_radicacion = r.metadata.fecha_radicacion;
    if (r.parties) {
      partyValues.push({ ...r.parties, provider: r.provider });
      if (r.parties.demandante && !demandante) demandante = r.parties.demandante;
      if (r.parties.demandado && !demandado) demandado = r.parties.demandado;
    }
  }

  // Detect despacho conflicts
  const uniqueDespachos = [...new Set(despachoValues.map(d => d.value.toLowerCase().trim()))];
  if (uniqueDespachos.length > 1) {
    conflicts.push({
      field: "despacho",
      variants: despachoValues.map(d => ({ value: d.value, provider: d.provider })),
    });
  }

  // Detect party conflicts
  const uniqueDemandantes = [...new Set(partyValues.map(p => p.demandante?.toLowerCase().trim()).filter(Boolean))];
  if (uniqueDemandantes.length > 1) {
    conflicts.push({
      field: "demandante",
      variants: partyValues.filter(p => p.demandante).map(p => ({ value: p.demandante!, provider: p.provider })),
    });
  }

  // Collect all actuaciones and estados for totals
  const allActs: DemoActuacion[] = [];
  const allEstados: DemoEstado[] = [];
  for (const r of results) {
    allActs.push(...r.actuaciones);
    allEstados.push(...r.estados);
  }

  const resumen: DemoResumen = {
    radicado_display: formatRadicadoDisplay(radicado),
    despacho,
    ciudad: daneInfo?.city || null,
    departamento: daneInfo?.dept || null,
    jurisdiccion: JURISDICCION_MAP[jurCode] || null,
    tipo_proceso,
    fecha_radicacion,
    ultima_actuacion_fecha: null, // will be set after dedupe
    ultima_actuacion_tipo: null,
    total_actuaciones: 0,
    total_estados: 0,
    demandante,
    demandado,
  };

  return { resumen, conflicts };
}

interface MetadataConflict {
  field: string;
  variants: { value: string; provider: string }[];
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
      return json({ error: "INVALID_RADICADO", message: `El radicado debe tener exactamente 23 dígitos numéricos (tiene ${radicado.length}).` }, 200);
    }

    // 3. Fan-out to ALL registered providers in parallel
    const providerPromises = DEMO_PROVIDER_REGISTRY.map(async (config) => {
      const baseUrl = config.envBaseUrl ? Deno.env.get(config.envBaseUrl) : null;
      const apiKey = resolveApiKey(config.envApiKey);

      // CPNU doesn't need baseUrl/apiKey
      if (config.name !== "CPNU" && (!baseUrl || !apiKey)) {
        console.log(`[demo] ${config.name} skipped: missing config (BASE_URL=${!!baseUrl}, API_KEY=${!!apiKey})`);
        return {
          provider: config.name,
          outcome: "skipped" as ProviderOutcome,
          found_status: "NOT_FOUND" as FoundStatus,
          latency_ms: 0,
          actuaciones: [],
          estados: [],
          metadata: null,
          parties: null,
          error: "Not configured",
        } as ProviderResult;
      }

      try {
        return await config.fetchFn(radicado, baseUrl || "", apiKey || "");
      } catch (err) {
        console.error(`[demo] ${config.name} uncaught error:`, err);
        return {
          provider: config.name,
          outcome: "error" as ProviderOutcome,
          found_status: "NOT_FOUND" as FoundStatus,
          latency_ms: 0,
          actuaciones: [],
          estados: [],
          metadata: null,
          parties: null,
          error: String(err),
        } as ProviderResult;
      }
    });

    const results = await Promise.all(providerPromises);

    // Log outcomes
    for (const r of results) {
      console.log(`[demo] ${r.provider}: outcome=${r.outcome}, found=${r.found_status}, acts=${r.actuaciones.length}, estados=${r.estados.length}, latency=${r.latency_ms}ms${r.error ? `, error=${r.error}` : ""}`);
    }

    // 4. Collect and dedupe all actuaciones + estados
    const allActs: DemoActuacion[] = [];
    const allEstados: DemoEstado[] = [];
    for (const r of results) {
      allActs.push(...r.actuaciones);
      allEstados.push(...r.estados);
    }

    const actuaciones = dedupeActuaciones(allActs);
    const estados = dedupeEstados(allEstados);

    // 5. Check if any data was found
    const sourcesWithData = results.filter(r => r.outcome === "success");
    const dataFound = sourcesWithData.length > 0 || actuaciones.length > 0 || estados.length > 0;

    if (!dataFound) {
      return json({
        error: "NOT_FOUND",
        message: "No se encontraron datos para este radicado. Verifica que el número sea correcto.",
        meta: {
          providers_checked: results.length,
          providers_with_data: 0,
          provider_outcomes: results.map(r => ({
            name: r.provider,
            outcome: r.outcome,
            latency_ms: r.latency_ms,
          })),
        },
      }, 200);
    }

    // 6. Merge metadata + detect conflicts
    const { resumen, conflicts } = mergeMetadata(results, radicado);
    resumen.total_actuaciones = actuaciones.length;
    resumen.total_estados = estados.length;
    resumen.ultima_actuacion_fecha = actuaciones[0]?.fecha || estados[0]?.fecha || null;
    resumen.ultima_actuacion_tipo = actuaciones[0]?.tipo || null;

    // 7. Category inference
    const categoryInference = inferCategory(results, radicado);

    // 8. Build provider outcomes for response
    const providerOutcomes = results.map(r => ({
      name: r.provider,
      label: DEMO_PROVIDER_REGISTRY.find(p => p.name === r.provider)?.label || r.provider,
      outcome: r.outcome,
      found_status: r.found_status,
      latency_ms: r.latency_ms,
      actuaciones_count: r.actuaciones.length,
      estados_count: r.estados.length,
    }));

    // 9. Build response
    const response = {
      resumen,
      actuaciones: actuaciones.slice(0, 50),
      estados: estados.slice(0, 30),
      category_inference: categoryInference,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      meta: {
        radicado_masked: maskRadicado(radicado),
        actuaciones_count: actuaciones.length,
        estados_count: estados.length,
        sources: sourcesWithData.map(r => r.provider),
        providers_checked: results.length,
        providers_with_data: sourcesWithData.length,
        provider_outcomes: providerOutcomes,
        fetched_at: new Date().toISOString(),
        demo: true,
      },
    };

    // 10. Telemetry (non-blocking)
    logTelemetry(radicado, actuaciones.length, estados.length, Date.now() - t0, ip, sourcesWithData.map(r => r.provider), providerOutcomes).catch(() => {});

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
  if (typeof val === "number") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    return "";
  }
  const str = String(val).trim();
  if (!str || str === "null" || str === "undefined") return "";
  const ddmm = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
  const isoDate = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso.toISOString().split("T")[0];
  return "";
}

function truncate(val: string, max: number): string | null {
  if (!val) return null;
  const c = val.trim();
  return c.length <= max ? c : c.slice(0, max) + "...";
}

async function logTelemetry(radicado: string, actCount: number, estCount: number, durationMs: number, ip: string, sources: string[], providerOutcomes: any[]) {
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
      reasoning: `Demo lookup: ${maskRadicado(radicado)}, ${actCount} actuaciones, ${estCount} estados, ${durationMs}ms, sources: ${sources.join(",")}`,
      evidence: {
        radicado_masked: maskRadicado(radicado),
        actuaciones_count: actCount,
        estados_count: estCount,
        duration_ms: durationMs,
        sources,
        provider_outcomes: providerOutcomes,
        ip_masked: ip.split(".").slice(0, 2).join(".") + ".*.*",
        egress_purpose: "judicial_demo",
      },
      status: "executed",
    });
  } catch { /* telemetry is non-blocking */ }
}
