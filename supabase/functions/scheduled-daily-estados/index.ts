/** Compatibility entry point: public estados are owned by durable source monitors. */
import { isCronCaller, CRON_HEADER } from "../_shared/cronAuth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!isCronCaller(req)) return new Response("Unauthorized", { status: 401 });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("CRON_SERVICE_KEY");
  if (!url || !key) return new Response("Missing configuration", { status: 500 });
  const dispatched = await Promise.all(["scheduled-publicaciones-monitor", "scheduled-samai-estados-monitor"].map(async (endpoint) => {
    try {
      const response = await fetch(`${url}/functions/v1/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json", [CRON_HEADER]: key },
        body: "{}", signal: AbortSignal.timeout(130_000),
      });
      return { endpoint, accepted: response.ok };
    } catch { return { endpoint, accepted: false }; }
  }));
  // Dispatch acknowledgement is never a completed public-source consultation.
  return Response.json({ dispatched, consulta_completa: false }, {
    status: dispatched.every((x) => x.accepted) ? 202 : 503,
  });
});
