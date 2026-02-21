/**
 * demo-radicado-lookup — Public demo edge function
 * 
 * Zero-auth, zero-DB-write lookup for the landing page "Prueba Andromeda" experience.
 * All external calls route through direct fetch with purpose "judicial_demo".
 * 
 * Three-Phase Architecture:
 * Phase 1: Check demo_radicado_cache for instant render
 * Phase 2: Fan-out to all providers in parallel (always)
 * Phase 3: Strict append-only merge + cache update
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
import {
  fetchFromCpnu as sharedFetchCpnu,
  fetchFromSamai as sharedFetchSamai,
  fetchFromPublicaciones as sharedFetchPublicaciones,
  fetchFromTutelas as sharedFetchTutelas,
  fetchFromSamaiEstados as sharedFetchSamaiEstados,
  toDemoResult,
  type DemoProviderResult,
} from "../_shared/providerAdapters/index.ts";

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
  "10": "Penal Circuito", "11": "Civil Circuito", "12": "Penal Municipal",
  "13": "Laboral Circuito", "14": "Promiscuo Municipal", "15": "Familia",
  "18": "Ejecución Penas", "20": "Tribunal Civil", "21": "Tribunal Laboral",
  "22": "Tribunal Penal", "23": "Civil", "31": "Civil",
  "33": "Administrativo", "34": "Administrativo Tribunal",
  "40": "Civil Municipal", "41": "Laboral Municipal",
  "42": "Penal Adolescentes", "44": "Familia",
  "50": "Promiscuo", "53": "Penal Municipal",
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

interface DemoEstadoAttachment {
  type: 'pdf' | 'link';
  url: string;
  label?: string;
  provider?: string;
}

interface DemoEstado {
  tipo: string;
  fecha: string;
  descripcion: string | null;
  sources: string[];  // provenance
  attachments?: DemoEstadoAttachment[];
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
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNCERTAIN";
  signals: string[];
  caveats?: string[];  // prospect-friendly notes about confidence gaps
}

// Party parsing delegated to _shared/partyNormalization.ts
function parseSujetosString(raw: unknown): { demandante: string | null; demandado: string | null } {
  const result = parseCpnuSujetos(raw);
  return { demandante: result.demandante || null, demandado: result.demandado || null };
}

// ═══════════════════════════════════════════
// PROVIDER DEFINITIONS — uses shared adapters
// ═══════════════════════════════════════════

/** All 5 built-in providers with their display labels and fetch functions */
const DEMO_PROVIDERS = [
  { name: "CPNU",          label: "Consulta Nacional de Procesos",   provides: ["actuaciones", "metadata"] as const, fetchFn: fetchCpnu },
  { name: "SAMAI",         label: "Sistema de Gestión SAMAI",        provides: ["actuaciones", "metadata"] as const, fetchFn: fetchSamai },
  { name: "Publicaciones", label: "Publicaciones Procesales",        provides: ["estados"] as const,                 fetchFn: fetchPublicaciones },
  { name: "Tutelas",       label: "API de Tutelas",                  provides: ["actuaciones", "estados", "metadata"] as const, fetchFn: fetchTutelas },
  { name: "SAMAI Estados", label: "SAMAI Estados Electrónicos",      provides: ["estados"] as const,                 fetchFn: fetchSamaiEstados },
] as const;

/** Map provider name → display label (includes dynamic providers) */
function getProviderLabel(providerName: string): string {
  const builtIn = DEMO_PROVIDERS.find(p => p.name === providerName);
  return builtIn?.label || `${providerName} (Dynamic)`;
}

// ═══════════════════════════════════════════
// PROVIDER FETCH IMPLEMENTATIONS
// ═══════════════════════════════════════════

async function fetchCpnu(radicado: string, _baseUrl: string, _apiKey: string): Promise<ProviderResult> {
  try {
    const result = await sharedFetchCpnu({
      radicado,
      mode: 'discovery',
      timeoutMs: 12000,
      includeParties: true,
      redactPII: true,
    });
    const demo = toDemoResult(result, { redactFn: redactPIIFromText });
    // Map DemoProviderResult back to local ProviderResult (same shape)
    return demo as unknown as ProviderResult;
  } catch (err) {
    return { provider: "CPNU", outcome: "error", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: String(err) };
  }
}

async function fetchSamai(radicado: string, baseUrl: string, apiKey: string): Promise<ProviderResult> {
  if (!baseUrl || !apiKey) {
    return { provider: "SAMAI", outcome: "skipped", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: "Not configured" };
  }
  try {
    const result = await sharedFetchSamai({
      radicado,
      mode: 'discovery',
      timeoutMs: 12000,
      includeParties: true,
      redactPII: true,
    });
    const demo = toDemoResult(result, { redactFn: redactPIIFromText });
    return demo as unknown as ProviderResult;
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return { provider: "SAMAI", outcome: isTimeout ? "timeout" : "error", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: String(err) };
  }
}

