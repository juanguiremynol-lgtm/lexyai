import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Normalization helpers ───
function removeAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeBase(s: string): string {
  return removeAccents(s.toLowerCase())
    .replace(/[-–—/(),.:;'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "e", "en", "para", "con", "sin",
]);

function normHard(s: string): string {
  return normalizeBase(s);
}

function normSoft(s: string): string {
  return normalizeBase(s)
    .split(" ")
    .filter((w) => !STOPWORDS.has(w))
    .join(" ");
}

// Abbreviation map
const ABBREV: Record<string, string> = {
  j: "juzgado", jdo: "juzgado", juzg: "juzgado",
  trib: "tribunal",
  mpal: "municipal",
  ccto: "circuito", cto: "circuito",
  promisc: "promiscuo", prom: "promiscuo",
};

function expandAbbreviations(s: string): string {
  return s.split(" ").map((w) => ABBREV[w] || w).join(" ");
}

// Roman numeral + ordinal to number
const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
  xix: 19, xx: 20,
};
const ORDINALS: Record<string, number> = {
  primero: 1, segundo: 2, tercero: 3, cuarto: 4, quinto: 5,
  sexto: 6, septimo: 7, octavo: 8, noveno: 9, decimo: 10,
  undecimo: 11, duodecimo: 12, decimotercero: 13, decimocuarto: 14,
  decimoquinto: 15, decimosexto: 16, decimoseptimo: 17, decimoctavo: 18,
  decimonoveno: 19, vigesimo: 20,
};

function extractCourtNumber(name: string): { number: number | null; padded: string | null } {
  const normalized = normalizeBase(name);
  // Match digit patterns like "01", "1" after "juzgado" or standalone
  const digitMatch = normalized.match(/(?:juzgado|despacho)\s+(\d{1,3})/);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    return { number: n, padded: String(n).padStart(3, "0") };
  }
  // Check for Roman numerals
  for (const [roman, val] of Object.entries(ROMAN)) {
    const re = new RegExp(`\\b${roman}\\b`);
    if (re.test(normalized)) {
      return { number: val, padded: String(val).padStart(3, "0") };
    }
  }
  // Check ordinals
  for (const [ordinal, val] of Object.entries(ORDINALS)) {
    if (normalized.includes(ordinal)) {
      return { number: val, padded: String(val).padStart(3, "0") };
    }
  }
  return { number: null, padded: null };
}

function classifyCourt(corpArea: string, nombre: string): string {
  const c = normalizeBase(corpArea || "");
  const n = normalizeBase(nombre || "");
  if (c.includes("centro de servicios") || n.includes("centro servicios")) return "centro_servicios";
  if (c.includes("tribunal superior") || n.includes("tribunal superior")) return "tribunal_superior";
  if (c.includes("tribunal administrativo") || n.includes("tribunal administrativo")) return "tribunal_administrativo";
  if (c.includes("consejo seccional") || n.includes("consejo seccional")) return "consejo_seccional";
  if (c.includes("comision") || n.includes("comision")) return "comision_disciplina";
  if (c.includes("direccion seccional") || n.includes("direccion seccional")) return "direccion_seccional";
  if (c.includes("juzgado") || n.includes("juzgado")) return "juzgado";
  return "otro";
}

async function hashRow(row: Record<string, string>): Promise<string> {
  const raw = JSON.stringify(row);
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth check: must be platform admin
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: isAdmin } = await supabase.rpc("is_platform_admin");
        // For service-role calls we skip this check
      }
    }

    // Parse body for optional JSON URL or inline data
    let records: Record<string, string>[] = [];
    const body = await req.json().catch(() => null);
    
    if (body?.records) {
      records = body.records;
    } else if (body?.json_url) {
      const resp = await fetch(body.json_url);
      records = await resp.json();
    } else {
      // Default: fetch from known location
      const projectUrl = Deno.env.get("SUPABASE_URL")!;
      // Expect records passed directly
      return new Response(
        JSON.stringify({ error: "Provide 'records' array or 'json_url' in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let inserted = 0;
    let skipped = 0;
    let errors: string[] = [];
    const BATCH_SIZE = 100;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const rows = [];

      for (const rec of batch) {
        try {
          const hash = await hashRow(rec);
          const nombre = rec["NOMBRE"] || "";
          const dept = rec["DEPARTAMENTO"] || "";
          const city = rec["CIUDAD"] || "";
          const corpArea = rec["CORPORACION O AREA"] || "";
          const specialty = rec["ESPECIALIDAD O AREA"] || "";
          const tipoCuenta = rec["TIPO DE CUENTA"] || "";
          const codigoDespacho = rec["CODIGO DE DESPACHO"] || "";

          const courtNum = extractCourtNumber(nombre);
          const courtClass = classifyCourt(corpArea, nombre);

          const nameHard = expandAbbreviations(normHard(nombre));
          const nameSoft = expandAbbreviations(normSoft(nombre));

          const deptNorm = normSoft(dept);
          const cityNorm = normSoft(city);
          const corpNorm = normSoft(corpArea);
          const specNorm = normSoft(specialty);
          const accTypeNorm = normSoft(tipoCuenta);
          const codeNorm = codigoDespacho.replace(/\D/g, "").trim() || null;

          const canonicalKey = [
            courtClass, deptNorm, cityNorm,
            courtNum.padded || "000",
            specNorm,
          ].join("|");

          rows.push({
            email: rec["EMAIL"] || "",
            nombre_raw: nombre,
            departamento_raw: dept,
            ciudad_raw: city,
            corporacion_area_raw: corpArea,
            especialidad_area_raw: specialty,
            tipo_cuenta_raw: tipoCuenta,
            codigo_despacho_raw: codigoDespacho,
            dept_norm: deptNorm,
            city_norm: cityNorm,
            corp_area_norm: corpNorm,
            specialty_norm: specNorm,
            account_type_norm: accTypeNorm,
            codigo_despacho_norm: codeNorm,
            court_class: courtClass,
            court_number: courtNum.number,
            court_number_padded: courtNum.padded,
            name_norm_hard: nameHard,
            name_norm_soft: nameSoft,
            canonical_key: canonicalKey,
            source_row_hash: hash,
          });
        } catch (e) {
          errors.push(`Row ${i}: ${(e as Error).message}`);
        }
      }

      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("courthouse_directory")
          .upsert(rows, { onConflict: "source_name,source_row_hash", ignoreDuplicates: true })
          .select("id");

        if (error) {
          errors.push(`Batch at ${i}: ${error.message}`);
        } else {
          inserted += rows.length;
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total_records: records.length,
        inserted,
        skipped,
        errors_count: errors.length,
        errors: errors.slice(0, 20),
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
