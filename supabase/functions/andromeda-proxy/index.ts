/**
 * andromeda-proxy — Tenant-aware proxy for the Andromeda Read API.
 *
 * Replaces direct browser calls to the GCP read-api. Enforces:
 *   1. Caller has a valid Supabase JWT.
 *   2. Radicado-scoped paths only expose radicados owned by the caller's org.
 *   3. Upstream is called with a server-side X-API-Key (never seen by the browser).
 *
 * Request body:
 *   {
 *     "path": "/radicados/:radicado" | "/radicados/:radicado/actuaciones"
 *           | "/radicados/:radicado/novedades" | "/radicados/:radicado/estados"
 *           | "/novedades" | "/terminos" | "/salud",
 *     "query"?: Record<string, string | number>
 *   }
 *
 * Response mirrors upstream body under `{ ok: true, status, body }`.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const ANDROMEDA_API_BASE =
  "https://andromeda-read-api-11974381924.us-central1.run.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Allowed path shapes. Radicado-scoped paths get tenant checks.
// Group patterns: [regex, requiresRadicado, listFilterKey]
//   listFilterKey: if set, response is a list that we post-filter by the org's radicados
const PATH_RULES: Array<{
  re: RegExp;
  requiresRadicado: boolean;
  listFilter?: { arrayKey: string; radicadoKey: string };
}> = [
  { re: /^\/radicados\/[0-9]{15,30}$/, requiresRadicado: true },
  { re: /^\/radicados\/[0-9]{15,30}\/actuaciones$/, requiresRadicado: true },
  { re: /^\/radicados\/[0-9]{15,30}\/novedades$/, requiresRadicado: true },
  { re: /^\/radicados\/[0-9]{15,30}\/estados$/, requiresRadicado: true },
  {
    re: /^\/novedades$/,
    requiresRadicado: false,
    listFilter: { arrayKey: "novedades", radicadoKey: "radicado" },
  },
  {
    re: /^\/terminos$/,
    requiresRadicado: false,
    listFilter: { arrayKey: "terminos", radicadoKey: "radicado" },
  },
  { re: /^\/salud$/, requiresRadicado: false },
];

function pickRule(path: string) {
  return PATH_RULES.find((r) => r.re.test(path));
}

function extractRadicado(path: string): string | null {
  const m = path.match(/^\/radicados\/([0-9]{15,30})/);
  return m ? m[1] : null;
}

function buildQuery(query?: Record<string, string | number>) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(k)) continue; // reject weird keys
    params.set(k, String(v).slice(0, 128));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANDROMEDA_API_KEY = Deno.env.get("ANDROMEDA_API_KEY") || "";

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    let payload: { path?: string; query?: Record<string, string | number> };
    try {
      payload = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const path = (payload.path || "").trim();
    if (!path.startsWith("/")) {
      return json({ ok: false, error: "Invalid path" }, 400);
    }

    const rule = pickRule(path);
    if (!rule) {
      return json({ ok: false, error: `Path not allowed: ${path}` }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Resolve caller's org
    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .maybeSingle();
    const orgId = profile?.organization_id;
    if (!orgId) {
      return json({ ok: false, error: "No organization" }, 403);
    }

    // Radicado-scoped: verify ownership
    if (rule.requiresRadicado) {
      const radicado = extractRadicado(path);
      if (!radicado) return json({ ok: false, error: "Invalid radicado" }, 400);
      const { data: wi } = await admin
        .from("work_items")
        .select("id")
        .eq("organization_id", orgId)
        .eq("radicado", radicado)
        .is("deleted_at", null)
        .limit(1);
      if (!wi || wi.length === 0) {
        return json({ ok: false, error: "Radicado not found in this organization" }, 404);
      }
    }

    // Build the upstream URL
    const url = `${ANDROMEDA_API_BASE}${path}${buildQuery(payload.query)}`;

    const upstreamHeaders: Record<string, string> = { Accept: "application/json" };
    if (ANDROMEDA_API_KEY) upstreamHeaders["X-API-Key"] = ANDROMEDA_API_KEY;

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(url, { method: "GET", headers: upstreamHeaders });
    } catch (e) {
      return json({ ok: false, error: `Upstream fetch failed: ${(e as Error).message}` }, 502);
    }

    const upstreamText = await upstreamRes.text();
    let upstreamBody: unknown = null;
    try {
      upstreamBody = JSON.parse(upstreamText);
    } catch {
      upstreamBody = upstreamText;
    }

    // For list endpoints, filter by the org's radicados before returning
    if (rule.listFilter && upstreamRes.ok && upstreamBody && typeof upstreamBody === "object") {
      const { arrayKey, radicadoKey } = rule.listFilter;
      const src = upstreamBody as Record<string, unknown>;
      const list = Array.isArray(src[arrayKey]) ? (src[arrayKey] as Array<Record<string, unknown>>) : null;
      if (list) {
        // Fetch all radicados for this org
        const { data: ownedRows } = await admin
          .from("work_items")
          .select("radicado")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .not("radicado", "is", null);
        const owned = new Set((ownedRows || []).map((r) => String(r.radicado)));
        const filtered = list.filter((row) => {
          const rad = row?.[radicadoKey];
          return typeof rad === "string" && owned.has(rad);
        });
        (upstreamBody as Record<string, unknown>)[arrayKey] = filtered;
        (upstreamBody as Record<string, unknown>).total = filtered.length;
      }
    }

    return json({ ok: upstreamRes.ok, status: upstreamRes.status, body: upstreamBody });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || "Unexpected error" }, 500);
  }
});