async function fetchPublicaciones(radicado: string, baseUrl: string, apiKey: string): Promise<ProviderResult> {
  if (!baseUrl || !apiKey) {
    return { provider: "Publicaciones", outcome: "skipped", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: "Not configured" };
  }
  try {
    const result = await sharedFetchPublicaciones({
      radicado,
      mode: 'discovery',
      timeoutMs: 20000,
      redactPII: true,
    });
    const demo = toDemoResult(result, { redactFn: redactPIIFromText });
    return demo as unknown as ProviderResult;
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return { provider: "Publicaciones", outcome: isTimeout ? "timeout" : "error", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: String(err) };
  }
}

async function fetchTutelas(radicado: string, baseUrl: string, apiKey: string): Promise<ProviderResult> {
  if (!baseUrl || !apiKey) {
    return { provider: "Tutelas", outcome: "skipped", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: "Not configured" };
  }
  try {
    const result = await sharedFetchTutelas({
      radicado,
      mode: 'discovery',
      timeoutMs: 20000,
      includeParties: true,
      redactPII: true,
    });
    const demo = toDemoResult(result, { redactFn: redactPIIFromText });
    return demo as unknown as ProviderResult;
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return { provider: "Tutelas", outcome: isTimeout ? "timeout" : "error", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: String(err) };
  }
}

async function fetchSamaiEstados(radicado: string, baseUrl: string, apiKey: string): Promise<ProviderResult> {
  if (!baseUrl || !apiKey) {
    return { provider: "SAMAI Estados", outcome: "skipped", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: "Not configured" };
  }
  try {
    const result = await sharedFetchSamaiEstados({
      radicado,
      mode: 'discovery',
      timeoutMs: 12000,
      redactPII: true,
    });
    const demo = toDemoResult(result, { redactFn: redactPIIFromText });
    return demo as unknown as ProviderResult;
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return { provider: "SAMAI Estados", outcome: isTimeout ? "timeout" : "error", found_status: "NOT_FOUND", latency_ms: 0, actuaciones: [], estados: [], metadata: null, parties: null, error: String(err) };
  }
}

// ═══════════════════════════════════════════
// CATEGORY INFERENCE (demo-only scoring)
// ═══════════════════════════════════════════

