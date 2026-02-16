/**
 * generate-evidence-bundle — Produces a Markdown evidence bundle for a work item sync.
 *
 * AUTHORIZATION:
 *   - Owner: can generate for their own work items
 *   - Org Admin (BUSINESS tier): can generate for any work item in their org
 *   - Super Admin: must use support_access_grants (not implemented in this endpoint)
 *   - All others: 403
 *
 * Input: { work_item_id: string, run_sync?: boolean }
 * Output: { ok, markdown, summary }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Authorization helper (same pattern as delete-work-items) ───
interface AuthContext {
  userId: string;
  organizationId: string | null;
  membershipRole: string | null;
  isBusinessTier: boolean;
}

async function resolveAuthContext(
  serviceClient: ReturnType<typeof createClient>,
  userId: string
): Promise<AuthContext> {
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();

  const orgId = profile?.organization_id ?? null;
  let membershipRole: string | null = null;
  let isBusinessTier = false;

  if (orgId) {
    const { data: membership } = await serviceClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();

    membershipRole = membership?.role ?? null;

    const { data: billing } = await serviceClient
      .from("billing_subscription_state")
      .select("plan_code")
      .eq("organization_id", orgId)
      .maybeSingle();

    isBusinessTier = ["BUSINESS", "ENTERPRISE"].includes(billing?.plan_code ?? "");
  }

  return { userId, organizationId: orgId, membershipRole, isBusinessTier };
}

function canAccessWorkItem(
  auth: AuthContext,
  workItem: { owner_id: string; organization_id: string | null }
): boolean {
  if (workItem.owner_id === auth.userId) return true;
  if (
    auth.isBusinessTier &&
    auth.organizationId &&
    workItem.organization_id === auth.organizationId &&
    (auth.membershipRole === "OWNER" || auth.membershipRole === "ADMIN")
  ) {
    return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminDb = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { work_item_id, run_sync = false } = body;

    if (!work_item_id) {
      return new Response(JSON.stringify({ error: "work_item_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch work item
    const { data: workItem, error: wiErr } = await adminDb
      .from("work_items")
      .select("id, radicado, workflow_type, organization_id, owner_id, scrape_status, last_crawled_at")
      .eq("id", work_item_id)
      .maybeSingle();

    if (wiErr || !workItem) {
      return new Response(JSON.stringify({ error: "Work item not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── AUTHORIZATION CHECK ──
    const auth = await resolveAuthContext(adminDb, user.id);
    if (!canAccessWorkItem(auth, workItem)) {
      return new Response(
        JSON.stringify({ error: "Access denied", code: "FORBIDDEN" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bundleTimestamp = new Date().toISOString();
    let syncActResult: any = null;
    let syncPubResult: any = null;

    // Optionally trigger sync
    if (run_sync) {
      const [actResp, pubResp] = await Promise.all([
        fetch(`${supabaseUrl}/functions/v1/sync-by-work-item`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ work_item_id, _scheduled: true }),
        }),
        fetch(`${supabaseUrl}/functions/v1/sync-publicaciones-by-work-item`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ work_item_id, _scheduled: true }),
        }),
      ]);
      syncActResult = await actResp.json().catch(() => ({ error: "parse_failed" }));
      syncPubResult = await pubResp.json().catch(() => ({ error: "parse_failed" }));
    }

    // A) Effective chain via provider-list-effective-routing
    const routingResp = await fetch(`${supabaseUrl}/functions/v1/provider-list-effective-routing`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: workItem.organization_id, workflow: workItem.workflow_type }),
    });
    const routingData = await routingResp.json().catch(() => ({ resolutions: [] }));

    // B) Trace evidence (last hour)
    const { data: traces } = await adminDb
      .from("sync_traces")
      .select("*")
      .eq("work_item_id", work_item_id)
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(100);

    // C) DB evidence
    const [actsRes, pubsRes, provenanceRes] = await Promise.all([
      adminDb
        .from("work_item_acts")
        .select("id, source_platform, act_date, description, source_url, created_at")
        .eq("work_item_id", work_item_id)
        .order("act_date", { ascending: false })
        .limit(50),
      adminDb
        .from("work_item_publicaciones")
        .select("id, source, title, published_at, pdf_url, tipo_publicacion, created_at")
        .eq("work_item_id", work_item_id)
        .order("published_at", { ascending: false })
        .limit(50),
      adminDb
        .from("act_provenance")
        .select("id, work_item_act_id, provider_instance_id, first_seen_at, last_seen_at")
        .in(
          "work_item_act_id",
          (await adminDb
            .from("work_item_acts")
            .select("id")
            .eq("work_item_id", work_item_id)
            .limit(100)
          ).data?.map((a: any) => a.id) || []
        )
        .limit(200),
    ]);

    const acts = actsRes.data || [];
    const pubs = pubsRes.data || [];
    const provenance = provenanceRes.data || [];

    // Build Markdown (redact organization_id from output)
    let md = `# Evidence Bundle — External Enrichment Proof\n\n`;
    md += `**Generated:** ${bundleTimestamp}\n`;
    md += `**Work Item ID:** \`${work_item_id}\`\n`;
    md += `**Radicado:** ${workItem.radicado || "(sin radicado)"}\n`;
    md += `**Workflow:** ${workItem.workflow_type}\n`;
    md += `**Scrape Status:** ${workItem.scrape_status || "N/A"}\n`;
    md += `**Last Crawled:** ${workItem.last_crawled_at || "never"}\n\n`;

    // ── A) Effective Chain ──
    md += `## A) Effective Provider Chain (per subchain)\n\n`;
    const resolutions = routingData?.resolutions || [];
    for (const res of resolutions) {
      md += `### ${res.workflow} / ${res.scope}\n`;
      md += `- **Route Source:** ${res.routeSource}\n`;
      md += `- **Policy:** strategy=${res.policy?.strategy}, merge_mode=${res.policy?.merge_mode}, source=${res.policy?.source}\n`;
      md += `- **Chain:**\n`;
      if (res.chain?.length > 0) {
        for (const c of res.chain) {
          const skipTag = c.skip_reason ? ` ⚠️ SKIPPED: ${c.skip_reason}` : "";
          md += `  - [${c.attempt_index}] **${c.provider_name}** (${c.source}, route: ${c.route_source || "N/A"})${skipTag}\n`;
        }
      } else {
        md += `  - _(no providers)_\n`;
      }
      md += `\n`;
    }

    // ── B) Trace Evidence ──
    md += `## B) Trace Evidence (last hour, ${(traces || []).length} entries)\n\n`;
    if (traces && traces.length > 0) {
      md += `| Step | Provider | Status | HTTP | Latency | Error Code | Subchain | Details |\n`;
      md += `|------|----------|--------|------|---------|------------|----------|---------|\n`;
      for (const t of traces) {
        const meta = t.meta || {};
        md += `| ${t.step} | ${t.provider || "-"} | ${t.success ? "✅" : "❌"} | ${t.http_status || "-"} | ${t.latency_ms || "-"}ms | ${t.error_code || "-"} | ${meta.subchain_kind || meta.data_kind || "-"} | ${(t.message || "").slice(0, 80)} |\n`;
      }
    } else {
      md += `_(no traces found — run sync first with run_sync=true)_\n`;
    }
    md += `\n`;

    // ── C) DB Evidence ──
    md += `## C) DB Evidence\n\n`;
    md += `### Actuaciones (work_item_acts): ${acts.length} records\n\n`;
    if (acts.length > 0) {
      const sourceCounts: Record<string, number> = {};
      const withUrl = acts.filter((a: any) => a.source_url);
      for (const a of acts) {
        sourceCounts[(a as any).source_platform || "unknown"] = (sourceCounts[(a as any).source_platform || "unknown"] || 0) + 1;
      }
      md += `- **Source breakdown:** ${Object.entries(sourceCounts).map(([k, v]) => `${k}=${v}`).join(", ")}\n`;
      md += `- **With source_url (PDF):** ${withUrl.length}\n`;
      md += `- **Date range:** ${acts[acts.length - 1]?.act_date || "?"} → ${acts[0]?.act_date || "?"}\n`;
    }

    md += `\n### Publicaciones (work_item_publicaciones): ${pubs.length} records\n\n`;
    if (pubs.length > 0) {
      const pubSourceCounts: Record<string, number> = {};
      const withPdf = pubs.filter((p: any) => p.pdf_url);
      for (const p of pubs) {
        pubSourceCounts[(p as any).source || "unknown"] = (pubSourceCounts[(p as any).source || "unknown"] || 0) + 1;
      }
      md += `- **Source breakdown:** ${Object.entries(pubSourceCounts).map(([k, v]) => `${k}=${v}`).join(", ")}\n`;
      md += `- **With PDF URL:** ${withPdf.length}\n`;
      md += `- **Date range:** ${pubs[pubs.length - 1]?.published_at?.slice(0, 10) || "?"} → ${pubs[0]?.published_at?.slice(0, 10) || "?"}\n`;
    }

    md += `\n### Provenance (act_provenance): ${provenance.length} rows\n\n`;
    if (provenance.length > 0) {
      const instanceCounts: Record<string, number> = {};
      for (const p of provenance) {
        instanceCounts[(p as any).provider_instance_id || "unknown"] = (instanceCounts[(p as any).provider_instance_id || "unknown"] || 0) + 1;
      }
      md += `- **By instance:** ${Object.entries(instanceCounts).map(([k, v]) => `${k.slice(0, 8)}…=${v}`).join(", ")}\n`;
      md += `- **Multi-source acts:** ${new Set(provenance.map((p: any) => p.work_item_act_id)).size} unique acts with provenance\n`;
    }

    // ── D) Sync Results Summary ──
    if (run_sync) {
      md += `\n## D) Sync Results (just executed)\n\n`;
      md += `### ACTUACIONES sync\n`;
      md += "```json\n" + JSON.stringify(syncActResult, null, 2) + "\n```\n\n";
      md += `### PUBLICACIONES sync\n`;
      md += "```json\n" + JSON.stringify(syncPubResult, null, 2) + "\n```\n\n";
    }

    // ── Summary ──
    const summary = {
      workflow: workItem.workflow_type,
      radicado: workItem.radicado,
      actuaciones_count: acts.length,
      publicaciones_count: pubs.length,
      provenance_rows: provenance.length,
      trace_entries: (traces || []).length,
      chain_resolutions: resolutions.length,
      acts_sources: [...new Set(acts.map((a: any) => a.source_platform))],
      pubs_sources: [...new Set(pubs.map((p: any) => p.source))],
      has_pdf_links: pubs.some((p: any) => p.pdf_url) || acts.some((a: any) => a.source_url),
    };

    md += `\n## Summary\n\n`;
    md += "```json\n" + JSON.stringify(summary, null, 2) + "\n```\n";

    return new Response(
      JSON.stringify({ ok: true, markdown: md, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
