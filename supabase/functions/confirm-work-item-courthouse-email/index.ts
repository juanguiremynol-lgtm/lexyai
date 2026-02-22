import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ConfirmRequest {
  work_item_id: string;
  email: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth client
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service client for writes
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid auth" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: ConfirmRequest = await req.json();
    const { work_item_id, email } = body;

    if (!work_item_id || !email) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing work_item_id or email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch work item
    const { data: workItem, error: fetchError } = await authClient
      .from("work_items")
      .select("id, organization_id")
      .eq("id", work_item_id)
      .single();

    if (fetchError || !workItem) {
      return new Response(
        JSON.stringify({ ok: false, error: "Work item not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Write confirmation event (service role to bypass RLS)
    const { error: eventError } = await serviceClient
      .from("work_item_email_events")
      .insert({
        work_item_id,
        actor_type: "USER",
        event_type: "CONFIRMED",
        confirmed_email: email,
        created_at: new Date().toISOString(),
      });

    if (eventError) {
      console.error("[confirm-courthouse-email] Event insert error:", eventError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to save confirmation" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Audit log
    if (workItem.organization_id) {
      await serviceClient
        .from("audit_logs")
        .insert({
          organization_id: workItem.organization_id,
          actor_user_id: user.id,
          actor_type: "USER",
          action: "COURTHOUSE_EMAIL_CONFIRMED",
          entity_type: "work_item",
          entity_id: work_item_id,
          metadata: {
            confirmed_email: email,
          },
        });
      // Fire-and-forget audit log — error is non-fatal
    }

    return new Response(
      JSON.stringify({
        ok: true,
        work_item_id,
        confirmed_email: email,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[confirm-courthouse-email] Error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