function inferCategory(results: ProviderResult[], radicado: string): CategoryInference {
  const signals: string[] = [];
  const caveats: string[] = [];
  const scores: Record<string, number> = { CGP: 0, CPACA: 0, TUTELA: 0, LABORAL: 0, PENAL_906: 0 };

  // Track which domain-specific providers returned data
  const tutelasResult = results.find(r => r.provider === "Tutelas");
  const samaiResult = results.find(r => r.provider === "SAMAI");
  const samaiEstadosResult = results.find(r => r.provider === "SAMAI Estados");
  const cpnuResult = results.find(r => r.provider === "CPNU");

  const tutelasHit = tutelasResult?.outcome === "success" && tutelasResult.found_status !== "NOT_FOUND";
  const samaiHit = samaiResult?.outcome === "success" && samaiResult.found_status !== "NOT_FOUND";
  const samaiEstadosHit = samaiEstadosResult?.outcome === "success" && samaiEstadosResult.found_status !== "NOT_FOUND";
  const cpnuHit = cpnuResult?.outcome === "success" && cpnuResult.found_status !== "NOT_FOUND";

  // ── Provider dominance weights ──
  // Tutelas provider hit = very strong TUTELA signal
  if (tutelasHit) {
    const weight = tutelasResult!.found_status === "FOUND_COMPLETE" ? 2 : 1;
    scores.TUTELA += 5 * weight;
    signals.push("API de Tutelas confirmó datos (señal fuerte de tutela)");
  }

  // SAMAI / SAMAI Estados hit = strong CPACA signal
  if (samaiEstadosHit) {
    const weight = samaiEstadosResult!.found_status === "FOUND_COMPLETE" ? 2 : 1;
    scores.CPACA += 4 * weight;
    signals.push("SAMAI Estados confirmó datos (señal fuerte de CPACA)");
  }
  if (samaiHit) {
    const weight = samaiResult!.found_status === "FOUND_COMPLETE" ? 2 : 1;
    scores.CPACA += 3 * weight;
    signals.push("SAMAI confirmó datos (señal CPACA)");
  }

  // CPNU alone is a weak signal — it covers all categories
  if (cpnuHit) {
    scores.CGP += 1;
    signals.push("CPNU confirmó datos (señal genérica)");
  }

  // ── Metadata-based scoring ──
  for (const r of results) {
    if (!r.metadata) continue;
    const despacho = (r.metadata.despacho || "").toLowerCase();
    const tipoProceso = (r.metadata.tipo_proceso || "").toLowerCase();

    if (despacho.includes("administrativo") || despacho.includes("contencioso") || despacho.includes("consejo de estado")) {
      scores.CPACA += 3;
      signals.push(`Despacho administrativo: ${r.metadata.despacho}`);
    }
    if (despacho.includes("laboral") || tipoProceso.includes("laboral")) {
      scores.LABORAL += 3;
      signals.push("Despacho/tipo laboral");
    }
    if (despacho.includes("penal") || tipoProceso.includes("penal") || tipoProceso.includes("906")) {
      scores.PENAL_906 += 3;
      signals.push("Despacho/tipo penal");
    }
    if (despacho.includes("civil") || despacho.includes("familia") || despacho.includes("promiscuo")) {
      scores.CGP += 2;
      signals.push(`Despacho civil/familia: ${r.metadata.despacho}`);
    }
    // Tutela keywords in despacho text
    if (despacho.includes("tutela") || despacho.includes("constitucional") || despacho.includes("amparo")) {
      scores.TUTELA += 3;
      signals.push("Despacho menciona tutela/constitucional");
    }
  }

  // ── Actuaciones text scanning for tutela keywords ──
  // Count distinct tutela-type actuaciones for stronger signal
  let tutelaKeywordFound = false;
  let tutelaActCount = 0;
  const tutelaPatterns = ["tutela", "acción de tutela", "auto admite tutela", "sentencia tutela", "fallo tutela", "impugnación tutela"];
  for (const r of results) {
    for (const act of r.actuaciones) {
      const text = [act.tipo, act.descripcion, act.anotacion].filter(Boolean).join(" ").toLowerCase();
      if (tutelaPatterns.some(p => text.includes(p))) {
        tutelaActCount++;
      }
    }
  }
  if (tutelaActCount > 0) {
    // Each tutela-type actuación adds +2, capped at +8
    const tutelaBonus = Math.min(tutelaActCount * 2, 8);
    scores.TUTELA += tutelaBonus;
    signals.push(`${tutelaActCount} actuación(es) con palabras clave de tutela`);
    tutelaKeywordFound = true;
  }

  // ── Radicado jurisdiction code (positions 5-6) — weak signal only ──
  const jurCode = radicado.slice(5, 7);
  if (["33", "34"].includes(jurCode)) { scores.CPACA += 1; signals.push(`Código jurisdicción ${jurCode} (Administrativo)`); }
  if (["10", "12", "22", "18", "42", "53"].includes(jurCode)) { scores.PENAL_906 += 1; signals.push(`Código jurisdicción ${jurCode} (Penal)`); }
  if (["13", "21", "41"].includes(jurCode)) { scores.LABORAL += 1; signals.push(`Código jurisdicción ${jurCode} (Laboral)`); }
  if (["11", "23", "31", "40"].includes(jurCode)) { scores.CGP += 1; signals.push(`Código jurisdicción ${jurCode} (Civil)`); }
  if (["14", "15", "44", "50"].includes(jurCode)) { scores.CGP += 1; signals.push(`Código jurisdicción ${jurCode} (Familia/Promiscuo)`); }

  // ── Find winner ──
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topCat, topScore] = entries[0];
  const [, secondScore] = entries[1] || [null, 0];

  if (topScore === 0) {
    return { category: "DESCONOCIDA", confidence: "UNCERTAIN", signals: ["Sin señales suficientes"], caveats: ["No fue posible determinar la categoría de este proceso."] };
  }

  // ── Confidence determination with cross-validation ──
  let confidence: "HIGH" | "MEDIUM" | "LOW" | "UNCERTAIN";

  // HIGH: dominant provider confirms + strong score
  if (topScore >= 8) {
    confidence = "HIGH";
  }
  // MEDIUM: good score with clear separation
  else if (topScore >= 4 && topScore > secondScore * 1.5) {
    confidence = "MEDIUM";
  }
  // LOW: some signal but not strong
  else if (topScore >= 2) {
    confidence = "LOW";
  }
  // UNCERTAIN: too close or too weak
  else {
    confidence = "UNCERTAIN";
  }

  // ── Cross-validation caveats ──
  // CPACA inferred but SAMAI/SAMAI Estados didn't confirm
  if (topCat === "CPACA" && !samaiHit && !samaiEstadosHit) {
    if (confidence === "MEDIUM") confidence = "LOW";
    caveats.push("Las fuentes especializadas en lo Contencioso Administrativo (SAMAI) no confirmaron datos para este radicado. Mostramos lo encontrado en otras fuentes.");
  }

  // TUTELA inferred but Tutelas provider didn't confirm
  if (topCat === "TUTELA" && !tutelasHit) {
    if (confidence === "HIGH") confidence = "MEDIUM";
    if (confidence === "MEDIUM" && !tutelaKeywordFound) confidence = "LOW";
    caveats.push("La fuente especializada en tutelas no retornó datos para este radicado. La clasificación se basa en señales del despacho y las actuaciones.");
  }

  // If score is very close between top two → uncertain
  if (topScore > 0 && secondScore > 0 && topScore - secondScore <= 1) {
    confidence = "UNCERTAIN";
    caveats.push("Las señales son ambiguas entre varias categorías posibles.");
  }

  // Total data is zero actuaciones + zero estados → can't be confident
  const totalActs = results.reduce((s, r) => s + r.actuaciones.length, 0);
  const totalEst = results.reduce((s, r) => s + r.estados.length, 0);
  if (totalActs === 0 && totalEst === 0) {
    if (confidence !== "UNCERTAIN") confidence = "LOW";
    caveats.push("No se encontraron actuaciones ni estados publicados. El despacho puede no publicar información electrónicamente.");
  }

  return { category: topCat, confidence, signals, caveats: caveats.length > 0 ? caveats : undefined };
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
      // Merge attachments (union by normalized URL)
      if (est.attachments && est.attachments.length > 0) {
        if (!existing.attachments) existing.attachments = [];
        const existingUrls = new Set(existing.attachments.map(a => a.url));
        for (const att of est.attachments) {
          if (!existingUrls.has(att.url)) {
            existing.attachments.push(att);
            existingUrls.add(att.url);
          }
        }
      }
    } else {
      keyMap.set(key, merged.length);
      merged.push({ ...est, sources: [...est.sources], attachments: est.attachments ? [...est.attachments] : undefined });
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
// CACHE HELPERS
// ═══════════════════════════════════════════

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

interface CachedPayload {
  proceso: Record<string, any>;
  partes: any[];
  actuaciones: DemoActuacion[];
  estados: DemoEstado[];
}

function mergeWithStrictRules(cached: CachedPayload, fresh: CachedPayload): CachedPayload {
  const merged = { ...cached };

  // ACTUACIONES: append new, never delete existing (dedupe by fecha|tipo key)
  const existingActKeys = new Set(
    (cached.actuaciones || []).map(a => `${a.fecha}|${(a.tipo || "").toLowerCase().trim().slice(0, 60)}`)
  );
  const newActs = (fresh.actuaciones || []).filter(a => {
    const key = `${a.fecha}|${(a.tipo || "").toLowerCase().trim().slice(0, 60)}`;
    return !existingActKeys.has(key);
  });
  merged.actuaciones = [...(cached.actuaciones || []), ...newActs];

  // ESTADOS: append new, never delete existing
  const existingEstKeys = new Set(
    (cached.estados || []).map(e => `${e.fecha}|${(e.tipo || "").toLowerCase().trim().slice(0, 40)}`)
  );
  const newEstados = (fresh.estados || []).filter(e => {
    const key = `${e.fecha}|${(e.tipo || "").toLowerCase().trim().slice(0, 40)}`;
    return !existingEstKeys.has(key);
  });
  merged.estados = [...(cached.estados || []), ...newEstados];

  // Enrich attachments on existing estados that were missing them
  for (const freshEst of (fresh.estados || [])) {
    if (freshEst.attachments && freshEst.attachments.length > 0) {
      const key = `${freshEst.fecha}|${(freshEst.tipo || "").toLowerCase().trim().slice(0, 40)}`;
      const existing = merged.estados.find(e =>
        `${e.fecha}|${(e.tipo || "").toLowerCase().trim().slice(0, 40)}` === key
      );
      if (existing && (!existing.attachments || existing.attachments.length === 0)) {
        existing.attachments = freshEst.attachments;
      } else if (existing && existing.attachments) {
        // Merge attachment URLs
        const existingUrls = new Set(existing.attachments.map(a => a.url));
        for (const att of freshEst.attachments) {
          if (!existingUrls.has(att.url)) {
            existing.attachments.push(att);
          }
        }
      }
    }
  }

  // Merge provenance sources on matched records
  for (const freshAct of (fresh.actuaciones || [])) {
    const key = `${freshAct.fecha}|${(freshAct.tipo || "").toLowerCase().trim().slice(0, 60)}`;
    const existing = merged.actuaciones.find(a =>
      `${a.fecha}|${(a.tipo || "").toLowerCase().trim().slice(0, 60)}` === key
    );
    if (existing) {
      for (const src of freshAct.sources) {
        if (!existing.sources.includes(src)) existing.sources.push(src);
      }
      // Prefer richer text
      if (freshAct.descripcion && freshAct.descripcion.length > (existing.descripcion?.length || 0)) {
        existing.descripcion = freshAct.descripcion;
      }
    }
  }

  // PARTES: enrich, never remove
  const existingPartyKeys = new Set((cached.partes || []).map((p: any) => `${p.tipo}|${p.nombre}`));
  const newPartes = (fresh.partes || []).filter((p: any) => !existingPartyKeys.has(`${p.tipo}|${p.nombre}`));
  merged.partes = [...(cached.partes || []), ...newPartes];

  // PROCESO: enrich optional fields, never overwrite non-empty with empty
  if (fresh.proceso) {
    if (!merged.proceso) merged.proceso = {};
    for (const [key, value] of Object.entries(fresh.proceso)) {
      if (value && (!merged.proceso[key] || merged.proceso[key] === "" || merged.proceso[key] === null)) {
        merged.proceso[key] = value;
      }
    }
  }

  return merged;
}

function simpleHash(obj: unknown): string {
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
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

  // ═══ PRE-LAUNCH GATE REMOVED ═══
  // Demo is the primary conversion asset and must ALWAYS be accessible
  // (landing page, /demo, /prueba, embedded iframes).
  // Pre-launch gating applies to auth/app routes only, never the demo.

  // ═══ CACHE WARMING ACTION ═══
  // Accepts { action: "warm_cache", radicados: ["23-digit", ...] }
  // Intended for cron or manual pre-warming of frequently demoed radicados.
  if (body?.action === "warm_cache" && Array.isArray(body?.radicados)) {
    const radicados = body.radicados
      .map((r: string) => String(r).replace(/\D/g, ""))
      .filter((r: string) => r.length === 23)
      .slice(0, 20); // Max 20 per call
    console.log(`[demo] Cache warming ${radicados.length} radicados`);
    const warmResults: Record<string, string> = {};
    for (const rad of radicados) {
      try {
        // Recursive self-call with the radicado — reuses the full pipeline
        const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/demo-radicado-lookup`;
        const resp = await fetch(selfUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ radicado: rad }),
        });
        const data = await resp.json();
        warmResults[maskRadicado(rad)] = data.error ? `error: ${data.error}` : `ok (${data.meta?.actuaciones_count || 0} acts, ${data.meta?.estados_count || 0} est)`;
      } catch (err) {
        warmResults[maskRadicado(rad)] = `failed: ${String(err).slice(0, 80)}`;
      }
    }
    return json({ action: "warm_cache", results: warmResults }, 200);
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

    const supabaseAdmin = getSupabaseAdmin();

    // ═══ PHASE 1: Check cache ═══
    let cached: any = null;
    let isFresh = false;
    let cacheAgeMinutes: number | null = null;
    try {
      const { data: cacheRow } = await supabaseAdmin
        .from("demo_radicado_cache")
        .select("*")
        .eq("radicado_normalized", radicado)
        .maybeSingle();
      if (cacheRow) {
        cached = cacheRow;
        const ageMs = Date.now() - new Date(cacheRow.last_refresh_at).getTime();
        cacheAgeMinutes = Math.round(ageMs / 60000);
        const ttlMs = (cacheRow.cache_ttl_hours || 24) * 3600 * 1000;
        isFresh = ageMs < ttlMs;
      }
    } catch (cacheErr) {
      console.warn("[demo] Cache read failed (non-blocking):", cacheErr);
    }

    // ═══ Provider retry helper (bounded: up to maxRetries with exp backoff + jitter) ═══
    async function fetchWithRetry(
      providerName: string,
      fetchFn: (rad: string, b: string, k: string) => Promise<ProviderResult>,
      maxRetries: number,
    ): Promise<ProviderResult> {
      let lastResult: ProviderResult | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          // Exponential backoff: 400ms, 1200ms + jitter
          const delay = Math.min(400 * Math.pow(3, attempt - 1), 3000) + Math.random() * 200;
          await new Promise(r => setTimeout(r, delay));
          console.log(`[demo] Retry ${attempt}/${maxRetries} for ${providerName}`);
        }
        try {
          lastResult = await fetchFn(radicado, "", "");
          // Don't retry on success, no-data (explicit NOT_FOUND), or skipped
          if (lastResult.outcome === "success" || lastResult.outcome === "no-data" || lastResult.outcome === "skipped") {
            if (attempt > 0) lastResult = { ...lastResult, error: `OK after ${attempt} retries` };
            return lastResult;
          }
          // Retry on timeout or error
        } catch (err) {
          lastResult = {
            provider: providerName,
            outcome: "error" as ProviderOutcome,
            found_status: "NOT_FOUND" as FoundStatus,
            latency_ms: 0,
            actuaciones: [],
            estados: [],
            metadata: null,
            parties: null,
            error: String(err),
          };
        }
      }
      return lastResult!;
    }

    // Critical estados providers that get retries
    const ESTADOS_CRITICAL_PROVIDERS = new Set(["Publicaciones", "SAMAI Estados", "Tutelas"]);
    const isRetryEstados = body?.action === "retry_estados";

    // If we have cached data (fresh or stale), skip retries — we already have fallback content.
    // This avoids the 23s worst-case (20s timeout + 2 retries) when cache can serve instantly.
    const hasCache = !!cached;

    // ═══ PHASE 2: Fan out to providers (with retries for critical ones) ═══
    // Also discover dynamic providers from provider_coverage_overrides
    let dynamicProviderResults: ProviderResult[] = [];
    try {
      const { data: overrides } = await supabaseAdmin
        .from("provider_coverage_overrides")
        .select("provider_key, connector_id, timeout_ms, data_kind")
        .eq("enabled", true);
      
      if (overrides && overrides.length > 0) {
        // Exclude built-in providers already in DEMO_PROVIDERS
        const builtinKeys = new Set(DEMO_PROVIDERS.map(p => p.name.toUpperCase().replace(/\s+/g, "_")));
        const dynamicOverrides = overrides.filter(o => !builtinKeys.has(o.provider_key.toUpperCase()));
        
        if (dynamicOverrides.length > 0) {
          console.log(`[demo] Found ${dynamicOverrides.length} dynamic provider(s) from coverage overrides`);
          
          // Group by provider_key (a provider may have both ACTUACIONES and ESTADOS entries)
          const uniqueProviders = new Map<string, typeof dynamicOverrides[0]>();
          for (const o of dynamicOverrides) {
            if (!uniqueProviders.has(o.provider_key)) uniqueProviders.set(o.provider_key, o);
          }
          
          const dynamicPromises = Array.from(uniqueProviders.entries()).map(async ([providerKey, override]) => {
            const t0dyn = Date.now();
            try {
              const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
              const functionUrl = `${supabaseUrl}/functions/v1/provider-sync-external-provider`;
              
              // For demo, we call the external provider with a synthetic lookup
              const controller = new AbortController();
              const timeoutMs = override.timeout_ms || 15000;
              const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
              
              const resp = await fetch(functionUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  radicado,
                  connector_id: override.connector_id,
                  mode: "DEMO_LOOKUP",
                }),
                signal: controller.signal,
              });
              clearTimeout(timeoutId);
              
              const latency = Date.now() - t0dyn;
              
              if (!resp.ok) {
                return {
                  provider: providerKey,
                  outcome: "error" as ProviderOutcome,
                  found_status: "NOT_FOUND" as FoundStatus,
                  latency_ms: latency,
                  actuaciones: [],
                  estados: [],
                  metadata: null,
                  parties: null,
                  error: `HTTP ${resp.status}`,
                } as ProviderResult;
              }
              
              const result = await resp.json();
              
              // Map the response to ProviderResult
              const actuaciones: DemoActuacion[] = (result.actuaciones || []).map((a: any) => ({
                fecha: normalizeDate(a.fecha || a.event_date || a.fechaActuacion),
                tipo: truncate(String(a.tipo || a.actuacion || a.title || ""), 120),
                descripcion: redactPIIFromText(truncate(String(a.descripcion || a.description || a.anotacion || ""), 300) || ""),
                anotacion: a.anotacion ? redactPIIFromText(truncate(String(a.anotacion), 200) || "") : null,
                sources: [providerKey],
              })).filter((a: DemoActuacion) => a.fecha);
              
              const estados: DemoEstado[] = (result.estados || []).map((e: any) => ({
                tipo: truncate(String(e.tipo || e.actuacion || "Estado"), 120) || "Estado",
                fecha: normalizeDate(e.fecha || e.fechaEstado || e.fechaProvidencia),
                descripcion: e.descripcion ? redactPIIFromText(truncate(String(e.descripcion), 200) || "") : null,
                sources: [providerKey],
              })).filter((e: DemoEstado) => e.fecha || e.descripcion);
              
              const hasData = actuaciones.length > 0 || estados.length > 0;
              
              return {
                provider: providerKey,
                outcome: hasData ? "success" as ProviderOutcome : "no-data" as ProviderOutcome,
                found_status: hasData ? "FOUND_COMPLETE" as FoundStatus : "NOT_FOUND" as FoundStatus,
                latency_ms: latency,
                actuaciones,
                estados,
                metadata: result.despacho ? {
                  despacho: result.despacho,
                  tipo_proceso: result.tipo_proceso || null,
                  fecha_radicacion: result.fecha_radicacion || null,
                } : null,
                parties: result.demandante || result.demandado ? {
                  demandante: result.demandante || null,
                  demandado: result.demandado || null,
                } : null,
              } as ProviderResult;
            } catch (err) {
              const isTimeout = err instanceof DOMException && err.name === "AbortError";
              return {
                provider: providerKey,
                outcome: (isTimeout ? "timeout" : "error") as ProviderOutcome,
                found_status: "NOT_FOUND" as FoundStatus,
                latency_ms: Date.now() - t0dyn,
                actuaciones: [],
                estados: [],
                metadata: null,
                parties: null,
                error: isTimeout ? "Timeout" : String(err),
              } as ProviderResult;
            }
          });
          
          dynamicProviderResults = await Promise.all(dynamicPromises);
          for (const r of dynamicProviderResults) {
            console.log(`[demo] Dynamic provider ${r.provider}: outcome=${r.outcome}, acts=${r.actuaciones.length}, estados=${r.estados.length}`);
          }
        }
      }
    } catch (dynErr) {
      console.warn("[demo] Dynamic provider discovery failed (non-blocking):", dynErr);
    }

    // Fan out to all 5 built-in providers via shared adapters
    // Each thin wrapper handles its own config checking and returns gracefully on missing env vars
    const providerPromises = DEMO_PROVIDERS.map(async (provider) => {
      // If retry_estados mode, only re-call estados-critical providers
      if (isRetryEstados && !ESTADOS_CRITICAL_PROVIDERS.has(provider.name)) {
        return {
          provider: provider.name,
          outcome: "skipped" as ProviderOutcome,
          found_status: "NOT_FOUND" as FoundStatus,
          latency_ms: 0,
          actuaciones: [],
          estados: [],
          metadata: null,
          parties: null,
          error: "Skipped (retry_estados mode)",
        } as ProviderResult;
      }

      // Critical estados providers get up to 2 retries on cold cache only.
      // When cache exists, skip retries to avoid 23s worst-case latency.
      const maxRetries = (!hasCache && ESTADOS_CRITICAL_PROVIDERS.has(provider.name)) ? 2 : 0;
      return fetchWithRetry(provider.name, provider.fetchFn, maxRetries);
    });

    const builtinResults = await Promise.all(providerPromises);
    
    // Merge built-in and dynamic provider results
    const results = [...builtinResults, ...dynamicProviderResults];

    // Log outcomes
    for (const r of results) {
      console.log(`[demo] ${r.provider}: outcome=${r.outcome}, found=${r.found_status}, acts=${r.actuaciones.length}, estados=${r.estados.length}, latency=${r.latency_ms}ms${r.error ? `, error=${r.error}` : ""}`);
    }

    // 4. Collect and dedupe all actuaciones + estados from providers
    const allActs: DemoActuacion[] = [];
    const allEstados: DemoEstado[] = [];
    for (const r of results) {
      allActs.push(...r.actuaciones);
      allEstados.push(...r.estados);
    }

    const freshActuaciones = dedupeActuaciones(allActs);
    const freshEstados = dedupeEstados(allEstados);

    // ═══ PHASE 3: Merge with cache (strict append-only) ═══
    const cachedPayload: CachedPayload = cached ? {
      proceso: cached.proceso || {},
      partes: cached.partes || [],
      actuaciones: cached.actuaciones || [],
      estados: cached.estados || [],
    } : { proceso: {}, partes: [], actuaciones: [], estados: [] };

    // Build fresh proceso metadata from provider results
    const freshProceso: Record<string, any> = {};
    const freshPartes: any[] = [];
    for (const r of results) {
      if (r.metadata?.despacho && !freshProceso.despacho) freshProceso.despacho = r.metadata.despacho;
      if (r.metadata?.tipo_proceso && !freshProceso.tipo_proceso) freshProceso.tipo_proceso = r.metadata.tipo_proceso;
      if (r.metadata?.fecha_radicacion && !freshProceso.fecha_radicacion) freshProceso.fecha_radicacion = r.metadata.fecha_radicacion;
      if (r.parties?.demandante) freshPartes.push({ tipo: "demandante", nombre: r.parties.demandante });
      if (r.parties?.demandado) freshPartes.push({ tipo: "demandado", nombre: r.parties.demandado });
    }

    const freshPayload: CachedPayload = {
      proceso: freshProceso,
      partes: freshPartes,
      actuaciones: freshActuaciones,
      estados: freshEstados,
    };

    const merged = mergeWithStrictRules(cachedPayload, freshPayload);

    // Re-dedupe the merged arrays (handles cross-cache + fresh duplicates cleanly)
    const actuaciones = dedupeActuaciones(merged.actuaciones);
    const estados = dedupeEstados(merged.estados);

    // 5. Check if any data was found (from providers OR cache)
    const sourcesWithData = results.filter(r => r.outcome === "success");
    const dataFound = sourcesWithData.length > 0 || actuaciones.length > 0 || estados.length > 0;

    // ═══ LAST-RESORT FALLBACK: work_item_publicaciones (read-only) ═══
    // Only triggered when: (a) no cache existed AND (b) all providers failed.
    // This recovers data for radicados that are already tracked as work items.
    if (!dataFound && !cached) {
      try {
        console.log("[demo] All providers failed on cold cache — trying work_item_publicaciones fallback");
        // Find work_item by radicado
        const { data: wi } = await supabaseAdmin
          .from("work_items")
          .select("id")
          .eq("radicado", radicado)
          .maybeSingle();

        if (wi) {
          // Read estados from work_item_publicaciones
          const { data: pubs } = await supabaseAdmin
            .from("work_item_publicaciones")
            .select("title, annotation, pdf_url, published_at, fecha_fijacion, source, sources")
            .eq("work_item_id", wi.id)
            .eq("is_archived", false)
            .order("published_at", { ascending: false, nullsFirst: false })
            .limit(30);

          if (pubs && pubs.length > 0) {
            console.log(`[demo] Fallback found ${pubs.length} publicaciones from work_item ${wi.id}`);
            for (const pub of pubs) {
              const fecha = normalizeDate(pub.published_at || pub.fecha_fijacion);
              const attachments: DemoEstadoAttachment[] = [];
              if (pub.pdf_url && typeof pub.pdf_url === "string" && pub.pdf_url.startsWith("https")) {
                attachments.push({
                  type: pub.pdf_url.toLowerCase().includes(".pdf") ? "pdf" : "link",
                  url: pub.pdf_url,
                  label: "Ver PDF",
                  provider: "DB Fallback",
                });
              }
              estados.push({
                tipo: truncate(String(pub.title || "Estado"), 120) || "Estado",
                fecha: fecha || "",
                descripcion: pub.annotation ? redactPIIFromText(truncate(String(pub.annotation), 200) || "") : null,
                sources: Array.isArray(pub.sources) ? pub.sources : [pub.source || "DB"],
                attachments: attachments.length > 0 ? attachments : undefined,
              });
            }
          }

          // Also read actuaciones from work_item_acts as fallback
          const { data: acts } = await supabaseAdmin
            .from("work_item_acts")
            .select("act_date, act_type, description, annotation, source")
            .eq("work_item_id", wi.id)
            .order("act_date", { ascending: false, nullsFirst: false })
            .limit(50);

          if (acts && acts.length > 0) {
            console.log(`[demo] Fallback found ${acts.length} actuaciones from work_item ${wi.id}`);
            for (const act of acts) {
              actuaciones.push({
                fecha: normalizeDate(act.act_date) || "",
                tipo: truncate(String(act.act_type || ""), 120),
                descripcion: act.description ? redactPIIFromText(truncate(String(act.description), 300) || "") : "",
                anotacion: act.annotation ? redactPIIFromText(truncate(String(act.annotation), 200) || "") : null,
                sources: [act.source || "DB"],
              });
            }
          }
        }
      } catch (fbErr) {
        console.warn("[demo] work_item fallback failed (non-blocking):", fbErr);
      }
    }

    const finalDataFound = sourcesWithData.length > 0 || actuaciones.length > 0 || estados.length > 0;

    if (!finalDataFound) {
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
    // Enrich resumen from cached proceso if providers didn't provide
    if (!resumen.despacho && merged.proceso.despacho) resumen.despacho = merged.proceso.despacho;
    if (!resumen.tipo_proceso && merged.proceso.tipo_proceso) resumen.tipo_proceso = merged.proceso.tipo_proceso;
    if (!resumen.fecha_radicacion && merged.proceso.fecha_radicacion) resumen.fecha_radicacion = merged.proceso.fecha_radicacion;
    // Enrich parties from cached partes
    if (!resumen.demandante) {
      const cachedDem = merged.partes.find((p: any) => p.tipo === "demandante");
      if (cachedDem) resumen.demandante = cachedDem.nombre;
    }
    if (!resumen.demandado) {
      const cachedDdo = merged.partes.find((p: any) => p.tipo === "demandado");
      if (cachedDdo) resumen.demandado = cachedDdo.nombre;
    }
    resumen.total_actuaciones = actuaciones.length;
    resumen.total_estados = estados.length;
    resumen.ultima_actuacion_fecha = actuaciones[0]?.fecha || estados[0]?.fecha || null;
    resumen.ultima_actuacion_tipo = actuaciones[0]?.tipo || null;

    // 7. Category inference
    const categoryInference = inferCategory(results, radicado);

    // 8. Build provider outcomes for response
    const providerOutcomes = results.map(r => ({
      name: r.provider,
      label: getProviderLabel(r.provider),
      outcome: r.outcome,
      found_status: r.found_status,
      latency_ms: r.latency_ms,
      actuaciones_count: r.actuaciones.length,
      estados_count: r.estados.length,
    }));

    // ═══ Write merged result to cache (non-blocking) ═══
    const providerResultsMeta: Record<string, any> = {};
    for (const r of results) {
      providerResultsMeta[r.provider] = {
        status: r.outcome,
        count: r.actuaciones.length + r.estados.length,
        latency_ms: r.latency_ms,
      };
    }
    const contentHash = simpleHash({ actuaciones, estados, proceso: merged.proceso });

    supabaseAdmin
      .from("demo_radicado_cache")
      .upsert({
        radicado_normalized: radicado,
        radicado: radicado,
        inferred_category: categoryInference.category,
        proceso: merged.proceso,
        partes: merged.partes,
        actuaciones: actuaciones.slice(0, 100),
        estados: estados.slice(0, 50),
        provider_results: providerResultsMeta,
        providers_consulted: results.length,
        providers_succeeded: sourcesWithData.length,
        last_refresh_at: new Date().toISOString(),
        content_hash: contentHash,
        updated_at: new Date().toISOString(),
      }, { onConflict: "radicado_normalized" })
      .then(({ error }) => {
        if (error) console.warn("[demo] Cache write failed:", error.message);
        else console.log("[demo] Cache updated for radicado", maskRadicado(radicado));
      });

    // 9. Determine estados completeness status
    const estadosCriticalProviders = results.filter(r => ESTADOS_CRITICAL_PROVIDERS.has(r.provider));
    const estadosCriticalPending = estadosCriticalProviders.filter(r => r.outcome === "timeout" || r.outcome === "error");
    const estadosCriticalExplicitNotFound = estadosCriticalProviders.filter(r => r.outcome === "no-data" || r.outcome === "success");
    let estados_status: "READY" | "DEGRADED" | "PARTIAL";
    if (estados.length > 0) {
      // We have estados — but were some critical providers still failing?
      estados_status = estadosCriticalPending.length > 0 ? "PARTIAL" : "READY";
    } else if (estadosCriticalExplicitNotFound.length === estadosCriticalProviders.length && estadosCriticalProviders.length > 0) {
      // All critical providers responded explicitly with no-data — this is legit
      estados_status = "READY";
    } else if (estadosCriticalPending.length > 0) {
      // No estados AND some critical providers timed out — degraded
      estados_status = "DEGRADED";
    } else {
      estados_status = "READY";
    }

    // Build response with _meta
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
        // Cache metadata
        served_from_cache: !!cached && isFresh,
        cache_age_minutes: cacheAgeMinutes,
        refreshed_at: new Date().toISOString(),
        provider_details: providerResultsMeta,
        // Estados completeness
        estados_status,
        estados_degraded_providers: estadosCriticalPending.map(r => r.provider),
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
