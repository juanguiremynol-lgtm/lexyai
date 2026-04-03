const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CPNU_API_BASE = "https://cpnu-read-api-486431576619.us-central1.run.app";

const VALID_ACTIONS = ["pausar", "reactivar", "cerrar", "eliminar"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { action: string; workItemId: string; razon?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { action, workItemId, razon } = body;

  if (!action || !VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
    return new Response(JSON.stringify({ error: `Invalid action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!workItemId) {
    return new Response(JSON.stringify({ error: "workItemId is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = `${CPNU_API_BASE}/work-items/${workItemId}/${action}`;
  const patchBody = razon ? { razon } : undefined;

  try {
    const upstream = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      ...(patchBody ? { body: JSON.stringify(patchBody) } : {}),
    });

    const text = await upstream.text();

    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[cpnu-sync] ${url} failed:`, err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
