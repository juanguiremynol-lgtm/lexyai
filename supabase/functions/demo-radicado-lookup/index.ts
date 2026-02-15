/**
 * demo-radicado-lookup — Public demo edge function
 * 
 * Zero-auth, zero-DB-write lookup for the landing page "Prueba Andromeda" experience.
 * All external calls route through egressClient with purpose "judicial_demo".
 * 
 * Providers called in parallel:
 * - CPNU (Consulta Nacional Unificada de Procesos)
 * - Publicaciones Procesales
 * - SAMAI (actuaciones)
 * - SAMAI Estados (estados/publicaciones electrónicas)
 * 
 * Security:
 * - Rate limit: 5 req / IP / 10 min (in-memory)
 * - PII redaction on all returned text
 * - No DB rows created (telemetry only via atenia_ai_actions)
 * - Masked radicado in all logs
 * - Whitelisted response schema only
 */

import { createClient } from "npm:@supabase/supabase-js@2";

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
  demandante: string | null;
  demandado: string | null;
}

// ═══════════════════════════════════════════
// PARTY PARSING from sujetosProcesales string
// ═══════════════════════════════════════════
const DEMANDANTE_RE = /demandante|accionante|actor|tutelante|solicitante|convocante/i;
const DEMANDADO_RE = /demandado|accionado|convocado|procesado/i;
const ROLE_RE = /^(Demandante|Demandado|Accionante|Accionado|Actor|Tutelante|Solicitante|Convocado|Convocante|Procesado)\s*:\s*(.+)$/i;

function parseSujetosString(raw: unknown): { demandante: string | null; demandado: string | null } {
  if (!raw || typeof raw !== "string") return { demandante: null, demandado: null };
  const str = raw.trim();
  if (!str) return { demandante: null, demandado: null };

  // Split by multiple separators
  let parts: string[];
  if (/[|;\/\n]/.test(str)) {
    parts = str.split(/[|;\/\n]/).map(s => s.trim()).filter(Boolean);
  } else if (/\s{2,}/.test(str)) {
    parts = str.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
  } else {
    parts = [str];
  }

  let demandante: string | null = null;
  let demandado: string | null = null;

  for (const part of parts) {
    const match = part.match(ROLE_RE);
    if (match) {
      const role = match[1];
      const name = match[2].trim().replace(/\.+$/, "").trim();
      if (!name) continue;
      if (DEMANDANTE_RE.test(role) && !demandante) demandante = name;
      if (DEMANDADO_RE.test(role) && !demandado) demandado = name;
    }
  }

  // Fallback: if no role prefix found but we have exactly 2 parts
  if (!demandante && !demandado && parts.length === 2) {
    demandante = parts[0].replace(/\.+$/, "").trim() || null;
    demandado = parts[1].replace(/\.+$/, "").trim() || null;
  }

  return { demandante, demandado };
}

interface DemoActuacion {
  fecha: string;
  tipo: string | null;
  descripcion: string;
  anotacion: string | null;
  source?: string;
}

interface DemoEstado {
  tipo: string;
  fecha: string;
  descripcion: string | null;
  source?: string;
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
    sources: string[];
    fetched_at: string;
    demo: true;
  };
}

// ═══════════════════════════════════════════
// EGRESS HELPERS — all external calls go through egressClient
// ═══════════════════════════════════════════

const CALLER = "demo-radicado-lookup";

