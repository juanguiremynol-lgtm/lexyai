import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Text normalization ───
function removeAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeBase(s: string): string {
  return removeAccents(s.toLowerCase())
    .replace(/[-–—/(),.:;'"°º]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "en", "para", "con", "sin"]);
function normSoft(s: string): string {
  return normalizeBase(s).split(" ").filter((w) => !STOPWORDS.has(w)).join(" ");
}
const ABBREV: Record<string, string> = {
  j: "juzgado", jdo: "juzgado", juzg: "juzgado",
  trib: "tribunal", mpal: "municipal",
  ccto: "circuito", cto: "circuito",
  promisc: "promiscuo", prom: "promiscuo",
  adm: "administrativo", promis: "promiscuo",
};
function expandAbbreviations(s: string): string {
  return s.split(" ").map((w) => ABBREV[w] || w).join(" ");
}
function extractCourtNumber(name: string): number | null {
  const normalized = normalizeBase(name);
  const digitMatch = normalized.match(/(?:juzgado|despacho)\s+(\d{1,3})/);
  if (digitMatch) return parseInt(digitMatch[1], 10);
  const ROMAN: Record<string, number> = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
    xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
  };
  for (const [r, val] of Object.entries(ROMAN)) {
    if (new RegExp(`\\b${r}\\b`).test(normalized)) return val;
  }
  return null;
}

// ─── Trigram similarity ───
function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const t = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    t.add(padded.substring(i, i + 3));
  }
  return t;
}
function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let intersection = 0;
  for (const t of ta) { if (tb.has(t)) intersection++; }
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Radicado parser (mirrors frontend) ───
interface RadicadoBlocks {
  dane: string;
  dept: string;
  municipality: string;
  corp: string;
  esp: string;
  desp: string;
  year: string;
  consec: string;
  recurso: string;
}

interface ParseResult {
  valid: boolean;
  blocks?: RadicadoBlocks;
  radicado23?: string;
  errors: string[];
}

function parseRadicado(input: string | null | undefined): ParseResult {
  if (!input) return { valid: false, errors: ["No radicado provided"] };
  const cleaned = input.replace(/\D/g, "");
  if (cleaned.length !== 23) return { valid: false, errors: [`Length ${cleaned.length}, expected 23`] };
  if (!/^\d{23}$/.test(cleaned)) return { valid: false, errors: ["Non-numeric"] };

  const blocks: RadicadoBlocks = {
    dane: cleaned.slice(0, 5),
    dept: cleaned.slice(0, 2),
    municipality: cleaned.slice(2, 5),
    corp: cleaned.slice(5, 7),
    esp: cleaned.slice(7, 9),
    desp: cleaned.slice(9, 12),
    year: cleaned.slice(12, 16),
    consec: cleaned.slice(16, 21),
    recurso: cleaned.slice(21, 23),
  };

  const yearNum = parseInt(blocks.year, 10);
  const currentYear = new Date().getFullYear();
  if (yearNum < 1990 || yearNum > currentYear + 1) {
    return { valid: false, errors: [`Year ${blocks.year} out of range`] };
  }

  return { valid: true, blocks, radicado23: cleaned, errors: [] };
}

// ─── Types ───
interface Candidate {
  id: number;
  email: string;
  nombre_raw: string;
  dept_norm: string;
  city_norm: string;
  court_class: string;
  specialty_norm: string;
  court_number: number | null;
  name_norm_soft: string;
  name_norm_hard: string;
  codigo_despacho_norm: string | null;
  account_type_norm: string | null;
  dane_code: string | null;
  corp_code: string | null;
  esp_code: string | null;
  desp_code: string | null;
  score: number;
  radicado_match_details?: Record<string, string>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { work_item_id } = body;

