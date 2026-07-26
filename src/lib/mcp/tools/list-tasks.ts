import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_tasks",
  title: "Tareas de expedientes",
  description:
    "Lists the caller's tasks (work_item_tasks), optionally filtered by matter and status. Default: open tasks ordered by due date.",
  inputSchema: {
    work_item_id: z.string().uuid().optional().describe("Limitar a un asunto (UUID)."),
    radicado: z.string().trim().optional().describe("Limitar a un asunto por radicado."),
    status: z.string().trim().optional().describe("Estado exacto (p. ej. PENDING, IN_PROGRESS, COMPLETED) o 'all'."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, radicado, status, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let itemId = work_item_id ?? null;
    if (!itemId && radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      itemId = resolved.item.id as string;
    }

    let q = sb
      .from("work_item_tasks")
      .select("id, work_item_id, title, description, status, priority, due_date, completed_at, created_at")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit ?? 50);

    if (itemId) q = q.eq("work_item_id", itemId);
    if (!status) q = q.neq("status", "COMPLETED");
    else if (status.toLowerCase() !== "all") q = q.eq("status", status.toUpperCase());

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    return textResult(`${data?.length ?? 0} tareas.`, {
      work_item_id: itemId,
      status: status ?? "abiertas",
      tasks: data ?? [],
    });
  },
});