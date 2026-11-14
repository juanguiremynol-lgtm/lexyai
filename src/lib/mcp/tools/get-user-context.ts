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

    const [profileRead, archivedRead] = await Promise.all([
      sb.from("profiles").select("full_name, firm_name, email, timezone").eq("id", ctx.getUserId()).maybeSingle(),
      sb.from("work_items").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("lifecycle_state", "ARCHIVED"),
    ]);
    if (profileRead.error) return errorResult(profileRead.error.message);
    if (archivedRead.error) return errorResult(archivedRead.error.message);
    if (archivedRead.count === null) return errorResult("No se pudo verificar el conteo de archivados.");
    const profile = profileRead.data;

    const byType: Record<string, number> = {};
    let total = 0;
    let after: string | undefined;
    // Page the minimal RLS-visible projection, not an artificial portfolio cap.
    for (;;) {
      let query = sb.from("work_items").select("id, workflow_type")
        .is("deleted_at", null).eq("lifecycle_state", "ACTIVE")
        .order("id", { ascending: true }).limit(1000);
      if (after) query = query.gt("id", after);
      const { data, error } = await query;
      if (error) return errorResult(error.message);
      for (const row of data ?? []) {
        const key = row.workflow_type ?? "SIN_TIPO";
        byType[key] = (byType[key] ?? 0) + 1;
        total++;
      }
      if (!data) return errorResult("No se pudo verificar el conteo de asuntos activos.");
      if (data.length === 0) break;
      after = data[data.length - 1]?.id;
      if (!after) return errorResult("No se pudo continuar el conteo de asuntos.");
    }
    const name = (profile as { full_name?: string } | null)?.full_name ?? ctx.getUserEmail() ?? "Usuario";
    const firm = (profile as { firm_name?: string } | null)?.firm_name;

    return textResult(
      `${name}${firm ? ` (${firm})` : ""} — ${total} asuntos activos: ${
        Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "ninguno"
      }.`,
      { profile: profile ?? null, active_work_items: total, archived_work_items: archivedRead.count, by_workflow_type: byType },
    );
  },
});
