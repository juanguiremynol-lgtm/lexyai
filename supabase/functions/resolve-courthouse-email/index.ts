import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Normalization (mirrors importer) ───
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

// Trigram similarity (Jaccard on character trigrams)
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
  score: number;
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

    // Extract input sources — merge: overrides > raw_courthouse_input > scraped_fields > authority_*
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

    if (!inputName && !inputCity && !inputDept && !codeNorm) {
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
    const selectFields = "id, email, nombre_raw, dept_norm, city_norm, court_class, specialty_norm, court_number, name_norm_soft, name_norm_hard, codigo_despacho_norm, account_type_norm";
    let candidates: Candidate[] = [];

    // Strategy 1: by codigo_despacho
    if (codeNorm) {
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

      // Audit log
      if (workItem.organization_id) {
        await supabase.from("audit_logs").insert({
          organization_id: workItem.organization_id,
          actor_user_id: null,
          actor_type: "SYSTEM",
          action: "COURTHOUSE_EMAIL_NOT_FOUND",
          entity_type: "work_item",
          entity_id: work_item_id,
          metadata: { input_name: inputName, input_city: inputCity, input_dept: inputDept },
        }).then(() => {});
      }

      return new Response(
        JSON.stringify({ ok: true, method: "not_found", candidates_count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Hard gating ───
    const gated = candidates.filter((c) => {
      if (deptNorm && c.dept_norm !== deptNorm) return false;
      if (cityNorm && c.city_norm !== cityNorm) return false;
      if (inputCourtNumber !== null && c.court_number !== null && inputCourtNumber !== c.court_number) return false;
      if (courtClassNorm && c.court_class && normalizeBase(c.court_class) !== courtClassNorm) return false;
      if (specialtyNorm && c.specialty_norm && !c.specialty_norm.includes(specialtyNorm)) return false;
      return true;
    });

    const scorable = gated.length > 0 ? gated : candidates;

    // ─── Scoring ───
    const hasCode = !!codeNorm;
    for (const c of scorable) {
      let score = 0;

      // Code match (strong signal)
      if (codeNorm && c.codigo_despacho_norm === codeNorm) {
        score += 0.45;
      }

      // Name similarity
      if (nameNormSoft) {
        const softSim = trigramSimilarity(c.name_norm_soft, nameNormSoft);
        const hardSim = trigramSimilarity(c.name_norm_hard, expandAbbreviations(normalizeBase(inputName).toLowerCase()));
        score += Math.max(softSim, hardSim) * 0.35;
      }

      // Dept + city match
      if (deptNorm && c.dept_norm === deptNorm) score += 0.05;
      if (cityNorm && c.city_norm === cityNorm) score += 0.05;

      // Court number match
      if (inputCourtNumber !== null && c.court_number === inputCourtNumber) score += 0.1;

      // Account type preference: slight boost for 'Despacho Judicial'
      if (c.account_type_norm && normSoft(c.account_type_norm) === normSoft(preferredAccountType)) {
        score += 0.02;
      }

      c.score = Math.min(score, 1.0);
    }

    // Sort by score desc; for ties, prefer 'Despacho Judicial' account type
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

    // ─── Decision ───
    let method: string;
    let needsReview = false;

    if (hasCode) {
      if (top1.score >= 0.85 && margin >= 0.05) {
        method = "auto_code";
      } else {
        method = "fuzzy";
        needsReview = true;
      }
    } else {
      if (top1.score >= 0.92 && margin >= 0.08 && nameSim >= 0.85) {
        method = "auto_fuzzy";
      } else if (top1.score >= 0.75 && margin >= 0.05) {
        method = "fuzzy";
        needsReview = true;
      } else {
        method = "fuzzy";
        needsReview = true;
      }
    }

    // Build top 5 candidates for storage
    const topCandidates = scorable.slice(0, 5).map((c) => ({
      id: c.id,
      email: c.email,
      nombre_despacho: c.nombre_raw,
      ciudad: c.city_norm,
      departamento: c.dept_norm,
      specialty: c.specialty_norm,
      tipo_cuenta: c.account_type_norm || "",
      similarity_score: Math.round(c.score * 100) / 100,
    }));

    // Persist resolution
    const updateData: Record<string, unknown> = {
      courthouse_directory_id: top1.id,
      resolved_email: needsReview ? null : top1.email,
      resolution_method: method,
      resolution_confidence: Math.round(top1.score * 100) / 100,
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

    // Also update authority_email if auto-accepted
    if (!needsReview) {
      updateData.authority_email = top1.email;
    }

    await supabase.from("work_items").update(updateData).eq("id", work_item_id);

    // Audit log
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
          confidence: Math.round(top1.score * 100) / 100,
          resolved_email: needsReview ? null : top1.email,
          candidates_count: topCandidates.length,
          total_scored: scorable.length,
        },
      }).then(() => {});
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
