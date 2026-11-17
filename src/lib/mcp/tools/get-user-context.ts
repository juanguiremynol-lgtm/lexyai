import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";
import { backendFailureResult, classifyBackendFailure, settleQuery, worstFailure } from "../backend-failure";

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
    let sb: ReturnType<typeof sbForUser>;
    try { sb = sbForUser(ctx); } catch (thrown) { return backendFailureResult(classifyBackendFailure(thrown)); }

    const [profileRead, archivedRead] = await Promise.all([
      settleQuery(() => sb.from("profiles").select("full_name, firm_name, email, timezone").eq("id", ctx.getUserId()).maybeSingle()),
      settleQuery(() => sb.from("work_items").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("lifecycle_state", "ARCHIVED")),
    ]);
    const firstFailure = worstFailure([profileRead, archivedRead].flatMap((r) => (r.failure ? [r.failure] : [])));
    if (firstFailure) return backendFailureResult(firstFailure);
    if (!profileRead.ok || !archivedRead.ok) return errorResult("No se pudo verificar el contexto.");
    if (archivedRead.count === null) return errorResult("No se pudo verificar el conteo de archivados.");
    const profile = profileRead.data;

    const byType: Record<string, number> = {};
    let total = 0;
    let after: string | undefined;
    // Page the minimal RLS-visible projection, not an artificial portfolio cap.
    // Any page failure aborts: a partial count is never returned as success.
    for (;;) {
      const cursor = after;
      const page = await settleQuery(() => {
        let query = sb.from("work_items").select("id, workflow_type")
          .is("deleted_at", null).eq("lifecycle_state", "ACTIVE")
          .order("id", { ascending: true }).limit(1000);
        if (cursor) query = query.gt("id", cursor);
        return query;
      });
      if (!page.ok) return backendFailureResult(page.failure);
      const data = page.data;
      if (!data) return errorResult("No se pudo verificar el conteo de asuntos activos.");
      for (const row of data) {
        const key = row.workflow_type ?? "SIN_TIPO";
        byType[key] = (byType[key] ?? 0) + 1;
        total++;
      }
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