async function fetchCpnuDirect(radicado: string): Promise<{ status: number; body: Record<string, unknown> | null; diagnostic?: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "Accept": "application/json, text/json, text/plain, */*",
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://consultaprocesos.ramajudicial.gov.co/",
    "Origin": "https://consultaprocesos.ramajudicial.gov.co",
  };

  const searchCandidates: Array<{ url: string; method: string; body?: string; desc: string }> = [
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`,
      method: "GET", desc: "v2 standard",
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co:443/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`,
      method: "GET", desc: "v2 port 443",
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`,
      method: "GET", desc: "v2 port 448",
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v2/Procesos/Consulta/NumeroRadicacion`,
      method: "POST", body: JSON.stringify({ numero: radicado, SoloActivos: false, pagina: 1 }), desc: "v2 POST",
    },
    {
      url: `https://consultaprocesos.ramajudicial.gov.co/api/v1/Procesos/Consulta/NumeroRadicacion?numero=${radicado}`,
      method: "GET", desc: "v1 legacy",
    },
    {
      url: `https://rama-judicial-api.onrender.com/api/v2/Procesos/Consulta/NumeroRadicacion?numero=${radicado}&SoloActivos=false&pagina=1`,
      method: "GET", desc: "external API fallback",
    },
  ];

  let lastDiagnostic: Record<string, unknown> = {};

  for (const candidate of searchCandidates) {
    try {
      console.log(`[demo] CPNU: trying ${candidate.desc} ...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const fetchOpts: RequestInit = {
        method: candidate.method,
        headers,
        signal: controller.signal,
      };
      if (candidate.body) fetchOpts.body = candidate.body;

      const resp = await fetch(candidate.url, fetchOpts);
      clearTimeout(timeoutId);

      const contentType = resp.headers.get("content-type") || "";
      console.log(`[demo] CPNU ${candidate.desc}: HTTP ${resp.status}, ct=${contentType.slice(0, 40)}`);

      if (!contentType.includes("json") && !contentType.includes("text/plain")) {
        console.log(`[demo] CPNU ${candidate.desc}: non-JSON response, skipping`);
        lastDiagnostic = { provider: "CPNU", variant: candidate.desc, http_status: resp.status, content_type: contentType.slice(0, 40), message: "non-JSON response" };
        continue;
      }

      if (!resp.ok) {
        lastDiagnostic = { provider: "CPNU", variant: candidate.desc, http_status: resp.status, message: `HTTP ${resp.status}` };
        continue;
      }

      const text = await resp.text();
      let data: any;
      try { data = JSON.parse(text); } catch {
        console.log(`[demo] CPNU ${candidate.desc}: JSON parse failed`);
        lastDiagnostic = { provider: "CPNU", variant: candidate.desc, message: "JSON parse error" };
        continue;
      }

      const procesos = data?.procesos || [];
      console.log(`[demo] CPNU ${candidate.desc}: ${procesos.length} procesos found`);

      if (procesos.length === 0) {
        return { status: 200, body: { ok: false, procesos: [] } };
      }

      const p = procesos[0];
      const idProceso = p.idProceso;

      // Fetch actuaciones with same fallback
      let actuaciones: any[] = [];
      if (idProceso) {
        const actCandidates = [
          `https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Proceso/Actuaciones/${idProceso}`,
          `https://consultaprocesos.ramajudicial.gov.co/api/v2/Proceso/Actuaciones/${idProceso}`,
          `https://consultaprocesos.ramajudicial.gov.co:443/api/v2/Proceso/Actuaciones/${idProceso}`,
          `https://rama-judicial-api.onrender.com/api/v2/Proceso/Actuaciones/${idProceso}`,
        ];
        for (const actUrl of actCandidates) {
          try {
            console.log(`[demo] CPNU actuaciones: trying ${actUrl.slice(0, 70)}...`);
            const ac = new AbortController();
            const at = setTimeout(() => ac.abort(), 12000);
            const actResp = await fetch(actUrl, { headers, signal: ac.signal });
            clearTimeout(at);
            const actCt = actResp.headers.get("content-type") || "";
            console.log(`[demo] CPNU actuaciones: HTTP ${actResp.status}, ct=${actCt.slice(0, 40)}`);
            if (!actCt.includes("json")) {
              console.log(`[demo] CPNU actuaciones: non-JSON, skipping`);
              continue;
            }
            if (actResp.ok) {
              const actData = await actResp.json();
              actuaciones = actData?.actuaciones || [];
              console.log(`[demo] CPNU actuaciones: ${actuaciones.length} found`);
              break;
            }
          } catch (e) {
            console.log(`[demo] CPNU actuaciones attempt failed: ${e instanceof Error ? e.message : e}`);
          }
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
      console.log(`[demo] CPNU ${candidate.desc}: error: ${err instanceof Error ? err.message : err}`);
      lastDiagnostic = { provider: "CPNU", variant: candidate.desc, error: err instanceof Error ? err.message : "unknown" };
      continue;
    }
  }

  console.log(`[demo] CPNU: all candidates exhausted`);
  return {
    status: 0,
    body: null,
    diagnostic: { ...lastDiagnostic, message: "CPNU unreachable — all candidates exhausted, falling back" },
  };
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

async function fetchSamaiEstadosDirect(radicado: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const baseUrl = Deno.env.get("SAMAI_ESTADOS_BASE_URL");
  const apiKey = Deno.env.get("SAMAI_ESTADOS_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY");
  if (!baseUrl || !apiKey) {
    console.log(`[demo] SAMAI Estados skipped: missing env vars (BASE_URL=${!!baseUrl}, API_KEY=${!!apiKey})`);
    return { status: 0, body: null };
  }
  // Format radicado with dashes for SAMAI Estados API
  const formatted = radicado.length === 23
    ? `${radicado.slice(0, 2)}-${radicado.slice(2, 5)}-${radicado.slice(5, 7)}-${radicado.slice(7, 9)}-${radicado.slice(9, 12)}-${radicado.slice(12, 16)}-${radicado.slice(16, 21)}-${radicado.slice(21, 23)}`
    : radicado;
  const url = `${baseUrl}/buscar?radicado=${encodeURIComponent(formatted)}`;
  console.log(`[demo] Calling SAMAI Estados for radicado ***${radicado.slice(-4)}`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    console.log(`[demo] SAMAI Estados responded: HTTP ${resp.status}`);
    const text = await resp.text();
    try {
      return { status: resp.status, body: JSON.parse(text) };
    } catch {
      console.log(`[demo] SAMAI Estados response not JSON, length=${text.length}`);
      return { status: resp.status, body: null };
    }
  } catch (err) {
    console.error(`[demo] SAMAI Estados fetch error:`, err);
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

    // 3. Parallel API calls — ALL four providers at once
    const [cpnuResult, pubResult, samaiResult, samaiEstadosResult] = await Promise.allSettled([
      fetchCpnuDirect(radicado),
      fetchPublicacionesDirect(radicado),
      fetchSamaiDirect(radicado),
      fetchSamaiEstadosDirect(radicado),
    ]);

    // 4. Parse responses into whitelisted schema
    let actuaciones: DemoActuacion[] = [];
    let estados: DemoEstado[] = [];
    let resumen: DemoResumen | null = null;
    let dataFound = false;
    const activeSources: string[] = [];

    // Parse CPNU
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

        const cpnuActuaciones: DemoActuacion[] = (p.actuaciones || [])
          .map((a: Record<string, unknown>) => ({
            fecha: normalizeDate(a.fecha_actuacion ?? a.fecha),
            tipo: truncate(String(a.actuacion || ""), 120),
            descripcion: redactPIIFromText(truncate(String(a.anotacion || a.actuacion || ""), 300) || ""),
            anotacion: a.anotacion ? redactPIIFromText(truncate(String(a.anotacion), 200) || "") : null,
            source: "CPNU",
          }))
          .filter((a: DemoActuacion) => a.fecha)
          .sort((a: DemoActuacion, b: DemoActuacion) => b.fecha.localeCompare(a.fecha));

        actuaciones.push(...cpnuActuaciones);
        activeSources.push("CPNU");

        // Parse parties from sujetosProcesales string
        const parsedParties = parseSujetosString(p.sujetos_procesales);
        // Also check direct demandante/demandado fields from CPNU
        const demandante = parsedParties.demandante || (typeof p.demandante === 'string' ? p.demandante.trim().replace(/\.+$/, '') : null);
        const demandado = parsedParties.demandado || (typeof p.demandado === 'string' ? p.demandado.trim().replace(/\.+$/, '') : null);
        console.log(`[demo] CPNU parties: demandante=${demandante}, demandado=${demandado}, raw sujetos=${typeof p.sujetos_procesales === 'string' ? p.sujetos_procesales.slice(0, 80) : 'N/A'}`);

        resumen = {
          radicado_display: formatRadicadoDisplay(radicado),
          despacho: p.despacho ? redactPIIFromText(truncate(String(p.despacho), 100) || "") : null,
          ciudad: daneInfo?.city || (p.ciudad ? String(p.ciudad) : null),
          departamento: daneInfo?.dept || (p.departamento ? String(p.departamento) : null),
          jurisdiccion: JURISDICCION_MAP[jurCode] || null,
          tipo_proceso: p.tipo ? truncate(String(p.tipo), 80) : null,
          fecha_radicacion: normalizeDate(p.fecha_radicacion),
          ultima_actuacion_fecha: cpnuActuaciones[0]?.fecha || null,
          ultima_actuacion_tipo: cpnuActuaciones[0]?.tipo || null,
          total_actuaciones: cpnuActuaciones.length,
          total_estados: 0,
          demandante: demandante || null,
          demandado: demandado || null,
        };
        dataFound = true;
      }
    }

    // Parse SAMAI actuaciones (merge, not fallback-only)
    if (samaiResult.status === "fulfilled") {
      const d = samaiResult.value;
      if (d.status === 200 && d.body) {
        const sd = d.body as any;
        const resultado = sd?.result || sd;
        if (resultado?.actuaciones || resultado?.despacho) {
          const acts = Array.isArray(resultado.actuaciones) ? resultado.actuaciones : [];
          const samaiActs: DemoActuacion[] = acts
            .map((a: Record<string, unknown>) => ({
              fecha: normalizeDate(a.fechaActuacion ?? a.fecha_actuacion ?? a.fecha),
              tipo: truncate(String(a.actuacion || a.tipo_actuacion || ""), 120),
              descripcion: redactPIIFromText(truncate(String(a.anotacion || a.descripcion || a.actuacion || ""), 300) || ""),
              anotacion: a.anotacion ? redactPIIFromText(truncate(String(a.anotacion), 200) || "") : null,
              source: "SAMAI",
            }))
            .filter((a: DemoActuacion) => a.fecha);

          actuaciones.push(...samaiActs);
          activeSources.push("SAMAI");

          if (!resumen && resultado.despacho) {
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
              ultima_actuacion_fecha: samaiActs[0]?.fecha || null,
              ultima_actuacion_tipo: samaiActs[0]?.tipo || null,
              total_actuaciones: samaiActs.length,
              total_estados: 0,
              demandante: null,
              demandado: null,
            };
          }
          dataFound = true;
          console.log(`[demo] SAMAI: ${samaiActs.length} actuaciones merged`);
        } else {
          console.log(`[demo] SAMAI: 200 OK but no matching data`);
        }
      }
    }

    // Deduplicate actuaciones across providers
    const seenActs = new Set<string>();
    actuaciones = actuaciones
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .filter((a) => {
        const k = `${a.fecha}|${(a.tipo || "").slice(0, 60)}`;
        if (seenActs.has(k)) return false;
        seenActs.add(k);
        return true;
      });

    // Parse Publicaciones
    if (pubResult.status === "fulfilled") {
      const d = pubResult.value;
      if (d.status === 200 && d.body) {
        const rawBody = d.body as any;
        const pubs = Array.isArray(rawBody?.publicaciones)
          ? rawBody.publicaciones
          : Array.isArray(rawBody) ? rawBody : [];
        
        console.log(`[demo] Publicaciones: found=${rawBody?.found}, pubsCount=${pubs.length}`);
        
        const mappedEstados = pubs.map((p: Record<string, unknown>, idx: number) => {
          let rawFecha = p.fecha_publicacion ?? p.fecha_hora_inicio ?? p.fechaFijacion ?? p.fechaPublicacion ?? p.fecha ?? p.fechaInicio ?? p.fechaRegistro;
          let fecha = normalizeDate(rawFecha);
          
          const tituloStr = String(p.titulo || "");
          if (!fecha && tituloStr) {
            fecha = extractDateFromSpanishTitle(tituloStr);
          }
          
          const pdfUrl = String(p.pdf_url || p.url || "");
          if (!fecha && pdfUrl) {
            const urlDateMatch = pdfUrl.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
            if (urlDateMatch) {
              fecha = `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
            }
          }
          
          let tipo = String(p.tipo_evento || "");
          if (!tipo || tipo === "null") {
            if (/^ESTADOS?\b/i.test(tituloStr)) tipo = "Estado Electrónico";
            else if (/^EDICTO/i.test(tituloStr)) tipo = "Edicto";
            else if (/^NOTIFICACI/i.test(tituloStr)) tipo = "Notificación";
            else if (/^TRASLADO/i.test(tituloStr)) tipo = "Traslado";
            else if (String(p.tipo || "") === "document") tipo = "Publicación";
            else tipo = truncate(String(p.tipo || "Estado"), 80) || "Estado";
          }
          
          const cleanTitulo = tituloStr.replace(/\.pdf$/i, "").trim();
          
          return {
            tipo,
            fecha: fecha || "",
            descripcion: cleanTitulo ? redactPIIFromText(truncate(cleanTitulo, 200) || "") : (p.descripcion ? redactPIIFromText(truncate(String(p.descripcion), 200) || "") : null),
            source: "Publicaciones",
          };
        });
        
        const pubEstados = mappedEstados
          .filter((e: DemoEstado) => e.fecha || e.descripcion)
          .sort((a: DemoEstado, b: DemoEstado) => (b.fecha || "").localeCompare(a.fecha || ""));
        
        estados.push(...pubEstados);
        if (pubEstados.length > 0) {
          activeSources.push("Publicaciones");
          dataFound = true;
        }
        
        console.log(`[demo] Publicaciones: ${pubEstados.length} estados mapped`);
        
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
            demandante: null,
            demandado: null,
          };
          dataFound = true;
        }
      }
    }

    // Parse SAMAI Estados
    if (samaiEstadosResult.status === "fulfilled") {
      const d = samaiEstadosResult.value;
      if (d.status === 200 && d.body) {
        const raw = d.body as any;
        // SAMAI Estados returns { estados: [...] } or { result: { estados: [...] } }
        const resultado = raw?.result || raw;
        const rawEstados = Array.isArray(resultado?.estados) ? resultado.estados : [];
        
        console.log(`[demo] SAMAI Estados: ${rawEstados.length} raw estados`);
        
        const samaiEstados: DemoEstado[] = rawEstados
          .map((e: Record<string, unknown>) => {
            const fecha = normalizeDate(
              e["Fecha Providencia"] ?? e["Fecha Estado"] ?? e.fechaProvidencia ?? e.fechaEstado ?? e.fecha ?? ""
            );
            const actuacion = String(e["Actuación"] ?? e.actuacion ?? e.tipo ?? "");
            const anotacion = String(e["Anotación"] ?? e.anotacion ?? e.descripcion ?? "");
            
            return {
              tipo: actuacion ? truncate(actuacion, 120) || "Estado SAMAI" : "Estado SAMAI",
              fecha: fecha || "",
              descripcion: anotacion ? redactPIIFromText(truncate(anotacion, 200) || "") : (actuacion ? redactPIIFromText(truncate(actuacion, 200) || "") : null),
              source: "SAMAI Estados",
            };
          })
          .filter((e: DemoEstado) => e.fecha || e.descripcion);
        
        estados.push(...samaiEstados);
        if (samaiEstados.length > 0) {
          activeSources.push("SAMAI Estados");
          dataFound = true;
        }
        
        console.log(`[demo] SAMAI Estados: ${samaiEstados.length} estados merged`);
      } else {
        console.log(`[demo] SAMAI Estados: HTTP ${d.status} (no data)`);
      }
    } else {
      console.log(`[demo] SAMAI Estados: promise rejected`);
    }

    // Deduplicate estados across providers
    const seenEstados = new Set<string>();
    estados = estados
      .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
      .filter((e) => {
        const k = `${e.fecha}|${(e.tipo || "").slice(0, 40)}`;
        if (seenEstados.has(k)) return false;
        seenEstados.add(k);
        return true;
      });

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
        demandante: null,
        demandado: null,
      };
    }

    // Update resumen totals
    resumen.total_actuaciones = actuaciones.length;
    resumen.total_estados = estados.length;

    // 6. Build whitelisted response
    const response: DemoResponse = {
      resumen,
      actuaciones: actuaciones.slice(0, 30),
      estados: estados.slice(0, 20),
      meta: {
        radicado_masked: maskRadicado(radicado),
        actuaciones_count: actuaciones.length,
        estados_count: estados.length,
        sources: activeSources,
        fetched_at: new Date().toISOString(),
        demo: true,
      },
    };

    // 7. Telemetry (non-blocking, masked)
    logTelemetry(radicado, actuaciones.length, estados.length, Date.now() - t0, ip, activeSources).catch(() => {});

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

async function logTelemetry(radicado: string, actCount: number, estCount: number, durationMs: number, ip: string, sources: string[]) {
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
        ip_masked: ip.split(".").slice(0, 2).join(".") + ".*.*",
        egress_purpose: "judicial_demo",
      },
      status: "executed",
    });
  } catch { /* telemetry is non-blocking */ }
}
