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
  name: "get_work_item",
  title: "Detalle de asunto",
  description:
    "Fetches details for one legal matter (work_item) by id or by radicado, including recent actuaciones and estados.",
  inputSchema: {
    id: z.string().uuid().optional().describe("work_item UUID."),
    radicado: z.string().trim().optional().describe("Radicado exacto (23-dígitos u otro formato)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, radicado }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    if (!id && !radicado) {
      return { content: [{ type: "text", text: "Provide either id or radicado." }], isError: true };
    }
    const sb = sbForUser(ctx);
    let q = sb.from("work_items").select("*").is("deleted_at", null).limit(1);
    if (id) q = q.eq("id", id);
    else if (radicado) q = q.eq("radicado", radicado);
    const { data: itemRows, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const item = itemRows?.[0];
    if (!item) return { content: [{ type: "text", text: "Asunto no encontrado." }], isError: true };

    const [{ data: acts }, { data: estados }] = await Promise.all([
      sb.from("work_item_acts").select("*").eq("work_item_id", item.id).order("detected_at", { ascending: false }).limit(20),
      sb.from("work_item_estados").select("*").eq("work_item_id", item.id).order("detected_at", { ascending: false }).limit(20),
    ]);

    return {
      content: [
        { type: "text", text: `Asunto ${item.radicado ?? item.id} — ${item.workflow_type} — ${acts?.length ?? 0} actuaciones, ${estados?.length ?? 0} estados.` },
      ],
      structuredContent: { item, recent_acts: acts ?? [], recent_estados: estados ?? [] },
    };
  },
});