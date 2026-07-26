import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "get_user_context",
  title: "Contexto del abogado",
  description:
    "Returns the signed-in lawyer's profile (name, firm) and portfolio counters (active matters by workflow type). Call this first so you can address the user correctly without asking.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    const [{ data: profile }, { data: items }] = await Promise.all([
      sb.from("profiles").select("full_name, firm_name, email, timezone").eq("id", ctx.getUserId()).maybeSingle(),
      sb.from("work_items").select("workflow_type").is("deleted_at", null).limit(1000),
    ]);

    const byType: Record<string, number> = {};
    for (const row of items ?? []) {
      const key = (row as { workflow_type: string | null }).workflow_type ?? "SIN_TIPO";
      byType[key] = (byType[key] ?? 0) + 1;
    }
    const total = items?.length ?? 0;
    const name = (profile as { full_name?: string } | null)?.full_name ?? ctx.getUserEmail() ?? "Usuario";
    const firm = (profile as { firm_name?: string } | null)?.firm_name;

    return textResult(
      `${name}${firm ? ` (${firm})` : ""} — ${total} asuntos activos: ${
        Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "ninguno"
      }.`,
      { profile: profile ?? null, active_work_items: total, by_workflow_type: byType },
    );
  },
});
