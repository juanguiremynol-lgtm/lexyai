import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sbForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_recent_estados",
  title: "Novedades judiciales recientes",
  description:
    "Lists the most recent judicial estados / actuaciones detected across the signed-in user's monitored matters, ordered by detected_at desc.",
  inputSchema: {
    days: z.number().int().min(1).max(30).optional().describe("Ventana en días (default 3)."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo filas (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = sbForUser(ctx);
    const since = new Date(Date.now() - (days ?? 3) * 86400_000).toISOString();
    const { data, error } = await sb
      .from("work_item_estados")
      .select("id, work_item_id, radicado, title, detected_at, source, workflow_type")
      .gte("detected_at", since)
      .order("detected_at", { ascending: false })
      .limit(limit ?? 25);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `${data?.length ?? 0} novedades en los últimos ${days ?? 3} días.` }],
      structuredContent: { estados: data ?? [] },
    };
  },
});