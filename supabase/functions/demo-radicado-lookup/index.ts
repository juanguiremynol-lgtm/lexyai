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

async function fetchCpnuViaEgress(radicado: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // CPNU goes through adapter-cpnu edge function (internal call via egress proxy)
  const result = await egressFetch({
    targetUrl: `${supabaseUrl}/functions/v1/adapter-cpnu`,
    purpose: "judicial_demo",
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      "Content-Type": "application/json",
    },
    body: { radicado, action: "search" },
    caller: CALLER,
    tenantHash: "demo",
  });

  if (!result.ok) {
    return { status: result.status, body: null };
  }
  try {
    return { status: result.status, body: JSON.parse(result.body) };
  } catch {
    return { status: result.status, body: null };
  }
}

async function fetchPublicacionesViaEgress(radicado: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const pubBaseUrl = Deno.env.get("PUBLICACIONES_BASE_URL");
  const pubApiKey = Deno.env.get("PUBLICACIONES_X_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY");
  if (!pubBaseUrl || !pubApiKey) return { status: 0, body: null };

  const result = await egressFetch({
    targetUrl: `${pubBaseUrl}/snapshot/${radicado}`,
    purpose: "judicial_demo",
    method: "GET",
    headers: { "x-api-key": pubApiKey },
    body: undefined,
    caller: CALLER,
    tenantHash: "demo",
  });

  if (!result.ok) {
    return { status: result.status, body: null };
  }
  try {
    return { status: result.status, body: JSON.parse(result.body) };
  } catch {
    return { status: result.status, body: null };
  }
}

async function fetchSamaiViaEgress(radicado: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const samaiUrl = Deno.env.get("SAMAI_BASE_URL");
  const samaiKey = Deno.env.get("SAMAI_X_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY");
  if (!samaiUrl || !samaiKey) return { status: 0, body: null };

  const result = await egressFetch({
    targetUrl: `${samaiUrl}/buscar?numero_radicacion=${radicado}`,
    purpose: "judicial_demo",
    method: "GET",
    headers: { "x-api-key": samaiKey },
    body: undefined,
    caller: CALLER,
    tenantHash: "demo",
  });

  if (!result.ok) {
    return { status: result.status, body: null };
  }
  try {
    return { status: result.status, body: JSON.parse(result.body) };
  } catch {
    return { status: result.status, body: null };
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
      }, 429);
    }

    // 2. Validate radicado
    const rawRadicado = body?.radicado;
    if (!rawRadicado || typeof rawRadicado !== "string") {
      return json({ error: "MISSING_RADICADO", message: "El radicado es requerido." }, 400);
    }
    const radicado = rawRadicado.replace(/\D/g, "");
    if (radicado.length !== 23) {
      return json({
        error: "INVALID_RADICADO",
        message: `El radicado debe tener exactamente 23 dígitos numéricos (tiene ${radicado.length}).`,
      }, 400);
    }

    // 3. Parallel API calls via egressClient
    const [cpnuResult, pubResult] = await Promise.allSettled([
      fetchCpnuViaEgress(radicado),
      fetchPublicacionesViaEgress(radicado),
    ]);

    // 4. Parse responses into whitelisted schema
    let actuaciones: DemoActuacion[] = [];
    let estados: DemoEstado[] = [];
    let resumen: DemoResumen | null = null;
    let dataFound = false;

    // Parse CPNU
    if (cpnuResult.status === "fulfilled") {
      const d = cpnuResult.value;
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
        const pubs = Array.isArray(rawBody?.publicaciones)
          ? rawBody.publicaciones
          : Array.isArray(rawBody) ? rawBody : [];
        estados = pubs
          .map((p: Record<string, unknown>) => ({
            tipo: truncate(String(p.tipo || p.nombre || p.estado || "Estado"), 80) || "Estado",
            fecha: normalizeDate(p.fechaFijacion ?? p.fecha ?? p.fechaPublicacion),
            descripcion: p.descripcion ? redactPIIFromText(truncate(String(p.descripcion), 200) || "") : null,
          }))
          .filter((e: DemoEstado) => e.fecha)
          .sort((a: DemoEstado, b: DemoEstado) => b.fecha.localeCompare(a.fecha));
        if (estados.length > 0) dataFound = true;
        if (resumen) resumen.total_estados = estados.length;
      }
    }

    // 5. SAMAI fallback via egressClient if no data yet
    if (!dataFound) {
      try {
        const samaiResult = await fetchSamaiViaEgress(radicado);
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
          }
        }
      } catch { /* SAMAI fallback failed — non-blocking */ }
    }

    if (!dataFound) {
      return json({
        error: "NOT_FOUND",
        message: "No se encontraron datos para este radicado. Verifica que el número sea correcto.",
      }, 404);
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
    }, 500);
  }
});

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDate(val: unknown): string {
  if (!val || typeof val !== "string") return "";
  const ddmm = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
  const iso = new Date(val);
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