    if (!work_item_id) {
      return new Response(
        JSON.stringify({ error: "work_item_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch work item
    const { data: workItem, error: wiErr } = await supabase
      .from("work_items")
      .select("id, authority_name, authority_city, authority_department, authority_email, radicado, raw_courthouse_input, organization_id, owner_id, scraped_fields")
      .eq("id", work_item_id)
      .single();

    if (wiErr || !workItem) {
      return new Response(
        JSON.stringify({ error: "Work item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract inputs
    const rawInput = workItem.raw_courthouse_input as Record<string, string> || {};
    const scrapedFields = workItem.scraped_fields as Record<string, unknown> || {};
    const scrapedDespacho = scrapedFields.despacho as Record<string, string> || {};

    const inputName = body.courthouse_name || rawInput.name || scrapedDespacho.nombre || workItem.authority_name || "";
    const inputCity = body.city || rawInput.city || scrapedDespacho.ciudad || workItem.authority_city || "";
    const inputDept = body.department || rawInput.department || scrapedDespacho.departamento || workItem.authority_department || "";
    const inputCode = body.courthouse_code || rawInput.codigo_despacho || scrapedDespacho.codigo || "";
    const inputSpecialty = body.specialty || rawInput.specialty || "";
    const inputCourtClass = body.court_class || rawInput.court_class || "";
    const preferredAccountType = body.preferred_account_type || "despacho judicial";

    let codeNorm = inputCode.replace(/\D/g, "").trim() || null;

    // ─── Parse radicado ───
    const radicadoInput = body.radicado || workItem.radicado || "";
    const radParsed = parseRadicado(radicadoInput);
    const radBlocks = radParsed.blocks;

    // Store radicado analysis on work_item
    if (radicadoInput) {
      await supabase.from("work_items").update({
        radicado_valid: radParsed.valid,
        radicado_blocks: radParsed.valid && radBlocks ? {
          dane: radBlocks.dane,
          corp: radBlocks.corp,
          esp: radBlocks.esp,
          desp: radBlocks.desp,
          year: radBlocks.year,
          consec: radBlocks.consec,
          recurso: radBlocks.recurso,
        } : null,
        updated_at: new Date().toISOString(),
      }).eq("id", work_item_id);
    }

    if (!inputName && !inputCity && !inputDept && !codeNorm && !radParsed.valid) {
      await supabase.from("work_items").update({
        resolution_method: "not_found",
        resolution_confidence: 0,
        courthouse_needs_review: false,
        resolution_candidates: null,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", work_item_id);

      return new Response(
        JSON.stringify({ ok: true, method: "not_found", reason: "No input to match" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const nameNormSoft = expandAbbreviations(normSoft(inputName));
    const cityNorm = normSoft(inputCity);
    const deptNorm = normSoft(inputDept);
    const inputCourtNumber = extractCourtNumber(inputName);
    const specialtyNorm = inputSpecialty ? normSoft(inputSpecialty) : null;
    const courtClassNorm = inputCourtClass ? normalizeBase(inputCourtClass) : null;

    // ─── Candidate generation ───
    const selectFields = "id, email, nombre_raw, dept_norm, city_norm, court_class, specialty_norm, court_number, name_norm_soft, name_norm_hard, codigo_despacho_norm, account_type_norm, dane_code, corp_code, esp_code, desp_code";
    let candidates: Candidate[] = [];

    // ─── Detect DANE-authority geo mismatch ───
    // If radicado DANE points to city A but authority_name mentions city B,
    // the radicado may be from a different jurisdiction. In that case,
    // we should NOT use radicado DANE for geo filtering — fall back to name-based matching.
    let radicadoGeoTrusted = true;
    const knownCityPatterns: Record<string, string[]> = {
      "11001": ["bogota"],
      "05001": ["medellin"],
      "76001": ["cali"],
      "08001": ["barranquilla"],
      "13001": ["cartagena"],
      "68001": ["bucaramanga"],
      "05615": ["rionegro"],
      "15001": ["tunja"],
      "17001": ["manizales"],
      "54001": ["cucuta"],
      "66001": ["pereira"],
      "23001": ["monteria"],
      "73001": ["ibague"],
      "41001": ["neiva"],
      "52001": ["pasto"],
      "47001": ["santa marta"],
      "50001": ["villavicencio"],
      "19001": ["popayan"],
      "44001": ["riohacha"],
    };
    if (radParsed.valid && radBlocks && inputName) {
      const nameNormLower = normalizeBase(inputName);
      const radicadoDane = radBlocks.dane;
      for (const [dane, cities] of Object.entries(knownCityPatterns)) {
        if (dane === radicadoDane) continue;
        for (const city of cities) {
          if (nameNormLower.includes(city)) {
            radicadoGeoTrusted = false;
            break;
          }
        }
        if (!radicadoGeoTrusted) break;
      }
    }

    // Strategy 0: Radicado-based exact code match (highest priority)
    // Only use when radicado geo is trusted (no DANE-authority name conflict)
    if (radParsed.valid && radBlocks && radicadoGeoTrusted) {
      // Try full match: dane + corp + esp + desp
      const { data } = await supabase
        .from("courthouse_directory")
        .select(selectFields)
        .eq("dane_code", radBlocks.dane)
        .eq("corp_code", radBlocks.corp)
        .eq("esp_code", radBlocks.esp)
        .eq("desp_code", radBlocks.desp)
        .limit(20);
      if (data && data.length > 0) {
        candidates = data.map((r) => ({ ...r, score: 0, radicado_match_details: { level: "exact_full" } }));
      }

      // Relax: dane + corp + desp (skip esp) — ESP codes often differ between radicado and directory
      if (candidates.length === 0) {
        const { data: d2 } = await supabase
          .from("courthouse_directory")
          .select(selectFields)
          .eq("dane_code", radBlocks.dane)
          .eq("corp_code", radBlocks.corp)
          .eq("desp_code", radBlocks.desp)
          .limit(30);
        if (d2 && d2.length > 0) {
          candidates = d2.map((r) => ({ ...r, score: 0, radicado_match_details: { level: "dane_corp_desp" } }));
        }
      }

      // Collegiate body: DESP=000 → expand to ALL desks of same DANE+CORP
      if (candidates.length === 0 && radBlocks.desp === "000") {
        const { data: d2b } = await supabase
          .from("courthouse_directory")
          .select(selectFields)
          .eq("dane_code", radBlocks.dane)
          .eq("corp_code", radBlocks.corp)
          .limit(50);
        if (d2b && d2b.length > 0) {
          candidates = d2b.map((r) => ({ ...r, score: 0, radicado_match_details: { level: "collegiate_body" } }));
        }
      }

      // Relax: dane + corp + esp (skip desp)
      if (candidates.length === 0) {
        const { data: d3 } = await supabase
          .from("courthouse_directory")
          .select(selectFields)
          .eq("dane_code", radBlocks.dane)
          .eq("corp_code", radBlocks.corp)
          .eq("esp_code", radBlocks.esp)
          .limit(30);
        if (d3 && d3.length > 0) {
          candidates = d3.map((r) => ({ ...r, score: 0, radicado_match_details: { level: "dane_corp_esp" } }));
        }
      }

      // Relax: dane only (broadest radicado filter)
      if (candidates.length === 0) {
        const { data: d4 } = await supabase
          .from("courthouse_directory")
          .select(selectFields)
          .eq("dane_code", radBlocks.dane)
          .limit(200);
        if (d4 && d4.length > 0) {
          candidates = d4.map((r) => ({ ...r, score: 0, radicado_match_details: { level: "dane_only" } }));
        }
      }
    }

    // Strategy 0b: Radicado geo NOT trusted — extract city from authority name and search by city + name
    if (radParsed.valid && radBlocks && !radicadoGeoTrusted && inputName) {
      // Try to extract a city name from the authority name
      const nameNormLower = normalizeBase(inputName);
      const allCities = Object.entries(knownCityPatterns).flatMap(([, cities]) => cities);
      const detectedCity = allCities.find(city => nameNormLower.includes(city));
      
      if (detectedCity) {
        // Search by detected city + name similarity
        const { data } = await supabase
          .from("courthouse_directory")
          .select(selectFields)
          .eq("city_norm", detectedCity)
          .limit(200);
        if (data && data.length > 0) {
          candidates = data
            .map((r) => ({ ...r, score: 0, radicado_match_details: { level: "name_fallback_city_detected", detected_city: detectedCity } }))
            .filter((c) => trigramSimilarity(c.name_norm_soft, nameNormSoft) >= 0.25);
        }
      }
      
      // If city detection didn't work, try broader search with higher similarity threshold
      if (candidates.length === 0) {
        const { data } = await supabase
          .from("courthouse_directory")
          .select(selectFields)
          .limit(500);
        if (data && data.length > 0) {
          candidates = data
            .map((r) => ({ ...r, score: 0, radicado_match_details: { level: "name_fallback_broad" } }))
            .filter((c) => trigramSimilarity(c.name_norm_soft, nameNormSoft) >= 0.35);
        }
      }
    }

    // Strategy 1: by codigo_despacho (if no radicado candidates)
    if (candidates.length === 0 && codeNorm) {
      const { data } = await supabase
        .from("courthouse_directory")
        .select(selectFields)
        .eq("codigo_despacho_norm", codeNorm)
        .limit(50);
      if (data) candidates = data.map((r) => ({ ...r, score: 0 }));
    }

    // Strategy 2: by dept + city + trigram
    if (candidates.length === 0 && deptNorm && cityNorm) {
      const { data } = await supabase
        .from("courthouse_directory")
        .select(selectFields)
        .eq("dept_norm", deptNorm)
        .eq("city_norm", cityNorm)
        .limit(200);
      if (data) {
        candidates = data
          .map((r) => ({ ...r, score: 0 }))
          .filter((c) => {
            if (!nameNormSoft) return true;
            return trigramSimilarity(c.name_norm_soft, nameNormSoft) >= 0.2;
          });
      }
    }

    // Strategy 2b: dept/city might be swapped (common data quality issue)
    // Try matching deptNorm as city or cityNorm as dept
    if (candidates.length === 0 && deptNorm) {
      // Try: user's "department" is actually a city name
      const { data } = await supabase
        .from("courthouse_directory")
        .select(selectFields)
        .eq("city_norm", deptNorm)
        .limit(200);
      if (data && data.length > 0) {
        candidates = data
          .map((r) => ({ ...r, score: 0 }))
          .filter((c) => {
            if (!nameNormSoft) return true;
            return trigramSimilarity(c.name_norm_soft, nameNormSoft) >= 0.2;
          });
      }
    }

    // Strategy 2c: use radicado DANE to find candidates when text-based geo fails
    if (candidates.length === 0 && radParsed.valid && radBlocks) {
      const { data } = await supabase
        .from("courthouse_directory")
        .select(selectFields)
        .eq("dane_code", radBlocks.dane)
        .limit(200);
      if (data && data.length > 0) {
        candidates = data
          .map((r) => ({ ...r, score: 0, radicado_match_details: { level: "dane_fallback" } }))
          .filter((c) => {
            if (!nameNormSoft) return true;
            return trigramSimilarity(c.name_norm_soft, nameNormSoft) >= 0.15;
          });
      }
    }

    // Strategy 3: broader search with just department
    if (candidates.length === 0 && deptNorm && nameNormSoft) {
      const { data } = await supabase
        .from("courthouse_directory")
        .select(selectFields)
        .eq("dept_norm", deptNorm)
        .limit(300);
      if (data) {
        candidates = data
          .map((r) => ({ ...r, score: 0 }))
          .filter((c) => trigramSimilarity(c.name_norm_soft, nameNormSoft) >= 0.3);
      }
    }

    if (candidates.length === 0) {
      const updateData: Record<string, unknown> = {
        resolution_method: "not_found",
        resolution_confidence: 0,
        courthouse_needs_review: false,
        resolved_email: null,
        courthouse_directory_id: null,
        resolution_candidates: null,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await supabase.from("work_items").update(updateData).eq("id", work_item_id);

      if (workItem.organization_id) {
        await supabase.from("audit_logs").insert({
          organization_id: workItem.organization_id,
          actor_user_id: null,
          actor_type: "SYSTEM",
          action: "COURTHOUSE_EMAIL_NOT_FOUND",
          entity_type: "work_item",
          entity_id: work_item_id,
          metadata: { input_name: inputName, input_city: inputCity, input_dept: inputDept, radicado_valid: radParsed.valid },
        });
      }

      return new Response(
        JSON.stringify({ ok: true, method: "not_found", candidates_count: 0, radicado_valid: radParsed.valid }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Hard gating (radicado-aware) ───
    // When radicado is valid and DANE matches, trust radicado codes over text fields
    // (work items often have city/dept swapped or incorrect text)
    const gated = candidates.filter((c) => {
      // If candidate was matched via radicado DANE, skip dept/city text gating
      // The radicado DANE is a deterministic geographic code — more reliable than free text
      const candidateMatchedByDane = radParsed.valid && radBlocks && c.dane_code === radBlocks.dane;

      if (!candidateMatchedByDane) {
        // For non-radicado matches, apply text-based geo gating but allow partial matches
        // Check dept OR city (not both required) — handles swapped dept/city values
        if (deptNorm && cityNorm) {
          const deptMatch = c.dept_norm === deptNorm || c.city_norm === deptNorm;
          const cityMatch = c.city_norm === cityNorm || c.dept_norm === cityNorm;
          if (!deptMatch && !cityMatch) return false;
        } else if (deptNorm) {
          // dept could actually be a city name (common data quality issue)
          if (c.dept_norm !== deptNorm && c.city_norm !== deptNorm) return false;
        } else if (cityNorm) {
          if (c.city_norm !== cityNorm && c.dept_norm !== cityNorm) return false;
        }
      }

      if (inputCourtNumber !== null && c.court_number !== null && inputCourtNumber !== c.court_number) return false;
      if (courtClassNorm && c.court_class && normalizeBase(c.court_class) !== courtClassNorm) return false;
      if (specialtyNorm && c.specialty_norm && !c.specialty_norm.includes(specialtyNorm)) return false;
      return true;
    });

    const scorable = gated.length > 0 ? gated : candidates;

    // ─── Scoring (radicado-enhanced) ───
    const hasCode = !!codeNorm;
    const hasRadicado = radParsed.valid && !!radBlocks;

    for (const c of scorable) {
      let score = 0;
      const matchDetails: Record<string, string> = {};

      // Radicado code matching (strongest signal)
      if (hasRadicado && radBlocks) {
        let radScore = 0;
        let radChecks = 0;
        let radMatches = 0;

        // DANE must match (mandatory for radicado-based scoring)
        if (c.dane_code) {
          radChecks++;
          if (c.dane_code === radBlocks.dane) {
            radMatches++;
            matchDetails.dane = "match";
          } else {
            matchDetails.dane = "mismatch";
          }
        }

        // CORP
        if (c.corp_code) {
          radChecks++;
          if (c.corp_code === radBlocks.corp) {
            radMatches++;
            matchDetails.corp = "match";
          } else {
            matchDetails.corp = "mismatch";
          }
        }

        // ESP
        if (c.esp_code) {
          radChecks++;
          if (c.esp_code === radBlocks.esp) {
            radMatches++;
            matchDetails.esp = "match";
          } else {
            matchDetails.esp = "mismatch";
          }
        }

        // DESP (skip check for collegiate bodies 000)
        if (c.desp_code && radBlocks.desp !== "000") {
          radChecks++;
          if (c.desp_code === radBlocks.desp) {
            radMatches++;
            matchDetails.desp = "match";
          } else {
            matchDetails.desp = "mismatch";
          }
        }

        if (radChecks > 0) {
          radScore = radMatches / radChecks;
          // Heavy weight for radicado code match
          score += radScore * 0.55;

          // Penalize mismatches strongly
          if (radMatches < radChecks) {
            const mismatchPenalty = (radChecks - radMatches) * 0.08;
            score -= mismatchPenalty;
          }
        }
      }

      // Despacho code match
      if (codeNorm && c.codigo_despacho_norm === codeNorm) {
        score += hasRadicado ? 0.15 : 0.45;
        matchDetails.codigo = "match";
      }

      // Name similarity (boosted when resolving by name due to DANE-authority mismatch)
      if (nameNormSoft) {
        const softSim = trigramSimilarity(c.name_norm_soft, nameNormSoft);
        const hardSim = trigramSimilarity(c.name_norm_hard, expandAbbreviations(normalizeBase(inputName).toLowerCase()));
        const nameSim = Math.max(softSim, hardSim);
        const nameWeight = (!radicadoGeoTrusted) ? 0.50 : (hasRadicado ? 0.20 : 0.35);
        score += nameSim * nameWeight;
        matchDetails.name_sim = nameSim.toFixed(2);
      }

      // Specialty matching (critical for ESP-agnostic disambiguation — Case 2 fix)
      if (specialtyNorm && c.specialty_norm) {
        const specSim = trigramSimilarity(c.specialty_norm, specialtyNorm);
        if (specSim > 0.5) {
          score += 0.08;
          matchDetails.specialty_match = specSim.toFixed(2);
        }
      }
      // Also check if authority name implies a specialty
      if (!specialtyNorm && nameNormSoft && c.specialty_norm) {
        const civilWords = ["civil", "oralidad"];
        const penalWords = ["penal", "garantias", "ejecucion"];
        const laboralWords = ["laboral"];
        const adminWords = ["administrativo", "contencioso"];
        const nameHasCivil = civilWords.some(w => nameNormSoft.includes(w));
        const nameHasPenal = penalWords.some(w => nameNormSoft.includes(w));
        const nameHasLaboral = laboralWords.some(w => nameNormSoft.includes(w));
        const nameHasAdmin = adminWords.some(w => nameNormSoft.includes(w));
        
        const candidateIsCivil = civilWords.some(w => c.specialty_norm.includes(w));
        const candidateIsPenal = penalWords.some(w => c.specialty_norm.includes(w));
        const candidateIsLaboral = laboralWords.some(w => c.specialty_norm.includes(w));
        const candidateIsAdmin = adminWords.some(w => c.specialty_norm.includes(w));
        
        if ((nameHasCivil && candidateIsCivil) || (nameHasPenal && candidateIsPenal) ||
            (nameHasLaboral && candidateIsLaboral) || (nameHasAdmin && candidateIsAdmin)) {
          score += 0.10;
          matchDetails.specialty_inferred = "match";
        } else if ((nameHasCivil && candidateIsPenal) || (nameHasPenal && candidateIsCivil)) {
          score -= 0.10;
          matchDetails.specialty_inferred = "conflict";
        }
      }

      // Dept + city match
      if (deptNorm && c.dept_norm === deptNorm) score += 0.05;
      if (cityNorm && c.city_norm === cityNorm) score += 0.05;

      // Court number match
      if (inputCourtNumber !== null && c.court_number === inputCourtNumber) score += 0.1;

      // Account type preference
      if (c.account_type_norm && normSoft(c.account_type_norm) === normSoft(preferredAccountType)) {
        score += 0.02;
      }

      c.score = Math.max(0, Math.min(score, 1.0));
      c.radicado_match_details = matchDetails;
    }

    // Sort by score desc
    scorable.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      const aIsPreferred = a.account_type_norm && normSoft(a.account_type_norm) === normSoft(preferredAccountType);
      const bIsPreferred = b.account_type_norm && normSoft(b.account_type_norm) === normSoft(preferredAccountType);
      if (bIsPreferred && !aIsPreferred) return 1;
      if (aIsPreferred && !bIsPreferred) return -1;
      return 0;
    });

    const top1 = scorable[0];
    const top2 = scorable.length > 1 ? scorable[1] : null;
    const margin = top2 ? top1.score - top2.score : 1.0;
    const nameSim = nameNormSoft ? trigramSimilarity(top1.name_norm_soft, nameNormSoft) : 0;

    // ─── Radicado hard gating for auto-accept ───
    let radicadoGatingPassed = true;
    const radicadoGatingReasons: string[] = [];

    if (hasRadicado && radBlocks && radicadoGeoTrusted) {
      // Mandatory: DANE must match
      if (top1.dane_code && top1.dane_code !== radBlocks.dane) {
        radicadoGatingPassed = false;
        radicadoGatingReasons.push(`DANE mismatch: ${top1.dane_code} vs ${radBlocks.dane}`);
      }
      // If candidate has corp_code, it must match
      if (top1.corp_code && top1.corp_code !== radBlocks.corp) {
        radicadoGatingPassed = false;
        radicadoGatingReasons.push(`CORP mismatch: ${top1.corp_code} vs ${radBlocks.corp}`);
      }
      // ESP: WARN but do NOT block — ESP codes often differ between radicado and directory
      // (Case 2 fix: civil vs penal courts share DANE+CORP+DESP, differ only in ESP)
      if (top1.esp_code && top1.esp_code !== radBlocks.esp) {
        // Don't fail gating — just note it
        radicadoGatingReasons.push(`ESP differs: ${top1.esp_code} vs ${radBlocks.esp} (non-blocking)`);
      }
      // If candidate has desp_code and not collegiate, it must match
      if (top1.desp_code && radBlocks.desp !== "000" && top1.desp_code !== radBlocks.desp) {
        radicadoGatingPassed = false;
        radicadoGatingReasons.push(`DESP mismatch: ${top1.desp_code} vs ${radBlocks.desp}`);
      }
    } else if (hasRadicado && !radicadoGeoTrusted) {
      // DANE-authority mismatch: don't apply radicado hard gating at all
      radicadoGatingReasons.push("Radicado DANE conflicts with authority name — using name-based matching");
    }

    // ─── Collegiate body detection ───
    const isCollegiateBody = hasRadicado && radBlocks && radBlocks.desp === "000";

    // ─── Decision (stricter with radicado) ───
    let method: string;
    let needsReview = false;

    if (isCollegiateBody) {
      // Collegiate bodies (DESP=000) always need review — can't auto-pick a desk
      method = "collegiate_body";
      needsReview = true;
    } else if (!radicadoGeoTrusted && hasRadicado) {
      // DANE-authority mismatch: use name-based decision
      if (top1.score >= 0.85 && margin >= 0.10) {
        method = "auto_name_fallback";
      } else if (top1.score >= 0.60 && margin >= 0.05) {
        method = "fuzzy_name_fallback";
        needsReview = true;
      } else {
        method = "fuzzy_name_fallback";
        needsReview = true;
      }
    } else if (hasRadicado) {
      // Check if DANE+CORP+DESP all matched (ESP-agnostic — Case 2 fix)
      const radDetails = top1.radicado_match_details || {};
      const coreFields = ["dane", "corp", "desp"].filter((k) => radDetails[k]);
      const coreAllMatch = coreFields.length >= 3 && coreFields.every((k) => radDetails[k] === "match");
      const allFieldsIncludingEsp = ["dane", "corp", "esp", "desp"].filter((k) => radDetails[k]);
      const allRadCodesMatch = allFieldsIncludingEsp.length >= 3 && allFieldsIncludingEsp.every((k) => radDetails[k] === "match");
      const isSingleCandidate = scorable.length === 1 || margin >= 0.15;

      if (radicadoGatingPassed && allRadCodesMatch && isSingleCandidate && top1.score >= 0.55) {
        // All radicado codes match + single/clear candidate = deterministic match
        method = "auto_radicado";
      } else if (radicadoGatingPassed && coreAllMatch && margin >= 0.05 && top1.score >= 0.55) {
        // DANE+CORP+DESP match (ESP may differ) + clear margin = auto-resolve (Case 2 fix)
        method = "auto_radicado";
      } else if (radicadoGatingPassed && top1.score >= 0.80 && margin >= 0.05) {
        // 80%+ confidence with radicado gating = auto-resolve
        method = "auto_radicado";
      } else if (radicadoGatingPassed && top1.score >= 0.65 && margin >= 0.03) {
        method = "fuzzy_radicado";
        needsReview = true;
      } else {
        method = "fuzzy_radicado";
        needsReview = true;
      }
    } else if (hasCode) {
      if (top1.score >= 0.85 && margin >= 0.05) {
        method = "auto_code";
      } else {
        method = "fuzzy";
        needsReview = true;
      }
    } else {
      // Name-only: even stricter
      if (top1.score >= 0.92 && margin >= 0.08 && nameSim >= 0.85) {
        method = "auto_fuzzy";
      } else {
        method = "fuzzy";
        needsReview = true;
      }
    }

    // Build top 5 candidates
    const topCandidates = scorable.slice(0, 5).map((c) => ({
      id: c.id,
      email: c.email,
      nombre_despacho: c.nombre_raw,
      ciudad: c.city_norm,
      departamento: c.dept_norm,
      specialty: c.specialty_norm,
      tipo_cuenta: c.account_type_norm || "",
      similarity_score: Math.round(c.score * 100) / 100,
      radicado_match: c.radicado_match_details || null,
    }));

    // Persist resolution to new state machine
    const confidence = Math.round(top1.score * 100) / 100;
    const eventType = needsReview 
      ? (scorable.length > 1 && margin < 0.10 ? 'CONFLICT_DETECTED' : 'SUGGESTED')
      : 'SUGGESTED';
    
    const evidence = {
      method,
      source_radicado: hasRadicado,
      source_authority_id: hasCode,
      radicado_blocks: radParsed.valid ? radBlocks : null,
      radicado_geo_trusted: radicadoGeoTrusted,
      is_collegiate_body: isCollegiateBody,
      radicado_gating_passed: hasRadicado ? radicadoGatingPassed : null,
      top1_score: top1.score,
      top2_score: top2 ? top2.score : null,
      margin,
      candidates_count: scorable.length,
    };

    // Update work_items status + suggested email (if not already confirmed)
    const updateData: Record<string, unknown> = {
      courthouse_directory_id: top1.id,
      resolved_email: needsReview ? null : top1.email,
      resolution_method: method,
      resolution_confidence: confidence,
      courthouse_needs_review: needsReview,
      resolution_candidates: topCandidates,
      resolved_at: needsReview ? null : new Date().toISOString(),
      raw_courthouse_input: {
        ...rawInput,
        name: inputName,
        city: inputCity,
        department: inputDept,
        codigo_despacho: inputCode,
      },
      updated_at: new Date().toISOString(),
    };

    if (!needsReview) {
      updateData.authority_email = top1.email;
    }

    await supabase.from("work_items").update(updateData).eq("id", work_item_id);

    // Write to work_item_email_events (trigger will sync work_items state machine)
    const emailEventStatus = eventType === 'CONFLICT_DETECTED' ? 'CONFLICT' : 
                             needsReview ? 'SUGGESTED' : 'SUGGESTED';
    
    await supabase.from("work_item_email_events").insert({
      work_item_id,
      actor_type: "SYSTEM",
      event_type: eventType,
      suggested_email: needsReview ? null : top1.email,
      confidence,
      source: method,
      evidence: evidence,
    });

    // Audit log (legacy, kept for backward compat)
    if (workItem.organization_id) {
      const auditAction = needsReview ? "COURTHOUSE_EMAIL_NEEDS_REVIEW" : "COURTHOUSE_EMAIL_RESOLVED";
      await supabase.from("audit_logs").insert({
        organization_id: workItem.organization_id,
        actor_user_id: null,
        actor_type: "SYSTEM",
        action: auditAction,
        entity_type: "work_item",
        entity_id: work_item_id,
        metadata: {
          method,
          confidence,
          resolved_email: needsReview ? null : top1.email,
          candidates_count: topCandidates.length,
          total_scored: scorable.length,
          radicado_valid: radParsed.valid,
          radicado_geo_trusted: radicadoGeoTrusted,
          is_collegiate_body: isCollegiateBody,
          radicado_gating_passed: hasRadicado ? radicadoGatingPassed : null,
          radicado_gating_reasons: radicadoGatingReasons.length > 0 ? radicadoGatingReasons : null,
        },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        method,
        needs_review: needsReview,
        confidence: Math.round(top1.score * 100) / 100,
        resolved_email: needsReview ? null : top1.email,
        top_candidates: topCandidates,
        total_candidates: scorable.length,
        radicado_valid: radParsed.valid,
        radicado_blocks: radParsed.valid ? radBlocks : null,
        radicado_geo_trusted: radicadoGeoTrusted,
        is_collegiate_body: isCollegiateBody,
        radicado_gating_passed: hasRadicado ? radicadoGatingPassed : null,
        radicado_gating_reasons: radicadoGatingReasons,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
