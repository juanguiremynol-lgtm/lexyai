import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BackfillRequest {
  dry_run?: boolean;
  limit?: number;
  organization_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: BackfillRequest = req.method === "POST" ? await req.json() : {};
    const dryRun = body.dry_run ?? false;
    const limit = body.limit ?? 100;
    const orgFilter = body.organization_id;

    // Find work items with radicado but missing/low-confidence courthouse email
    let query = supabase
      .from("work_items")
      .select("id, radicado, authority_name, authority_city, authority_department, courthouse_email_status, courthouse_email_confidence, organization_id")
      .not("radicado", "is", null);

    if (orgFilter) {
      query = query.eq("organization_id", orgFilter);
    }

    // Filter for items that need resolution
    query = query.or(`courthouse_email_status.eq.NONE,courthouse_email_status.eq.SUGGESTED`).limit(limit);

    const { data: workItems, error: fetchError } = await query;

    if (fetchError) {
      console.error("[backfill-courthouse-emails] Fetch error:", fetchError);
      return new Response(
        JSON.stringify({ ok: false, error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workItems || workItems.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: 0,
          skipped: 0,
          message: "No work items found needing backfill",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let skipped = 0;
    const results: Array<{ work_item_id: string; status: string; error?: string }> = [];

    for (const item of workItems) {
      try {
        // Skip if very low confidence and already suggested (avoid thrashing)
        if (
          item.courthouse_email_status === "SUGGESTED" &&
          item.courthouse_email_confidence !== null &&
          item.courthouse_email_confidence < 40
        ) {
          skipped++;
          continue;
        }

        if (dryRun) {
          processed++;
          results.push({
            work_item_id: item.id,
            status: "would_resolve",
          });
        } else {
          // Call resolve endpoint (server-to-server, no auth needed)
          const resolveResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-courthouse-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              work_item_id: item.id,
            }),
          });

          const resolveResult = await resolveResponse.json();
          if (resolveResult.ok) {
            processed++;
            results.push({
              work_item_id: item.id,
              status: "resolved",
            });
          } else {
            skipped++;
            results.push({
              work_item_id: item.id,
              status: "failed",
              error: resolveResult.error,
            });
          }
        }
      } catch (e) {
        skipped++;
        results.push({
          work_item_id: item.id,
          status: "error",
          error: (e as Error).message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        processed,
        skipped,
        total: workItems.length,
        results: results.slice(0, 10), // Return first 10 for visibility
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[backfill-courthouse-emails] Error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
